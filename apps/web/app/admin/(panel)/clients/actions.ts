"use server";

import { redirect } from "next/navigation";
import { saveLoyalty, updateClient } from "@handyman/db/clients";
import { setBlacklist } from "@handyman/db/np-shipments";
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

/** Шаг 3.4: чёрный список (отказы от посылок) — только полная оплата на сайте. */
export async function setBlacklistAction(formData: FormData): Promise<void> {
  const session = await requirePermission("clients.edit");
  const id = String(formData.get("id") ?? "");
  const on = formData.get("blacklisted") === "on";
  await setBlacklist(id, on, String(formData.get("blacklistNote") ?? ""), session.name || session.username);
  redirect(back(id, "ok", on ? "Покупатель в чёрном списке: на сайте — только полная оплата." : "Покупатель не в чёрном списке."));
}
