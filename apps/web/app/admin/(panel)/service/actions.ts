"use server";

import { redirect } from "next/navigation";
import { createServiceCase, updateServiceCase } from "@handyman/db/service";
import { SERVICE_STATUSES, validateServiceCase, type ServiceStatus } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";

const who = (s: { name: string; username: string }) => s.name || s.username;

export async function createServiceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const check = validateServiceCase(Object.fromEntries(formData));
  const back = (t: string) => `/admin/service/new?order=${encodeURIComponent(String(formData.get("orderNo") ?? ""))}&error=${encodeURIComponent(t)}`;
  if (!check.ok) redirect(back(check.error));
  const r = await createServiceCase(check.value, who(session));
  if (!r.ok) redirect(back(r.error));
  redirect(`/admin/service/${r.id}?ok=${encodeURIComponent(`Обращение С-${r.seq} принято.`)}`);
}

export async function updateServiceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!(SERVICE_STATUSES as readonly string[]).includes(status)) redirect(`/admin/service/${id}?error=${encodeURIComponent("Выберите статус.")}`);
  const r = await updateServiceCase(
    id,
    { status: status as ServiceStatus, resolution: String(formData.get("resolution") ?? "") || undefined, note: String(formData.get("note") ?? ""), message: formData.get("send") === "on" ? String(formData.get("message") ?? "") : undefined },
    who(session),
  );
  if (!r.ok) redirect(`/admin/service/${id}?error=${encodeURIComponent(r.error ?? "Не удалось сохранить.")}`);
  const sent = r.sent === "SENT" ? " Сообщение отправлено в Telegram." : r.sent === "NO_CHANNEL" ? " Покупатель без бота — скопируйте сообщение из истории." : r.sent === "DEV" ? " Бот не настроен — сообщение не отправлено." : r.sent === "FAILED" ? " Ошибка отправки сообщения." : "";
  redirect(`/admin/service/${id}?ok=${encodeURIComponent(`Сохранено.${sent}`)}`);
}
