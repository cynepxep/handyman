// Сообщения менеджерам в Telegram (новый заказ, «купити в 1 клік»). Каждое сообщение сначала пишется в Outbox —
// так видно, что и когда отправлялось. Без BOT_TOKEN и ADMIN_CHAT_ID в .env — режим-заглушка: сообщение сохраняется
// со статусом DEV и никуда не уходит (заказ при этом создаётся как обычно). Токен в журналы не пишется.

import { prisma } from "./client";

export type NotifyResult = "SENT" | "DEV" | "FAILED";

export async function notifyManagers(text: string, orderId?: string, fetchImpl: typeof fetch = fetch): Promise<NotifyResult> {
  const token = process.env.BOT_TOKEN?.trim();
  const chat = process.env.ADMIN_CHAT_ID?.trim();
  const live = Boolean(token && chat);
  const row = await prisma.outbox.create({ data: { chatId: chat || "dev", orderId: orderId ?? null, text, state: live ? "PENDING" : "DEV" } });
  if (!live) {
    console.info(`[notify] режим-заглушка (нет BOT_TOKEN или ADMIN_CHAT_ID): сообщение сохранено, не отправлено`);
    return "DEV";
  }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      await prisma.outbox.update({ where: { id: row.id }, data: { state: "SENT", attempts: 1 } });
      return "SENT";
    }
    const body = (await res.text().catch(() => "")).slice(0, 300);
    await prisma.outbox.update({ where: { id: row.id }, data: { state: "FAILED", attempts: 1, error: `Telegram ${res.status}: ${body}` } });
    return "FAILED";
  } catch (e) {
    await prisma.outbox.update({ where: { id: row.id }, data: { state: "FAILED", attempts: 1, error: e instanceof Error ? e.message.slice(0, 300) : "ошибка сети" } });
    return "FAILED";
  }
}
