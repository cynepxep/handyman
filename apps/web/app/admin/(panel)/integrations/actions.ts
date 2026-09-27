"use server";

import { redirect } from "next/navigation";
import { integrationById } from "@handyman/core/integrations";
import { IntegrationError, checkIntegration, clearIntegrationField, saveIntegration } from "@handyman/db/integrations";
import { requireOwner } from "@/lib/auth";

const back = (id: string, kind: "ok" | "error", text: string) => `/admin/integrations?${kind}=${encodeURIComponent(text)}&s=${encodeURIComponent(id)}#${encodeURIComponent(id)}`;

/** «Сохранить»: пустые поля не трогаем (ключ остаётся прежним). Сразу после сохранения — проверка подключения. */
export async function saveIntegrationAction(formData: FormData): Promise<void> {
  const s = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const d = integrationById(id);
  if (!d) redirect("/admin/integrations");
  const values = Object.fromEntries(d.fields.map((f) => [f.key, String(formData.get(`f_${f.key}`) ?? "")]));
  let changed: string[];
  try {
    changed = await saveIntegration(id, values, s.name || s.username);
  } catch (e) {
    if (e instanceof IntegrationError) redirect(back(id, "error", e.message));
    throw e;
  }
  if (!changed.length) redirect(back(id, "error", "Ничего не введено — сохранять нечего."));
  const check = await checkIntegration(id, s.name || s.username);
  redirect(back(id, check.ok ? "ok" : "error", `Сохранено. ${check.message}`));
}

export async function checkIntegrationAction(formData: FormData): Promise<void> {
  const s = await requireOwner();
  const id = String(formData.get("id") ?? "");
  let r;
  try {
    r = await checkIntegration(id, s.name || s.username);
  } catch (e) {
    if (e instanceof IntegrationError) redirect(back(id, "error", e.message));
    throw e;
  }
  redirect(back(id, r.ok ? "ok" : "error", r.message));
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
