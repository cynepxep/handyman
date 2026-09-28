// Отмена загрузки каталога («Отменить загрузку» в журнале импорта).
// Созданные загрузкой товары удаляются (с заказами, складом или отзывами — только скрываются), изменённые поля возвращаются
// к прежним значениям, если после загрузки их никто не менял. Что именно сделала загрузка — таблица ImportUndo (пишет executeApply).
// Загрузки, сделанные до появления ImportUndo («старые»), отменяются приблизительно: по времени создания товаров.

import fs from "node:fs/promises";
import { prisma, Prisma } from "./client";

/** Ошибка, текст которой можно показать владельцу как есть. */
export class UndoUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndoUserError";
  }
}

export type UndoInfo =
  | {
      can: true;
      /** Старая загрузка без записи изменений: отменяется по времени создания товаров, изменения цен не вернуть. */
      legacy: boolean;
      /** Сколько товаров будет удалено (или скрыто). */
      created: number;
      /** Сколько товаров получит прежние значения полей (у старой — сколько снова перестанут быть «пропавшими из фида»). */
      updated: number;
    }
  | { can: false; reason: string; /** Запись можно убрать из журнала (каталог она не меняет или уже отменена). */ deletable?: boolean };

export type UndoReport = {
  legacy: boolean;
  deleted: number;
  hidden: number;
  restored: number;
  /** Поля, которые после загрузки уже меняли вручную или другой загрузкой: их не трогали. */
  keptChanged: number;
  categoriesRemoved: number;
  /** Бренды, созданные загрузкой и оставшиеся без товаров (удалены). */
  brandsRemoved?: number;
  /** Старая загрузка: сколько товаров она обновила (эти изменения не вернуть). */
  notRestorable: number;
};

const when = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
const MONEY = new Set(["price", "oldPrice", "supplierPrice"]);
const DATES = new Set(["missingFromFeedSince"]);
const RESTORABLE = new Set([
  "nameUk", "nameRu", "descUk", "price", "oldPrice", "supplierPrice", "categoryId", "brandId", "supplierId",
  "supplierAvailable", "articleCode", "supplierUrl", "missingFromFeedSince", "priceConflict",
]);

/** Окно «старой» загрузки: товары, созданные между началом и концом применения. */
function legacyWindow(run: { startedAt: Date; finishedAt: Date | null }) {
  return { gte: run.startedAt, lte: new Date((run.finishedAt ?? run.startedAt).getTime() + 1000) };
}

async function loadRun(runId: string) {
  return prisma.importRun.findUnique({
    where: { id: runId },
    select: { id: true, supplierId: true, status: true, startedAt: true, finishedAt: true, undoneAt: true, summary: true, report: true, feedFile: true },
  });
}

/** Загрузка после появления журнала изменений (всегда пишет createdCategories в отчёт). */
const isModern = (run: { report: unknown }) => Array.isArray(((run.report ?? {}) as { createdCategories?: unknown }).createdCategories);

/** Изменила ли применённая загрузка каталог (иначе её не нужно отменять и она не мешает отмене более ранних). */
async function changedCatalog(run: { id: string; status: string; report: unknown; summary: unknown }): Promise<boolean> {
  if (run.status === "PREVIEW") return false;
  if (run.status === "RUNNING") return true;
  if ((await prisma.importUndo.count({ where: { runId: run.id } })) > 0) return true;
  if (run.status === "FAILED" || isModern(run)) return false;
  const s = (run.summary ?? {}) as { created?: number; updated?: number; missing?: number };
  return !!(s.created || s.updated || s.missing);
}

/** Можно ли отменить загрузку и что при этом произойдёт. */
export async function undoInfo(runId: string): Promise<UndoInfo> {
  const run = await loadRun(runId);
  if (!run) return { can: false, reason: "Загрузка не найдена." };
  if (run.undoneAt) return { can: false, reason: `Загрузка уже отменена ${when(run.undoneAt)}.`, deletable: true };
  if (run.status === "PREVIEW") return { can: false, reason: "Это только проверка — в каталог ничего не записано.", deletable: true };
  if (run.status === "RUNNING") return { can: false, reason: "Загрузка ещё идёт. Дождитесь окончания." };

  const later = await prisma.importRun.findMany({
    where: { supplierId: run.supplierId, id: { not: run.id }, status: { in: ["DONE", "RUNNING", "FAILED"] }, undoneAt: null, startedAt: { gt: run.startedAt } },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, status: true, report: true, summary: true },
  });
  for (const l of later) {
    if (!(await changedCatalog(l))) continue; // повтор без изменений не мешает
    return {
      can: false,
      reason: l.status === "RUNNING"
        ? "Сейчас идёт другая загрузка этого поставщика. Дождитесь окончания."
        : `После неё была ещё загрузка этого поставщика (${when(l.startedAt)}). Сначала отмените более позднюю.`,
    };
  }

  const [created, updated] = await Promise.all([
    prisma.importUndo.count({ where: { runId, kind: "created" } }),
    prisma.importUndo.count({ where: { runId, kind: "updated" } }),
  ]);
  if (created || updated) return { can: true, legacy: false, created, updated };
  if (run.status === "FAILED") return { can: false, reason: "Загрузка не выполнена — в каталоге ничего не менялось.", deletable: true };
  // Новые загрузки всегда пишут createdCategories: раз записей нет — возвращать нечего (могли поменяться только фото и характеристики).
  if (isModern(run)) {
    return { can: false, reason: "Эта загрузка не добавляла товаров и не меняла цены и наличие — отменять нечего.", deletable: true };
  }

  const summary = (run.summary ?? {}) as { created?: number; updated?: number; missing?: number };
  if (!summary.created && !summary.updated && !summary.missing) return { can: false, reason: "Эта загрузка ничего не меняла в каталоге.", deletable: true };
  // Загрузка до появления журнала изменений: ищем товары по времени создания.
  const [legacyCreated, legacyMissing] = await Promise.all([
    prisma.product.count({ where: { supplierId: run.supplierId, source: "FEED", createdAt: legacyWindow(run) } }),
    prisma.product.count({ where: { supplierId: run.supplierId, missingFromFeedSince: legacyWindow(run) } }),
  ]);
  if (!legacyCreated && !legacyMissing) return { can: false, reason: "Товаров этой загрузки в каталоге уже нет." };
  return { can: true, legacy: true, created: legacyCreated, updated: legacyMissing };
}

