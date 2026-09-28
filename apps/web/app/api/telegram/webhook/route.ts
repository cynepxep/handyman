// Вебхук бота (Этап 5; включается на сервере с доменом — Этап 8: setWebhook с secret_token = webhookSecret(), BOT_WEBHOOK=on).
// Telegram присылает сюда сообщения; без правильного секрета в заголовке — отказ.
import { NextResponse, type NextRequest } from "next/server";
import { handleUpdate, webhookSecret } from "@handyman/db/bot";
import { logError } from "@handyman/db/errors";

export async function POST(req: NextRequest) {
  const secret = await webhookSecret();
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return new NextResponse("forbidden", { status: 403 });
  try {
    await handleUpdate(await req.json());
  } catch (e) {
    logError("[bot:webhook]", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true }); // Telegram не повторяет, если ответ 200
}
