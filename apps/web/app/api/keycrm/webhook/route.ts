// Вебхук KeyCRM (шаг 3.5): смена статуса заказа в KeyCRM → статус на сайте (packages/db/src/keycrm.ts).
// Адрес для KeyCRM: https://<адрес сайта>/api/keycrm/webhook?secret=<секрет вебхука из «Интеграций»>. Секрет можно передать и заголовком
// X-Webhook-Secret или Authorization: Bearer. Без верного секрета — 403.
import { NextResponse, type NextRequest } from "next/server";
import { handleKeycrmWebhook } from "@handyman/db/keycrm";
import { logError } from "@handyman/db/errors";

function secretOf(req: NextRequest): string | null {
  const q = req.nextUrl.searchParams.get("secret");
  if (q) return q;
  const h = req.headers.get("x-webhook-secret");
  if (h) return h;
  const auth = req.headers.get("authorization");
  return auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
}

export async function POST(req: NextRequest) {
  let code = 500;
  try {
    code = await handleKeycrmWebhook(await req.text(), secretOf(req));
  } catch (e) {
    logError("[keycrm:webhook]", e instanceof Error ? e.message : e);
  }
  // 5xx — KeyCRM может повторить позже; 4xx — повторять бессмысленно
  return NextResponse.json({ ok: code === 200 }, { status: code });
}
