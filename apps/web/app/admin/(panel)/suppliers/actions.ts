"use server";

import { redirect } from "next/navigation";
import {
  SupplierUserError, createBrand, createSupplier, deleteBrand, deleteSupplier, mergeBrand, renameBrand, setBrandSuppliers,
  setSupplierBrands, updateSupplier, type SupplierInput,
} from "@handyman/db/suppliers";
import { reindexProducts, reindexSafely } from "@handyman/db/catalog-search";
import { requirePermission } from "@/lib/auth";
import { catalogChanged } from "@/lib/shop/cache";
import { logError } from "@handyman/db/errors";

const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

/** Выполняет действие и переходит по адресу, который оно вернуло; понятную ошибку показывает на странице. */
async function run(fallback: string, fn: () => Promise<string>): Promise<never> {
  let target: string;
  try {
    target = await fn();
  } catch (e) {
    const message = e instanceof SupplierUserError ? e.message : `Непредвиденная ошибка: ${e instanceof Error ? e.message : String(e)}`;
    if (!(e instanceof SupplierUserError)) logError("[suppliers]", e);
    redirect(withParam(fallback, "error", message));
  }
  redirect(target);
}

function readSupplier(formData: FormData): SupplierInput {
  const markupRaw = String(formData.get("markupPct") ?? "").trim().replace(",", ".");
  const markupPct = markupRaw === "" ? null : Number(markupRaw);
  if (markupPct !== null && !Number.isFinite(markupPct)) throw new SupplierUserError("Наценка должна быть числом (или пустой, если наценки нет).");
  return {
    name: String(formData.get("name") ?? ""),
    contact: String(formData.get("contact") ?? ""),
    note: String(formData.get("note") ?? ""),
    feedUrl: String(formData.get("feedUrl") ?? ""),
    defaultBrand: String(formData.get("defaultBrand") ?? ""),
    markupPct,
    active: formData.get("active") === "on",
  };
}

export async function createSupplierAction(formData: FormData): Promise<void> {
  await requirePermission("suppliers.edit");
  return run("/admin/suppliers/new", async () => {
    const id = await createSupplier({ ...readSupplier(formData), active: true });
    const brandIds = formData.getAll("brandIds").map(String);
    if (brandIds.length) await setSupplierBrands(id, brandIds);
    return withParam(`/admin/suppliers/${id}`, "ok", "Поставщик добавлен. Теперь можно загрузить его каталог.");
  });
}

export async function saveSupplierAction(formData: FormData): Promise<void> {
  await requirePermission("suppliers.edit");
  const id = String(formData.get("id"));
  return run(`/admin/suppliers/${id}`, async () => {
    await updateSupplier(id, readSupplier(formData));
    await setSupplierBrands(id, formData.getAll("brandIds").map(String));
    return withParam(`/admin/suppliers/${id}`, "ok", "Сохранено.");
  });
}

export async function deleteSupplierAction(formData: FormData): Promise<void> {
  await requirePermission("suppliers.edit");
  const id = String(formData.get("id"));
  return run(`/admin/suppliers/${id}`, async () => {
    await deleteSupplier(id);
    return withParam("/admin/suppliers", "ok", "Поставщик удалён.");
  });
}

export async function createBrandAction(formData: FormData): Promise<void> {
  await requirePermission("suppliers.edit");
  return run("/admin/suppliers/brands", async () => {
    const id = await createBrand(String(formData.get("name") ?? ""), formData.getAll("supplierIds").map(String));
    return withParam(`/admin/suppliers/brands/${id}`, "ok", "Бренд добавлен.");
  });
}

export async function saveBrandAction(formData: FormData): Promise<void> {
  await requirePermission("suppliers.edit");
  const id = String(formData.get("id"));
  return run(`/admin/suppliers/brands/${id}`, async () => {
    const touched = await renameBrand(id, String(formData.get("name") ?? ""));
    await setBrandSuppliers(id, formData.getAll("supplierIds").map(String));
    if (touched.length) {
      await reindexSafely(() => reindexProducts(touched));
      catalogChanged();
    }
    return withParam(`/admin/suppliers/brands/${id}`, "ok", touched.length ? `Сохранено. Название обновлено у ${touched.length} товаров.` : "Сохранено.");
  });
}

export async function mergeBrandAction(formData: FormData): Promise<void> {
  await requirePermission("suppliers.edit");
  const id = String(formData.get("id"));
  const into = String(formData.get("into") ?? "");
  return run(`/admin/suppliers/brands/${id}`, async () => {
    if (!into) throw new SupplierUserError("Выберите, в какой бренд перенести товары.");
    const moved = await mergeBrand(id, into);
    if (moved.length) {
      await reindexSafely(() => reindexProducts(moved));
      catalogChanged();
    }
    return withParam(`/admin/suppliers/brands/${into}`, "ok", `Бренды объединены: перенесено товаров — ${moved.length}.`);
  });
}

export async function deleteBrandAction(formData: FormData): Promise<void> {
  await requirePermission("suppliers.edit");
  const id = String(formData.get("id"));
  return run(`/admin/suppliers/brands/${id}`, async () => {
    await deleteBrand(id);
    return withParam("/admin/suppliers/brands", "ok", "Бренд удалён.");
  });
}
