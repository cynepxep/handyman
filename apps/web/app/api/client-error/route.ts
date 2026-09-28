// Ошибки в браузере покупателя (шаг 8.2): «Щось пішло не так» витрины и экран ошибки админки присылают сюда короткое описание.
// Лимит (шаг 8.3, в базе): не больше 10 сообщений в минуту с одного адреса и 120 в минуту всего.
// Ошибки сервера (у них есть digest) уже записал onRequestError — второй раз не пишем. Тексты маскирует журнал.
import { NextResponse, type NextRequest } from "next/server";
import { recordError } from "@handyman/db/errors";
import { rateHit } from "@handyman/db/rate-limit";
import { ipFrom } from "@/lib/request-ip";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: NextRequest) {
  if (!(await rateHit("clientError", ipFrom(req.headers))).ok || !(await rateHit("clientErrorAll", "*")).ok) return new NextResponse(null, { status: 429 });
  const raw = await req.text().catch(() => "");
  if (raw.length > 8192) return new NextResponse(null, { status: 413 });
  let b: Record<string, unknown> = {};
  try {
    b = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const message = str(b.message, 1000);
  if (!message || str(b.digest, 60)) return new NextResponse(null, { status: 204 });
  const area = b.area === "admin" ? "админка" : "витрина";
  recordError({ source: "browser", where: area, message, stack: str(b.stack, 4000), url: str(b.url, 500) || req.headers.get("referer") });
  return new NextResponse(null, { status: 204 });
}
