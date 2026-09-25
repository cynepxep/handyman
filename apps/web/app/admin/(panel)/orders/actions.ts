"use server";

import { redirect } from "next/navigation";
import type { OrderStatus } from "@handyman/db";
import { ORDER_STATUSES, setOrderStatus, setOrderTtn } from "@handyman/db/orders";
import { requirePermission } from "@/lib/auth";

const back = (id: string, kind: "ok" | "error", text: string) => `/admin/orders/${encodeURIComponent(id)}?${kind}=${encodeURIComponent(text)}`;

/** Сменить статус и/или добавить заметку. Отмена и возврат возвращают товар на наш склад. */
export async function setStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!(ORDER_STATUSES as string[]).includes(status)) redirect(back(id, "error", "Выберите статус из списка."));
  const r = await setOrderStatus(id, status as OrderStatus, session.name || session.username, note || undefined);
  if (!r.ok) redirect(back(id, "error", r.error ?? "Не удалось сохранить."));
  redirect(back(id, "ok", "Сохранено."));
}

export async function setTtnAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  await setOrderTtn(id, String(formData.get("ttn") ?? ""), session.name || session.username);
  redirect(back(id, "ok", "ТТН сохранена."));
}
