"use server";

import { redirect } from "next/navigation";
import { validateWarehouseForm } from "@handyman/core/shop";
import { deleteWarehouse, saveWarehouse } from "@handyman/db/warehouses";
import { requirePermission } from "@/lib/auth";
import { shopChanged } from "@/lib/shop/cache";

const back = (kind: "ok" | "error", text: string, anchor = "") => `/admin/warehouses?${kind}=${encodeURIComponent(text)}${anchor ? `#${anchor}` : ""}`;

/** Сохранить точку: `id` пустой — новая. */
export async function saveWarehouseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.edit");
  const input: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") input[k] = v;
  const id = input.id || null;
  const r = validateWarehouseForm(input);
  if (!r.ok) redirect(back("error", r.error, id ? `w-${id}` : "new"));
  const saved = await saveWarehouse(id, r.value, session.username);
  shopChanged();
  redirect(back("ok", id ? "Сохранено." : "Точка добавлена.", `w-${saved}`));
}

export async function deleteWarehouseAction(id: string): Promise<void> {
  const session = await requirePermission("settings.edit");
  const r = await deleteWarehouse(id, session.username);
  if (!r.ok) redirect(back("error", r.error, `w-${id}`));
  shopChanged();
  redirect(back("ok", "Точка удалена."));
}
