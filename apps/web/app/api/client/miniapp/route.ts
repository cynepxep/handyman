// Вход в Mini App (Этап 5): страница внутри Telegram присылает initData — проверяем подпись Telegram и ставим куку покупателя.
import { NextResponse, type NextRequest } from "next/server";
import { miniAppLogin } from "@handyman/db/client-auth";
import { setReferrer } from "@handyman/db/clients";
import { CLIENT_COOKIE, REF_COOKIE } from "@/lib/client-auth";
import { CLIENT_SESSION_TTL_MS } from "@handyman/core";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { initData?: string };
  const r = await miniAppLogin(String(body.initData ?? "").slice(0, 4096));
  if (!r.ok) return NextResponse.json({ ok: false }, { status: 401 });
  const ref = req.cookies.get(REF_COOKIE)?.value;
  if (ref) await setReferrer(r.clientId, ref).catch(() => false);
  const res = NextResponse.json({ ok: true });
  // внутри Telegram страница открывается во встроенном браузере — кука «SameSite=None; Secure», иначе он её не сохранит
  res.cookies.set(CLIENT_COOKIE, r.token, { httpOnly: true, sameSite: "none", secure: true, path: "/", maxAge: CLIENT_SESSION_TTL_MS / 1000 });
  return res;
}
