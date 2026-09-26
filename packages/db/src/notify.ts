// Сообщения в Telegram: менеджерам (новый заказ, «купити в 1 клік») и покупателям (по шаблонам статусов, шаг 4.2).
// Каждое сообщение сначала пишется в Outbox — так видно, что и когда отправлялось.
// Менеджерам: без BOT_TOKEN и ADMIN_CHAT_ID в .env — режим-заглушка: сообщение сохраняется со статусом DEV и никуда не уходит.
// Покупателю: если он ещё не подключил бота (нет tgId) — статус NO_CHANNEL, менеджер копирует текст в Viber/SMS.
// Токен в журналы не пишется.

import { prisma } from "./client";

export type NotifyResult = "SENT" | "DEV" | "FAILED" | "NO_CHANNEL";

/** Отправить уже сохранённую строку Outbox в Telegram и записать результат. */
async function deliver(rowId: string, token: string, chatId: string, text: string, fetchImpl: typeof fetch): Promise<"SENT" | "FAILED"> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      await prisma.outbox.update({ where: { id: rowId }, data: { state: "SENT", attempts: { increment: 1 }, error: null } });
      return "SENT";
    }
    const body = (await res.text().catch(() => "")).slice(0, 300);
    await prisma.outbox.update({ where: { id: rowId }, data: { state: "FAILED", attempts: { increment: 1 }, error: `Telegram ${res.status}: ${body}` } });
    return "FAILED";
  } catch (e) {
    await prisma.outbox.update({ where: { id: rowId }, data: { state: "FAILED", attempts: { increment: 1 }, error: e instanceof Error ? e.message.slice(0, 300) : "ошибка сети" } });
    return "FAILED";
  }
}

export async function notifyManagers(text: string, orderId?: string, fetchImpl: typeof fetch = fetch): Promise<NotifyResult> {
  const token = process.env.BOT_TOKEN?.trim();
  const chat = process.env.ADMIN_CHAT_ID?.trim();
  const live = Boolean(token && chat);
  const row = await prisma.outbox.create({ data: { chatId: chat || "dev", orderId: orderId ?? null, text, state: live ? "PENDING" : "DEV" } });
  if (!live) {
    console.info(`[notify] режим-заглушка (нет BOT_TOKEN или ADMIN_CHAT_ID): сообщение сохранено, не отправлено`);
    return "DEV";
  }
  return deliver(row.id, token!, chat!, text, fetchImpl);
}

/**
 * Сообщение покупателю от имени магазина. `tgId` — его Telegram (появляется, когда покупатель подключил бота, Этап 5).
 * Нет tgId → NO_CHANNEL (текст виден в заказе, его можно скопировать); нет BOT_TOKEN → DEV.
 */
export async function notifyClient(p: { orderId: string; tgId: bigint | null; text: string; who: string }, fetchImpl: typeof fetch = fetch): Promise<NotifyResult> {
  const token = process.env.BOT_TOKEN?.trim();
  const chatId = p.tgId != null ? String(p.tgId) : "";
  const state = !chatId ? "NO_CHANNEL" : token ? "PENDING" : "DEV";
  const row = await prisma.outbox.create({ data: { audience: "client", who: p.who, chatId: chatId || "none", orderId: p.orderId, text: p.text, state } });
  if (state !== "PENDING") return state;
  return deliver(row.id, token!, chatId, p.text, fetchImpl);
}

/** Повторить неудачную отправку (кнопка в заказе). */
export async function retryOutbox(id: string, fetchImpl: typeof fetch = fetch): Promise<NotifyResult | null> {
  const row = await prisma.outbox.findUnique({ where: { id } });
  const token = process.env.BOT_TOKEN?.trim();
  if (!row || row.state !== "FAILED" || !token) return null;
  return deliver(row.id, token, row.chatId, row.text, fetchImpl);
}