/** Удалить созданные загрузкой товары; с заказами, складом или отзывами — только скрыть с сайта. */
async function removeCreated(ids: string[]) {
  let deleted = 0;
  let hidden = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const keep = await prisma.product.findMany({
      where: {
        id: { in: chunk },
        OR: [
          { orderItems: { some: {} } },
          { reviews: { some: {} } },
          { stockItems: { some: { OR: [{ onHand: { not: 0 } }, { reserved: { not: 0 } }, { incomingQty: { not: 0 } }, { movements: { some: {} } }] } } },
        ],
      },
      select: { id: true },
    });
    const keepIds = new Set(keep.map((k) => k.id));
    if (keepIds.size) hidden += (await prisma.product.updateMany({ where: { id: { in: [...keepIds] } }, data: { visible: false } })).count;
    deleted += (await prisma.product.deleteMany({ where: { id: { in: chunk.filter((id) => !keepIds.has(id)) } } })).count;
  }
  return { deleted, hidden };
}

type Current = Record<string, unknown>;
const jsonOf = (k: string, v: unknown): unknown => {
  if (v == null) return null;
  if (MONEY.has(k)) return Number(v as Prisma.Decimal);
  if (v instanceof Date) return v.toISOString();
  return v;
};
const sameVal = (k: string, a: unknown, b: unknown) =>
  MONEY.has(k) && a != null && b != null ? Math.abs(Number(a) - Number(b)) < 0.005 : a === b;
const fromJson = (k: string, v: unknown): unknown => (v == null ? null : DATES.has(k) ? new Date(String(v)) : v);

/** Вернуть прежние значения полей там, где после загрузки их никто не менял. */
async function restoreUpdated(runId: string, who: string) {
  const [brands, cats, sups] = await Promise.all([
    prisma.brand.findMany({ select: { id: true } }),
    prisma.category.findMany({ select: { id: true } }),
    prisma.supplier.findMany({ select: { id: true } }),
  ]);
  const exists: Record<string, Set<string>> = {
    brandId: new Set(brands.map((b) => b.id)), categoryId: new Set(cats.map((c) => c.id)), supplierId: new Set(sups.map((s) => s.id)),
  };
  let restored = 0;
  let keptChanged = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.importUndo.findMany({
      where: { runId, kind: "updated" }, orderBy: { id: "asc" }, take: 1000, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    const current = new Map(
      (await prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } } })).map((p) => [p.id, p as unknown as Current]),
    );
    const groups = new Map<string, { ids: string[]; data: Record<string, unknown> }>();
    const priceLogs: Prisma.PriceLogCreateManyInput[] = [];
    for (const row of rows) {
      const cur = current.get(row.productId);
      if (!cur) continue;
      const before = (row.before ?? {}) as Record<string, unknown>;
      const after = (row.after ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(after)) {
        if (!RESTORABLE.has(k)) continue;
        if (!sameVal(k, jsonOf(k, cur[k]), v)) {
          keptChanged++;
          continue;
        }
        const back = before[k] ?? null;
        if (exists[k] && back != null && !exists[k].has(String(back))) continue; // бренд/категорию уже удалили
        if (k === "price" && back == null) continue; // цена обязательна
        data[k] = fromJson(k, back);
      }
      if (!Object.keys(data).length) continue;
      if (data.price != null) {
        priceLogs.push({ productId: row.productId, oldPrice: Number(cur.price as Prisma.Decimal), newPrice: Number(data.price), source: "IMPORT", who });
      }
      const key = JSON.stringify(data);
      const g = groups.get(key) ?? { ids: [], data };
      g.ids.push(row.productId);
      groups.set(key, g);
      restored++;
    }
    for (const g of groups.values()) {
      await prisma.product.updateMany({ where: { id: { in: g.ids } }, data: g.data as Prisma.ProductUpdateManyMutationInput });
    }
    if (priceLogs.length) await prisma.priceLog.createMany({ data: priceLogs });
  }
  return { restored, keptChanged };
}

