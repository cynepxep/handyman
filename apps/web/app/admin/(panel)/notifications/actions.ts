"use server";

import { redirect } from "next/navigation";
import { dailySummaryText, loadNotify, saveNotify, weeklyReportText } from "@handyman/db/jobs";
import { notifyManagers } from "@handyman/db/notify";
import { requirePermission } from "@/lib/auth";

const back = (kind: "ok" | "error", text: string) => `/admin/notifications?${kind}=${encodeURIComponent(text)}`;
const RESULT: Record<string, string> = { SENT: "Отправлено в Telegram.", DEV: "Не отправлено: бот не настроен (нет BOT_TOKEN / ADMIN_CHAT_ID в .env).", FAILED: "Ошибка отправки — проверьте бота и чат." };

export async function saveNotifyAction(formData: FormData): Promise<void> {
  const s = await requirePermission("managers.edit");
  const on = (k: string) => formData.get(k) === "on";
  await saveNotify(
    { daily: on("daily"), dailyHour: Number(formData.get("dailyHour")), weekly: on("weekly"), weeklyHour: Number(formData.get("weeklyHour")), taskReminders: on("taskReminders"), alerts: on("alerts"), showMoney: on("showMoney") },
    s.name || s.username,
  );
  redirect(back("ok", "Сохранено."));
}

/** Отправить сейчас (не ждать вечера) — сводку за сегодня, отчёт за прошлую неделю или проверочное сообщение. */
export async function sendNowAction(formData: FormData): Promise<void> {
  await requirePermission("managers.edit");
  const what = String(formData.get("what") ?? "");
  const s = await loadNotify();
  const text = what === "daily" ? await dailySummaryText(s) : what === "weekly" ? await weeklyReportText(s) : "✅ Проверка: уведомления Handyman работают.";
  const r = await notifyManagers(text);
  redirect(back(r === "SENT" ? "ok" : "error", RESULT[r] ?? r));
}
