"use server";

// «Нова Пошта» в админке (шаг 3.4): настройки отправителя и посылки (право «Настройки магазина»), чёрный список (право «Клиенты: изменение»).
import { redirect } from "next/navigation";
import { validateNpParcelForm } from "@handyman/core/shop";
import { saveNpParcel, saveNpSender, saveNpSenderPlace, setBlacklist } from "@handyman/db/np-shipments";
import { requirePermission } from "@/lib/auth";

const back = (tab: string, kind: "ok" | "error", text: string) => `/admin/np?tab=${tab}&${kind}=${encodeURIComponent(text)}`;
const who = (s: { name: string; username: string }) => s.name || s.username;

export async function saveNpParcelAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.edit");
  const check = validateNpParcelForm(Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)])));
  if (!check.ok) redirect(back("settings", "error", check.error));
  await saveNpParcel(check.value, who(session));
  redirect(back("settings", "ok", "Настройки посылки сохранены."));
}

export async function saveNpSenderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.edit");
  const [senderRef, contactRef] = String(formData.get("contact") ?? "").split("|");
  const r = await saveNpSender(senderRef ?? "", contactRef ?? "", who(session));
  redirect(back("settings", r.ok ? "ok" : "error", r.ok ? "Отправитель сохранён." : r.error));
}

export async function saveNpPlaceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.edit");
  const r = await saveNpSenderPlace(String(formData.get("city") ?? ""), String(formData.get("number") ?? ""), who(session));
  redirect(back("settings", r.ok ? "ok" : "error", r.ok ? "Город и отделение отправки сохранены." : r.error));
}

/** Убрать из чёрного списка (со страницы «Чёрный список»). */
export async function unblacklistAction(formData: FormData): Promise<void> {
  const session = await requirePermission("clients.edit");
  await setBlacklist(String(formData.get("client") ?? ""), false, "", who(session));
  redirect(back("blacklist", "ok", "Покупатель убран из чёрного списка."));
}
