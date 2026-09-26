"use server";

import { redirect } from "next/navigation";
import type { OrderStatus } from "@handyman/db";
import { ORDER_STATUSES, setOrderStatus, setOrderTtn } from "@handyman/db/orders";
import { sendOrderMessages } from "@handyman/db/messages";
import { retryOutbox } from "@handyman/db/notify";
import { requirePermission } from "@/lib/auth";

const back = (id: string, kind: "ok" | "error", text: string) => `/admin/orders/${encodeURIComponent(id)}?${kind}=${encodeURIComponent(text)}`;

/** Сменить статус и/или добавить заметку, затем отправить выбранные сообщения покупателю. Отмена и возврат возвращают товар на наш склад. */
export async function setStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const who = session.name || session.username;
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!(ORDER_STATUSES as string[]).includes(status)) redirect(back(id, "error", "Выберите статус из списка."));
  const r = await setOrderStatus(id, status as OrderStatus, who, note || undefined);
  if (!r.ok) redirect(back(id, "error", r.error ?? "Не удалось сохранить."));
  const templateIds = formData.getAll("tpl").map(String).filter(Boolean);
  const customText = String(formData.get("custom") ?? "");
  if (!templateIds.length && !customText.trim()) redirect(back(id, "ok", "Сохранено."));
  const rep = await sendOrderMessages(id, { templateIds, customText }, who);
  const parts = [
    rep.sent && `отправлено в Telegram: ${rep.sent}`,
    rep.noChannel && `сохранено для копирования (покупатель ещё без бота): ${rep.noChannel}`,
    rep.dev && `не отправлено — бот не настроен: ${rep.dev}`,
    rep.failed && `ошибка отправки: ${rep.failed}`,
  ].filter(Boolean);
  redirect(back(id, rep.failed ? "error" : "ok", `Сохранено. Сообщения: ${parts.join("; ")}.`));
}

export async function setTtnAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  await setOrderTtn(id, String(formData.get("ttn") ?? ""), session.name || session.username);
  redirect(back(id, "ok", "ТТН сохранена."));
}

/** Повторить неудачную отправку сообщения. */
export async function retryMessageAction(formData: FormData): Promise<void> {
  await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const r = await retryOutbox(String(formData.get("msg") ?? ""));
  redirect(back(id, r === "SENT" ? "ok" : "error", r === "SENT" ? "Сообщение отправлено." : "Не удалось отправить — проверьте настройки бота."));
}
