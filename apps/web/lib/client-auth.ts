import "server-only";
// Сессия покупателя на витрине (Этап 5): кука hm_client (30 дней, только сервер). Вход — через Telegram, SMS или автоматически в Mini App.
import { cookies } from "next/headers";
import { clientBySession, endClientSession } from "@handyman/db/client-auth";
import { CLIENT_SESSION_TTL_MS } from "@handyman/core";

export const CLIENT_COOKIE = "hm_client";
export const TG_LOGIN_COOKIE = "hm_tglogin"; // код входа через Telegram — только у того браузера, который начал вход
export const REF_COOKIE = "hm_ref"; // код приглашения из ссылки ?ref=

const secure = () => process.env.NODE_ENV === "production";

export async function getClient() {
  const jar = await cookies();
  return clientBySession(jar.get(CLIENT_COOKIE)?.value).catch(() => null);
}

export async function setClientCookie(token: string) {
  (await cookies()).set(CLIENT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: CLIENT_SESSION_TTL_MS / 1000 });
}

export async function logoutClient() {
  const jar = await cookies();
  await endClientSession(jar.get(CLIENT_COOKIE)?.value);
  jar.delete(CLIENT_COOKIE);
}

export async function refCodeFromCookie(): Promise<string | null> {
  return (await cookies()).get(REF_COOKIE)?.value ?? null;
}
