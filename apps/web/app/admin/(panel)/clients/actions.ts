"use server";

import { redirect } from "next/navigation";
import { blockPhone, saveLoyalty, setClientBlocked, updateClient } from "@handyman/db/clients";
import { normalizePhone, validateClientEdit, type LoyaltyLevel } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { shopChanged } from "@/lib/shop/cache";

const back = (id: string, kind: "ok" | "error", text: string) => `/admin/clients/${encodeURIComponent(id)}?${kind}=${encodeURIComponent(text)}`;

/** Сохранить карточку клиента: контакты, язык, заметка, личная скидка, «Опт». */
export async function saveClientAction(formData: FormData): Promise<void> {
  const session = await requirePermission("clients.edit");
  const id = String(formData.get("id") ?? "");
  const check = validateClientEdit(Object.fromEntries(formData), normalizePhone);
  if (!check.ok) redirect(back(id, "error", check.error));
  const r = await updateClient(id, check.value, session.name || session.username);
  if (!r.ok) redirect(back(id, "error", r.error));
  redirect(back(id, "ok", r.changed ? "Сохранено." : "Изменений нет."));
}

/** Шаг 8.3: чёрный список — заблокировать / разблокировать покупателя (заказы помечаются «подозрительный», в KeyCRM сами не уходят). */
export async function blockClientAction(formData: FormData): Promise<void> {
  const session = await requirePermission("clients.edit");
  const id = String(formData.get("id") ?? "");
  const on = formData.get("blocked") === "1";
  const r = await setClientBlocked(id, on, String(formData.get("note") ?? ""), session.name || session.username);
  if (!r.ok) redirect(back(id, "error", r.error ?? "Не получилось."));
  redirect(back(id, "ok", on ? "Клиент в чёрном списке: его новые заказы будут с отметкой «подозрительный»." : "Клиент убран из чёрного списка."));
}

/** Шаг 8.3: заблокировать номер, по которому ещё не было заказов (со страницы «Клиенты» → «чёрный список»). */
export async function blockPhoneAction(formData: FormData): Promise<void> {
  const session = await requirePermission("clients.edit");
  const r = await blockPhone(String(formData.get("phone") ?? ""), String(formData.get("note") ?? ""), session.name || session.username);
  if (!r.ok) redirect(`/admin/clients?blocked=1&error=${encodeURIComponent(r.error)}`);
  redirect(`/admin/clients?blocked=1&ok=${encodeURIComponent("Номер добавлен в чёрный список.")}`);
}

/** Настройки уровней: включить/выключить, пороги и скидки, процент «Опт». Сохранение пересчитывает уровни всех клиентов. */
export async function saveLevelsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.edit");
  const num = (k: string) => Number(String(formData.get(k) ?? "").replace(",", ".").replace(/\s/g, ""));
  const keys: LoyaltyLevel["key"][] = ["START", "MASTER", "PRO", "LEGEND"];
  const levels = keys.map((key) => ({ key, min: key === "START" ? 0 : num(`min_${key}`), pct: num(`pct_${key}`) }));
  for (let i = 1; i < levels.length; i++) {
    if (!Number.isFinite(levels[i].min) || levels[i].min <= levels[i - 1].min)
      redirect(`/admin/clients/levels?error=${encodeURIComponent("Пороги должны расти: у каждого следующего уровня сумма больше, чем у предыдущего.")}`);
  }
  await saveLoyalty({ enabled: formData.get("enabled") === "on", levels, wholesalePct: num("wholesalePct") }, session.name || session.username);
  shopChanged();
  redirect(`/admin/clients/levels?ok=${encodeURIComponent("Сохранено. Уровни клиентов пересчитаны.")}`);
}
