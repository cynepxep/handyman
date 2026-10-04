"use server";

import { redirect } from "next/navigation";
import { integrationById } from "@handyman/core/integrations";
import { IntegrationError, checkIntegration, clearIntegrationField, saveIntegration } from "@handyman/db/integrations";
import { requireOwner } from "@/lib/auth";
import { saveAnalyticsSettings } from "@handyman/db/analytics";

const back = (id: string, kind: "ok" | "error", text: string) => `/admin/integrations?${kind}=${encodeURIComponent(text)}&s=${encodeURIComponent(id)}#${encodeURIComponent(id)}`;

/**
 * Обе кнопки формы сначала сохраняют введённое (пустые поля не трогаем — ключ остаётся прежним), потом проверяют подключение.
 * Раньше «Проверить подключение» введённое не сохраняла: владелец вставлял ключ, жал проверку и видел «Не заполнено… заглушка».
 * `requireSomething` — «Сохранить» с пустой формой: сказать, что сохранять нечего.
 */
async function saveAndCheck(formData: FormData, requireSomething: boolean): Promise<void> {
  const s = await requireOwner();
  const who = s.name || s.username;
  const id = String(formData.get("id") ?? "");
  const d = integrationById(id);
  if (!d) redirect("/admin/integrations");
  const values = Object.fromEntries(d.fields.map((f) => [f.key, String(formData.get(`f_${f.key}`) ?? "")]));
  let changed: string[];
  try {
    changed = await saveIntegration(id, values, who);
  } catch (e) {
    if (e instanceof IntegrationError) redirect(back(id, "error", e.message));
    throw e;
  }
  if (!changed.length && requireSomething) redirect(back(id, "error", "Ничего не введено — сохранять нечего."));
  const check = await checkIntegration(id, who);
  redirect(back(id, check.ok ? "ok" : "error", `${changed.length ? "Сохранено. " : ""}${check.message}`));
}

export async function saveIntegrationAction(formData: FormData): Promise<void> {
  await saveAndCheck(formData, true);
}

export async function checkIntegrationAction(formData: FormData): Promise<void> {
  await saveAndCheck(formData, false);
}

/** «Удалить из базы»: сервис снова берёт значение из .env или работает заглушкой. */
export async function clearIntegrationAction(formData: FormData): Promise<void> {
  const s = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  try {
    await clearIntegrationField(id, field, s.name || s.username);
  } catch (e) {
    if (e instanceof IntegrationError) redirect(back(id, "error", e.message));
    throw e;
  }
  redirect(back(id, "ok", "Удалено из базы."));
}

/** Шаг А1: «Аналитика включена» — грузить ли контейнер Google Tag Manager на витрине. */
export async function toggleAnalyticsAction(formData: FormData): Promise<void> {
  const s = await requireOwner();
  const on = formData.get("enabled") === "1";
  await saveAnalyticsSettings(on, s.name || s.username);
  redirect(back("analytics", "ok", on ? "Аналитика включена: контейнер Google Tag Manager загружается на витрине (кроме браузеров с входом в админку)." : "Аналитика выключена: на витрине ничего не загружается."));
}
