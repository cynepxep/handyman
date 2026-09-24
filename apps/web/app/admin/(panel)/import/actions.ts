"use server";

import { redirect } from "next/navigation";
import { prisma } from "@handyman/db";
import {
  ImportUserError, ensureDefaultSupplier, refreshPreview, saveMapping, startApply, startPreview,
  type MappingChoice,
} from "@handyman/db/catalog-import";
import { reindexAll, reindexSafely } from "@handyman/db/catalog-search";
import { requirePermission } from "@/lib/auth";

const BASE = "/admin/import";

const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

/** Выполняет действие и переходит по адресу, который оно вернуло; понятную ошибку показывает на странице. */
async function run(fallback: string, fn: () => Promise<string>): Promise<never> {
  let target: string;
  try {
    target = await fn();
  } catch (e) {
    const message = e instanceof ImportUserError ? e.message : `Непредвиденная ошибка: ${e instanceof Error ? e.message : String(e)}`;
    if (!(e instanceof ImportUserError)) console.error("[import]", e);
    redirect(withParam(fallback, "error", message));
  }
  redirect(target);
}

/** Начать проверку: скачать фид по ссылке или взять загруженный файл. Ничего не записывает в каталог. */
export async function startPreviewAction(formData: FormData): Promise<void> {
  const session = await requirePermission("import.run");
  return run(BASE, async () => {
    const supplier = await ensureDefaultSupplier();
    const mode = String(formData.get("mode") ?? "url");
    if (mode === "file") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) throw new ImportUserError("Выберите файл XML на компьютере.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = await startPreview({ supplierId: supplier.id, source: { kind: "file", name: file.name, bytes }, who: session.username });
      return `${BASE}?run=${id}`;
    }
    const url = String(formData.get("url") ?? "").trim() || supplier.feedUrl || "";
    if (!url) throw new ImportUserError("Укажите ссылку на фид поставщика или загрузите файл.");
    const id = await startPreview({ supplierId: supplier.id, source: { kind: "url", url }, who: session.username });
    return `${BASE}?run=${id}`;
  });
}

/** Выбор владельца по веткам: поля k_N (ключ ветки) и m_N (auto | skip | cat:<id> | new:<название>). */
function readChoices(formData: FormData): Record<string, MappingChoice> {
  const out: Record<string, MappingChoice> = {};
  for (const [name, raw] of formData.entries()) {
    const m = /^k_(\d+)$/.exec(name);
    if (!m) continue;
    const key = String(raw);
    const v = String(formData.get(`m_${m[1]}`) ?? "auto");
    if (v === "skip") out[key] = { kind: "skip" };
    else if (v.startsWith("cat:")) out[key] = { kind: "category", categoryId: v.slice(4) };
    else if (v.startsWith("new:")) out[key] = { kind: "new", name: v.slice(4) };
    else out[key] = { kind: "auto" };
  }
  return out;
}

export async function saveMappingAction(formData: FormData): Promise<void> {
  await requirePermission("import.run");
  const runId = String(formData.get("runId"));
  return run(`${BASE}?run=${runId}`, async () => {
    const supplier = await ensureDefaultSupplier();
    await saveMapping(supplier.id, readChoices(formData));
    await refreshPreview(runId);
    return withParam(`${BASE}?run=${runId}`, "ok", "Выбор категорий сохранён, числа пересчитаны.");
  });
}

export async function applyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("import.run");
  const runId = String(formData.get("runId"));
  return run(`${BASE}?run=${runId}`, async () => {
    const supplier = await ensureDefaultSupplier();
    await saveMapping(supplier.id, readChoices(formData));
    const approved = formData.getAll("approve").map(String);
    // Когда импорт закончится, поисковый индекс пересобирается сам; при сбое поиск помечается устаревшим.
    await startApply({ runId, approvedSkus: approved, who: session.username, afterDone: () => reindexSafely(() => reindexAll()) });
    return `${BASE}?run=${runId}`;
  });
}

export async function saveSupplierAction(formData: FormData): Promise<void> {
  await requirePermission("suppliers.edit");
  return run(BASE, async () => {
    const supplier = await ensureDefaultSupplier();
    const feedUrl = String(formData.get("feedUrl") ?? "").trim();
    const defaultBrand = String(formData.get("defaultBrand") ?? "").trim();
    const markupRaw = String(formData.get("markupPct") ?? "").trim().replace(",", ".");
    const markupPct = markupRaw === "" ? null : Number(markupRaw);
    if (markupPct !== null && (!Number.isFinite(markupPct) || markupPct < -90 || markupPct > 300)) {
      throw new ImportUserError("Наценка должна быть числом от -90 до 300 (или пустой, если наценки нет).");
    }
    if (feedUrl && !/^https?:\/\//i.test(feedUrl)) throw new ImportUserError("Ссылка на фид должна начинаться с http:// или https://");
    await prisma.supplier.update({
      where: { id: supplier.id },
      data: { feedUrl: feedUrl || null, defaultBrand: defaultBrand || null, markupPct },
    });
    return withParam(BASE, "ok", "Настройки поставщика сохранены.");
  });
}
