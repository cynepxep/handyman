"use server";
// Вход покупателя и кабинет (Этап 5). Ошибки — ключи текстов витрины (переводит клиент).
import { cookies } from "next/headers";
import { finishTgLogin, sendSmsCode, startTgLogin, verifySmsCode } from "@handyman/db/client-auth";
import { setReferrer } from "@handyman/db/clients";
import { prisma } from "@handyman/db";
import { isShopLang } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { TG_LOGIN_COOKIE, getClient, logoutClient, refCodeFromCookie, setClientCookie } from "@/lib/client-auth";

export type TgStart = { link: string } | { error: string };
export type TgCheck = { status: "wait" | "expired" | "ok" };
export type SmsState = { step: "phone" | "code"; phone?: string; error?: string; errorVars?: Record<string, string | number> };

/** Начать вход через Telegram: ссылка на бота; код запоминается в куке этого браузера. */
export async function startTgLoginAction(): Promise<TgStart> {
  const r = await startTgLogin();
  if (!r) return { error: "login.sms.off" };
  (await cookies()).set(TG_LOGIN_COOKIE, r.code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return { link: r.link };
}

/** Сайт спрашивает раз в 2 секунды: подтвердил ли покупатель вход в боте. */
export async function checkTgLoginAction(): Promise<TgCheck> {
  const jar = await cookies();
  const code = jar.get(TG_LOGIN_COOKIE)?.value;
  if (!code) return { status: "expired" };
  const r = await finishTgLogin(code);
  if (r.status !== "ok") return { status: r.status };
  jar.delete(TG_LOGIN_COOKIE);
  await setClientCookie(r.token);
  const ref = await refCodeFromCookie();
  if (ref) await setReferrer(r.clientId, ref).catch(() => false);
  return { status: "ok" };
}

/** SMS-вход: шаг «телефон» → код, шаг «код» → сессия. */
export async function smsLoginAction(prev: SmsState, formData: FormData): Promise<SmsState> {
  const lang = String(formData.get("lang") ?? "uk");
  const { t } = await getShopContent(isShopLang(lang) ? lang : "uk");
  if (formData.get("step") === "code" && prev.phone) {
    const r = await verifySmsCode(prev.phone, String(formData.get("code") ?? ""), await refCodeFromCookie());
    if (!r.ok) return { step: r.error === "phone" ? "phone" : "code", phone: prev.phone, error: r.error === "code" ? "login.err.code" : r.error === "expired" ? "login.err.expired" : "login.err.phone" };
    await setClientCookie(r.token);
    return { step: "code", phone: prev.phone, error: undefined, errorVars: { done: 1 } };
  }
  const r = await sendSmsCode(String(formData.get("phone") ?? prev.phone ?? ""), (code) => t("login.sms.text", { code }));
  if (!r.ok) {
    const key = r.error === "phone" ? "login.err.phone" : r.error === "wait" ? "login.err.wait" : r.error === "limit" ? "login.err.limit" : "login.sms.off";
    return { step: prev.phone && r.error === "wait" ? "code" : "phone", phone: prev.phone, error: key, errorVars: r.sec ? { sec: r.sec } : undefined };
  }
  return { step: "code", phone: r.phone };
}

export async function logoutAction(): Promise<void> {
  await logoutClient();
}

/** «Повторить заказ»: какие товары и сколько (только свой заказ; скрытые/удалённые товары пропускаются). */
export async function repeatOrderAction(no: string): Promise<Array<{ sku: string; qty: number }>> {
  const client = await getClient();
  if (!client) return [];
  const o = await prisma.order.findFirst({ where: { no, clientId: client.id }, select: { items: { select: { sku: true, qty: true, product: { select: { visible: true } } } } } });
  return (o?.items ?? []).filter((i) => i.product?.visible !== false).map((i) => ({ sku: i.sku, qty: i.qty }));
}

/** «Подключить Telegram» из кабинета: одноразовая ссылка на бота (30 минут). */
export async function telegramLinkAction(): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;
  const { telegramLinkFor } = await import("@handyman/db/client-auth");
  return telegramLinkFor(client.id);
}
