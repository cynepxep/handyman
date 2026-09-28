// Уведомление monobank об оплате (шаг 3.2). Адрес передаётся в счёте, только когда у сайта есть https-адрес (PUBLIC_URL, Этап 8).
// Тело подписано ключом mono (заголовок X-Sign) — без верной подписи отказ; статус применяется один раз (packages/db/src/payments.ts).
import { NextResponse, type NextRequest } from "next/server";
import { handleMonoWebhook } from "@handyman/db/payments";
import { logError } from "@handyman/db/errors";

export async function POST(req: NextRequest) {
  let code = 500;
  try {
    code = await handleMonoWebhook(await req.text(), req.headers.get("x-sign"));
  } catch (e) {
    logError("[pay:mono]", e instanceof Error ? e.message : e);
  }
  // 5xx — mono повторит уведомление позже; 4xx — нет смысла повторять
  return NextResponse.json({ ok: code === 200 }, { status: code });
}