/** Удалить опустевшие категории, которые создала загрузка (сначала самые глубокие). */
async function removeEmptyCategories(ids: string[]) {
  let removed = 0;
  let left = [...new Set(ids)];
  for (let pass = 0; pass < 5 && left.length; pass++) {
    const next: string[] = [];
    for (const id of left) {
      const [products, children] = await Promise.all([
        prisma.product.count({ where: { categoryId: id } }),
        prisma.category.count({ where: { parentId: id } }),
      ]);
      if (products || children) {
        next.push(id);
        continue;
      }
      try {
        await prisma.category.delete({ where: { id } });
        removed++;
      } catch {
        // на категорию ссылается выбор владельца в импорте или промокод — оставляем
      }
    }
    if (next.length === left.length) break;
    left = next;
  }
  return removed;
}

/** Бренды, которые появились из-за загрузки: связь «поставщик возит бренд» и сам новый бренд убираются, если товаров не осталось. */
async function removeUnusedBrands(supplierId: string, created: string[], links: string[]) {
  for (const brandId of links) {
    const left = await prisma.product.count({ where: { supplierId, brandId } });
    if (!left) await prisma.supplierBrand.deleteMany({ where: { supplierId, brandId } });
  }
  let removed = 0;
  for (const id of created) {
    if (await prisma.product.count({ where: { brandId: id } })) continue;
    // бренд по умолчанию у поставщика — просто название: при следующей загрузке бренд создастся снова
    if ((await prisma.brand.deleteMany({ where: { id } })).count) removed++;
  }
  return removed;
}

/** Отменить загрузку. Поисковый индекс пересобирает вызывающий (reindexAll). */
export async function undoImport(runId: string, who: string): Promise<UndoReport> {
  const info = await undoInfo(runId);
  if (!info.can) throw new UndoUserError(info.reason);
  const claimed = await prisma.importRun.updateMany({ where: { id: runId, undoneAt: null }, data: { undoneAt: new Date(), undoneBy: who } });
  if (claimed.count !== 1) throw new UndoUserError("Эту загрузку уже отменяют. Обновите страницу.");
  const run = (await loadRun(runId))!;
  try {
    const out: UndoReport = { legacy: info.legacy, deleted: 0, hidden: 0, restored: 0, keptChanged: 0, categoriesRemoved: 0, notRestorable: 0 };
    if (!info.legacy) {
      const created = await prisma.importUndo.findMany({ where: { runId, kind: "created" }, select: { productId: true } });
      Object.assign(out, await removeCreated(created.map((c) => c.productId)));
      Object.assign(out, await restoreUpdated(runId, who));
      const rep = (run.report ?? {}) as { createdCategories?: string[]; createdBrands?: string[]; addedBrandLinks?: string[] };
      out.categoriesRemoved = await removeEmptyCategories(rep.createdCategories ?? []);
      out.brandsRemoved = await removeUnusedBrands(run.supplierId, rep.createdBrands ?? [], rep.addedBrandLinks ?? []);
    } else {
      const created = await prisma.product.findMany({ where: { supplierId: run.supplierId, source: "FEED", createdAt: legacyWindow(run) }, select: { id: true } });
      Object.assign(out, await removeCreated(created.map((c) => c.id)));
      // Товары, которые эта загрузка отметила «пропали из фида»: снимаем отметку. Прежнее наличие у поставщика неизвестно —
      // оно вернётся со следующей загрузкой этого поставщика.
      out.restored = (await prisma.product.updateMany({
        where: { supplierId: run.supplierId, missingFromFeedSince: legacyWindow(run) },
        data: { missingFromFeedSince: null },
      })).count;
      out.notRestorable = ((run.summary ?? {}) as { updated?: number }).updated ?? 0;
    }
    await prisma.importRun.update({ where: { id: runId }, data: { undoReport: out as unknown as Prisma.InputJsonValue } });
    await prisma.auditLog.create({ data: { who, action: "import.undo", target: runId, details: out as unknown as Prisma.InputJsonValue } });
    return out;
  } catch (e) {
    await prisma.importRun.update({ where: { id: runId }, data: { undoneAt: null, undoneBy: null } }).catch(() => {});
    throw e;
  }
}

/** Убрать запись из журнала: проверку, неудавшуюся или уже отменённую загрузку. Применённую — только после отмены. */
export async function deleteRunRecord(runId: string, who: string) {
  const run = await loadRun(runId);
  if (!run) return;
  if (!run.undoneAt && (await changedCatalog(run))) {
    throw new UndoUserError(
      run.status === "RUNNING" ? "Загрузка ещё идёт." : "Эта загрузка изменила каталог. Сначала нажмите «Отменить загрузку», потом запись можно убрать.",
    );
  }
  if (run.feedFile) await fs.rm(run.feedFile, { force: true }).catch(() => {});
  await prisma.importRun.delete({ where: { id: runId } });
  await prisma.auditLog.create({ data: { who, action: "import.delete", target: runId, details: { status: run.status } } });
}
