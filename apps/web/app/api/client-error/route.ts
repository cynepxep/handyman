// Ошибки в браузере покупателя (шаг 8.2): «Щось пішло не так» витрины и экран ошибки админки присылают сюда короткое описание.
// Лимит — не больше 10 сообщений в минуту с одного адреса и 120 в минуту всего (в памяти; общий лимит в базе — шаг 8.3).
// Ошибки сервера (у них есть digest) уже записал onRequestError — второй раз не пишем. Тексты маскирует журнал.
import { NextResponse, type NextRequest } from "next/server";
import { recordError } from "@handyman/db/errors";

const g = globalThis as unknown as { hmClientErr?: { minute: number; total: number; byIp: Map<string, number> } };

function tooMany(ip: string): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const w = (g.hmClientErr = g.hmClientErr?.minute === minute ? g.hmClientErr : { minute, total: 0, byIp: new Map() });
  const n = (w.byIp.get(ip) ?? 0) + 1;
  w.byIp.set(ip, n);
  w.total++;
  return n > 10 || w.total > 120;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  if (tooMany(ip)) return new NextResponse(null, { status: 429 });
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
