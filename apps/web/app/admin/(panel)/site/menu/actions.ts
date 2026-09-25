"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadMenuConfig, resetMenuConfig, saveMenuConfig } from "@handyman/db/site-content";
import {
  TASK_ICONS, addGroup, addSub, addTask, cleanName, claimOf, moveClaim, removeGroup, removeSub, removeTask,
  type MenuConfig,
} from "@handyman/core/catalog";
import { requirePermission } from "@/lib/auth";

const S = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (kind: "ok" | "error", text: string, anchor = "") => `/admin/site/menu?${kind}=${encodeURIComponent(text)}${anchor ? `#${anchor}` : ""}`;

/** Поставить элемент на позицию pos (с единицы); остальные сдвигаются. */
function placeAt<T extends { id: string }>(arr: T[], id: string, pos: number): T[] {
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0 || !Number.isFinite(pos)) return arr;
  const out = [...arr];
  const [item] = out.splice(i, 1);
  out.splice(Math.min(Math.max(Math.round(pos) - 1, 0), out.length), 0, item);
  return out;
}

type Change = { cfg: MenuConfig; error?: string; message: string; anchor?: string };

/** Общая обвязка: право, загрузка, изменение, запись, переход обратно. */
async function run(formData: FormData, change: (cfg: MenuConfig, f: FormData) => Change | Promise<Change>): Promise<never> {
  const session = await requirePermission("texts.edit");
  const cfg = await loadMenuConfig();
  const r = await change(cfg, formData);
  if (r.error) redirect(back("error", r.error, r.anchor));
  await saveMenuConfig(r.cfg, session.username);
  revalidatePath("/", "layout");
  redirect(back("ok", r.message, r.anchor));
}

// ---------- группа целиком: названия, порядок, подгруппы, перенос категорий ----------

export async function saveGroupAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => {
    const gid = S(f, "groupId");
    let next: MenuConfig = JSON.parse(JSON.stringify(cfg));
    const g = next.groups.find((x) => x.id === gid);
    if (!g) return { cfg, error: "Группа не найдена.", message: "" };
    const nameUk = cleanName(S(f, "g.nameUk"));
    const nameRu = cleanName(S(f, "g.nameRu"));
    if (nameUk.length < 2 || nameRu.length < 2) return { cfg, error: "У группы должно быть название на обоих языках.", message: "", anchor: `g-${gid}` };
    g.nameUk = nameUk; g.nameRu = nameRu;
    g.hintUk = cleanName(S(f, "g.hintUk"), 120); g.hintRu = cleanName(S(f, "g.hintRu"), 120);
    if (f.get("g.hidden") === "on") g.hidden = true; else delete g.hidden;

    for (const s of g.subs) {
      const sUk = cleanName(S(f, `sub:${s.id}:nameUk`));
      const sRu = cleanName(S(f, `sub:${s.id}:nameRu`));
      if (sUk.length < 2 || sRu.length < 2) return { cfg, error: `У подгруппы «${s.nameUk}» должно быть название на обоих языках.`, message: "", anchor: `g-${gid}` };
      s.nameUk = sUk; s.nameRu = sRu;
      if (f.get(`sub:${s.id}:hidden`) === "on") s.hidden = true; else delete s.hidden;
    }
    const order: Array<[string, number]> = g.subs.map((s) => [s.id, Number(S(f, `sub:${s.id}:order`))]);
    for (const [id, pos] of order) if (Number.isFinite(pos) && pos > 0) g.subs = placeAt(g.subs, id, pos);

    // Перенос категорий: select «to:<категория>» — код подгруппы или пусто («убрать из меню»).
    for (const [name, val] of f.entries()) {
      if (!name.startsWith("to:") || typeof val !== "string") continue;
      const catId = name.slice(3);
      const now = claimOf(next, catId)?.subId ?? "";
      if (val !== now) next = moveClaim(next, catId, val || null);
    }
    const gpos = Number(S(f, "g.order"));
    if (Number.isFinite(gpos) && gpos > 0) next.groups = placeAt(next.groups, gid, gpos);
    return { cfg: next, message: `Группа «${nameUk}» сохранена.`, anchor: `g-${gid}` };
  });
}

export async function addGroupAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => {
    const uk = cleanName(S(f, "nameUk")), ru = cleanName(S(f, "nameRu"));
    if (uk.length < 2 || ru.length < 2) return { cfg, error: "Напишите название новой группы на обоих языках.", message: "" };
    const next = addGroup(cfg, uk, ru);
    return { cfg: next, message: `Группа «${uk}» добавлена. Добавьте в неё подгруппу и перенесите категории.`, anchor: `g-${next.groups[next.groups.length - 1].id}` };
  });
}

