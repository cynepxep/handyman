"use server";

import { redirect } from "next/navigation";
import { prisma } from "@handyman/db";
import {
  ImportUserError, ensureDefaultSupplier, refreshPreview, saveBrandMapping, saveMapping, startApply, startPreview,
  type BrandChoice, type MappingChoice,
} from "@handyman/db/catalog-import";
import { UndoUserError, deleteRunRecord, undoImport } from "@handyman/db/import-undo";
import { reindexAll, reindexSafely } from "@handyman/db/catalog-search";
import { startMediaSync } from "@handyman/db/media";
import { requirePermission } from "@/lib/auth";
import { catalogChanged } from "@/lib/shop/cache";
import { logError } from "@handyman/db/errors";

const BASE = "/admin/import";

const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

/** Выполняет действие и переходит по адресу, который оно вернуло; понятную ошибку показывает на странице. */
async function run(fallback: string, fn: () => Promise<string>): Promise<never> {
  let target: string;
  try {
    target = await fn();
  } catch (e) {
    const known = e instanceof ImportUserError || e instanceof UndoUserError;
    const message = known ? e.message : `Непредвиденная ошибка: ${e instanceof Error ? e.message : String(e)}`;
    if (!known) logError("[import]", e);
    redirect(withParam(fallback, "error", message));
  }
  redirect(target);
}

/** Начать проверку: скачать фид по ссылке или взять загруженный файл. Ничего не записывает в каталог. */
export async function startPreviewAction(formData: FormData): Promise<void> {
  const session = await requirePermission("import.run");
  const supplierId = String(formData.get("supplierId") ?? "");
  return run(supplierId ? `${BASE}?supplier=${encodeURIComponent(supplierId)}` : BASE, async () => {
    const supplier = supplierId
      ? await prisma.supplier.findUnique({ where: { id: supplierId } })
      : await ensureDefaultSupplier();
    if (!supplier) throw new ImportUserError("Поставщик не найден — обновите страницу.");
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

/** Выбор владельца по брендам фида: поля bk_N (ключ бренда), bm_N (auto | skip | none | brand:<id> | new:<название>), bn_N (новое название). */
function readBrandChoices(formData: FormData): Record<string, BrandChoice> {
  const out: Record<string, BrandChoice> = {};
  for (const [name, raw] of formData.entries()) {
    const m = /^bk_(\d+)$/.exec(name);
    if (!m) continue;
    const key = String(raw);
    const typed = String(formData.get(`bn_${m[1]}`) ?? "").trim();
    const v = String(formData.get(`bm_${m[1]}`) ?? "auto");
    if (typed) out[key] = { kind: "new", name: typed };
    else if (v === "skip") out[key] = { kind: "skip" };
    else if (v === "none") out[key] = { kind: "none" };
    else if (v.startsWith("brand:")) out[key] = { kind: "brand", brandId: v.slice(6) };
    else if (v.startsWith("new:")) out[key] = { kind: "new", name: v.slice(4) };
    else out[key] = { kind: "auto" };
  }
  return out;
}

/** Поставщик проверки (у каждой загрузки свой). */
async function supplierOfRun(runId: string): Promise<string> {
  const r = await prisma.importRun.findUnique({ where: { id: runId }, select: { supplierId: true } });
  if (!r) throw new ImportUserError("Проверка не найдена. Запустите новую.");
  return r.supplierId;
}

async function saveChoices(runId: string, formData: FormData) {
  const supplierId = await supplierOfRun(runId);
  await saveMapping(supplierId, readChoices(formData));
  await saveBrandMapping(supplierId, readBrandChoices(formData));
  return supplierId;
}

export async function saveMappingAction(formData: FormData): Promise<void> {
  await requirePermission("import.run");
  const runId = String(formData.get("runId"));
  return run(`${BASE}?run=${runId}`, async () => {
    await saveChoices(runId, formData);
    await refreshPreview(runId);
    return withParam(`${BASE}?run=${runId}`, "ok", "Выбор категорий и брендов сохранён, числа пересчитаны.");
  });
}

export async function applyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("import.run");
  const runId = String(formData.get("runId"));
  return run(`${BASE}?run=${runId}`, async () => {
    const supplierId = await saveChoices(runId, formData);
    const approved = formData.getAll("approve").map(String);
    // Когда импорт закончится, поисковый индекс пересобирается сам; при сбое поиск помечается устаревшим.
    // После импорта: пересобрать поиск и докачать к себе фото новых товаров (в фоне).
    await startApply({
      runId, approvedSkus: approved, who: session.username,
      afterDone: async () => {
        await reindexSafely(() => reindexAll());
        await startMediaSync({ supplierId }, session.username, { onlyNew: true }).catch((e) => logError("[media] после импорта", e));
      },
    });
    catalogChanged(); // счётчики разделов на сайте обновятся и сами за 5 минут после окончания импорта
    return `${BASE}?run=${runId}`;
  });
}

/** Отменить загрузку: созданные ею товары удаляются, изменённые получают прежние значения. */
export async function undoImportAction(formData: FormData): Promise<void> {
  const session = await requirePermission("import.run");
  const runId = String(formData.get("runId"));
  return run(`${BASE}?run=${runId}`, async () => {
    if (formData.get("confirm") !== "on") throw new ImportUserError("Поставьте галочку «Да, отменить», чтобы подтвердить.");
    const out = await undoImport(runId, session.username);
    await reindexSafely(() => reindexAll());
    catalogChanged();
    const parts = [`удалено товаров: ${out.deleted}`];
    if (out.hidden) parts.push(`скрыто (есть заказы или склад): ${out.hidden}`);
    if (out.restored) parts.push(`возвращено прежних значений: ${out.restored}`);
    return withParam(`${BASE}?run=${runId}`, "ok", `Загрузка отменена: ${parts.join(", ")}.`);
  });
}

/** Убрать запись из журнала (проверку, неудавшуюся или отменённую загрузку). */
export async function deleteRunAction(formData: FormData): Promise<void> {
  const session = await requirePermission("import.run");
  const runId = String(formData.get("runId"));
  return run(`${BASE}?run=${runId}`, async () => {
    const r = await prisma.importRun.findUnique({ where: { id: runId }, select: { supplierId: true } });
    await deleteRunRecord(runId, session.username);
    return withParam(r ? `${BASE}?supplier=${r.supplierId}` : BASE, "ok", "Запись убрана из журнала.");
  });
}
