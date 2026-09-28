"use server";

// Совместимость (шаг 5.6): группы «Диск 125 мм», «Акумулятор 18 В»… и товары в них (инструменты и расходники).
import { redirect } from "next/navigation";
import {
  PlusUserError, addToCompatGroup, createCompatGroup, deleteCompatGroup, removeFromCompatGroup, updateCompatGroup,
} from "@handyman/db/storefront-plus";
import { requirePermission } from "@/lib/auth";
import { catalogChanged } from "@/lib/shop/cache";
import { logError } from "@handyman/db/errors";

const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

async function run(page: string, fn: () => Promise<string | { go: string; message: string }>): Promise<never> {
  let target = page;
  let kind: "ok" | "error" = "ok";
  let message: string;
  try {
    const r = await fn();
    if (typeof r === "string") message = r;
    else {
      target = r.go;
      message = r.message;
    }
    catalogChanged();
  } catch (e) {
    kind = "error";
    message = e instanceof PlusUserError ? e.message : `Непредвиденная ошибка: ${e instanceof Error ? e.message : String(e)}`;
    if (!(e instanceof PlusUserError)) logError("[compat]", e);
  }
  redirect(withParam(target, kind, message));
}

export async function createGroupAction(formData: FormData): Promise<void> {
  const s = await requirePermission("products.edit");
  return run("/admin/compat", async () => {
    const id = await createCompatGroup(formData.get("label"), formData.get("labelRu"), s.username);
    return { go: `/admin/compat/${id}`, message: "Группа создана. Добавьте инструменты и расходники." };
  });
}

export async function updateGroupAction(formData: FormData): Promise<void> {
  const s = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  return run(`/admin/compat/${id}`, async () => {
    await updateCompatGroup(id, formData.get("label"), formData.get("labelRu"), s.username);
    return "Сохранено.";
  });
}

export async function deleteGroupAction(formData: FormData): Promise<void> {
  const s = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  return run(`/admin/compat/${id}`, async () => {
    await deleteCompatGroup(id, s.username);
    return { go: "/admin/compat", message: "Группа удалена (товары остались в каталоге)." };
  });
}

export async function addSkusAction(formData: FormData): Promise<void> {
  const s = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  const role = formData.get("role") === "HOST" ? "HOST" : "ACCESSORY";
  return run(`/admin/compat/${id}`, async () => {
    const r = await addToCompatGroup(id, role, formData.get("skus"), s.username);
    return `Добавлено: ${r.added}.${r.notFound.length ? ` Не найдены артикулы: ${r.notFound.slice(0, 20).join(", ")}${r.notFound.length > 20 ? "…" : ""}.` : ""}`;
  });
}

export async function removeProductAction(formData: FormData): Promise<void> {
  const s = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  return run(`/admin/compat/${id}`, async () => {
    await removeFromCompatGroup(id, String(formData.get("productId")), formData.get("role") === "HOST" ? "HOST" : "ACCESSORY", s.username);
    return "Убрано из группы.";
  });
}