export async function removeGroupAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => {
    const r = removeGroup(cfg, S(f, "groupId"));
    return r.error ? { cfg, error: r.error, message: "" } : { cfg: r.cfg, message: "Группа удалена." };
  });
}

export async function addSubAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => {
    const gid = S(f, "groupId");
    const uk = cleanName(S(f, "nameUk")), ru = cleanName(S(f, "nameRu"));
    if (uk.length < 2 || ru.length < 2) return { cfg, error: "Напишите название подгруппы на обоих языках.", message: "", anchor: `g-${gid}` };
    return { cfg: addSub(cfg, gid, uk, ru), message: `Подгруппа «${uk}» добавлена. Перенесите в неё категории из других подгрупп.`, anchor: `g-${gid}` };
  });
}

export async function removeSubAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => {
    const r = removeSub(cfg, S(f, "subId"));
    return r.error ? { cfg, error: r.error, message: "", anchor: `g-${S(f, "groupId")}` } : { cfg: r.cfg, message: "Подгруппа удалена.", anchor: `g-${S(f, "groupId")}` };
  });
}

/** Категория, не попавшая в меню, — положить в выбранную подгруппу. */
export async function assignLostAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => {
    const catId = S(f, "catId"), subId = S(f, "subId");
    if (!subId) return { cfg, error: "Выберите подгруппу, куда положить категорию.", message: "", anchor: "lost" };
    return { cfg: moveClaim(cfg, catId, subId), message: "Категория добавлена в меню.", anchor: "lost" };
  });
}

// ---------- задачи ----------

export async function saveTaskAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => {
    const id = S(f, "taskId");
    const next: MenuConfig = JSON.parse(JSON.stringify(cfg));
    const t = next.tasks.find((x) => x.id === id);
    if (!t) return { cfg, error: "Задача не найдена.", message: "" };
    const uk = cleanName(S(f, "nameUk")), ru = cleanName(S(f, "nameRu"));
    if (uk.length < 2 || ru.length < 2) return { cfg, error: "У задачи должно быть название на обоих языках.", message: "", anchor: `t-${id}` };
    t.nameUk = uk; t.nameRu = ru;
    t.hintUk = cleanName(S(f, "hintUk"), 120); t.hintRu = cleanName(S(f, "hintRu"), 120);
    const icon = S(f, "icon");
    if (TASK_ICONS.some((i) => i.key === icon)) t.icon = icon;
    if (f.get("hidden") === "on") t.hidden = true; else delete t.hidden;
    const keepTree = f.getAll("cat").map(String);
    const keepOwn = f.getAll("ownCat").map(String);
    const add = S(f, "addCat");
    t.categoryIds = [...new Set([...keepTree, ...(add ? [add] : [])])];
    if (keepOwn.length) t.ownIds = keepOwn; else delete t.ownIds;
    const pos = Number(S(f, "order"));
    if (Number.isFinite(pos) && pos > 0) next.tasks = placeAt(next.tasks, id, pos);
    return { cfg: next, message: `Задача «${uk}» сохранена.`, anchor: `t-${id}` };
  });
}

export async function addTaskAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => {
    const uk = cleanName(S(f, "nameUk")), ru = cleanName(S(f, "nameRu"));
    if (uk.length < 2 || ru.length < 2) return { cfg, error: "Напишите название задачи на обоих языках.", message: "", anchor: "tasks" };
    const next = addTask(cfg, uk, ru);
    return { cfg: next, message: `Задача «${uk}» добавлена. Отметьте, какие категории в неё входят.`, anchor: `t-${next.tasks[next.tasks.length - 1].id}` };
  });
}

export async function removeTaskAction(formData: FormData): Promise<void> {
  await run(formData, (cfg, f) => ({ cfg: removeTask(cfg, S(f, "taskId")), message: "Задача удалена.", anchor: "tasks" }));
}

// ---------- сброс ----------

export async function resetMenuAction(formData: FormData): Promise<void> {
  const session = await requirePermission("texts.edit");
  if (formData.get("confirm") !== "on") redirect(back("error", "Поставьте галочку, чтобы подтвердить возврат стандартного меню."));
  await resetMenuConfig(session.username);
  revalidatePath("/", "layout");
  redirect(back("ok", "Меню и задачи возвращены к стандартным."));
}
