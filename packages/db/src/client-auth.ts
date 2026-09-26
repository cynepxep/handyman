// Вход покупателя на сайт (Этап 5, шаг 5.3): через Telegram (код → бот → сайт), по SMS-коду, автоматически в Mini App (подпись Telegram).
// Сессия — ClientSession (30 дней). Кука ставится в apps/web/lib/client-auth.ts. SMS-провайдер — «Интеграции» (Этап 3); без него на компьютере
// разработчика — режим-заглушка (код пишется в журнал сервера), на сервере (production) SMS-вход выключен.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { prisma } from "./client";
import { CLIENT_SESSION_TTL_MS } from "@handyman/core";
import { normalizePhone } from "@handyman/core/shop";
import { verifyInitData } from "@handyman/core/telegram";
import { ensureTgClient, setReferrer } from "./clients";
import { tg } from "./telegram";

const TG_LOGIN_MS = 10 * 60_000;
const SMS_TTL_MS = 5 * 60_000;
const SMS_RESEND_SEC = 60;
const SMS_PER_HOUR = 5;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------- сессии ----------

export async function createClientSession(clientId: string, via: "telegram" | "miniapp" | "sms"): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await prisma.clientSession.create({ data: { token, clientId, via, expiresAt: new Date(Date.now() + CLIENT_SESSION_TTL_MS) } });
  return token;
}

export async function clientBySession(token: string | undefined) {
  if (!token) return null;
  const s = await prisma.clientSession.findUnique({
    where: { token },
    include: { client: { select: { id: true, name: true, phone: true, email: true, tgId: true, username: true, lang: true, tier: true, spent: true, manualDiscountPct: true, refCode: true } } },
  });
  if (!s || s.expiresAt < new Date()) {
    if (s) await prisma.clientSession.delete({ where: { token } }).catch(() => {});
    return null;
  }
  return s.client;
}

export async function endClientSession(token: string | undefined): Promise<void> {
  if (token) await prisma.clientSession.delete({ where: { token } }).catch(() => {});
}

// ---------- через Telegram ----------

let botUsernameCache: string | null = null;

/** Имя бота (@…) — для ссылки t.me/<бот>?start=login_КОД. Берётся у Telegram один раз и запоминается. */
export async function botUsername(): Promise<string | null> {
  if (botUsernameCache) return botUsernameCache;
  const saved = await prisma.setting.findUnique({ where: { key: "bot.username" } });
  if (saved) return (botUsernameCache = String((saved.value as { username?: string }).username ?? "") || null);
  try {
    const me = await tg<{ username: string }>("getMe");
    botUsernameCache = me.username;
    await prisma.setting.upsert({ where: { key: "bot.username" }, update: { value: { username: me.username } }, create: { key: "bot.username", value: { username: me.username } } });
    return me.username;
  } catch {
    return null;
  }
}

/** Начать вход через Telegram: код на 10 минут и ссылка на бота. */
export async function startTgLogin(): Promise<{ code: string; link: string } | null> {
  const bot = await botUsername();
  if (!bot) return null;
  const code = randomBytes(12).toString("base64url");
  await prisma.tgLogin.create({ data: { code, expiresAt: new Date(Date.now() + TG_LOGIN_MS) } });
  return { code, link: `https://t.me/${bot}?start=login_${code}` };
}

/** Сайт ждёт: бот подтвердил код? Тогда — сессия (один раз). */
export async function finishTgLogin(code: string): Promise<{ status: "wait" | "expired" } | { status: "ok"; token: string; clientId: string }> {
  const row = await prisma.tgLogin.findUnique({ where: { code } });
  if (!row || row.expiresAt < new Date() || row.usedAt) return { status: "expired" };
  if (!row.confirmedAt || !row.clientId) return { status: "wait" };
  const upd = await prisma.tgLogin.updateMany({ where: { code, usedAt: null }, data: { usedAt: new Date() } });
  if (!upd.count) return { status: "expired" };
  return { status: "ok", token: await createClientSession(row.clientId, "telegram"), clientId: row.clientId };
}

// ---------- Mini App ----------

/** Вход в Mini App: проверяем подпись Telegram (initData) и выдаём сессию «телеграм-клиенту». */
export async function miniAppLogin(initData: string): Promise<{ ok: true; token: string; clientId: string } | { ok: false; error: string }> {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: "бот не настроен" };
  const v = verifyInitData(initData, token);
  if (!v.ok) return v;
  const c = await ensureTgClient({
    tgId: BigInt(v.user.id), name: [v.user.first_name, v.user.last_name].filter(Boolean).join(" ") || null, username: v.user.username ?? null,
    lang: v.user.language_code?.startsWith("ru") ? "RU" : "UK",
  });
  return { ok: true, token: await createClientSession(c.id, "miniapp"), clientId: c.id };
}

// ---------- по SMS ----------

export type SmsSender = (phone: string, text: string) => Promise<void>;
let smsSender: SmsSender | null = null;
/** Подключить отправку SMS (провайдер — в «Интеграциях», Этап 3; в тестах — подмена). */
export const setSmsSender = (f: SmsSender | null) => {
  smsSender = f;
};

/** Можно ли входить по SMS: есть провайдер или это компьютер разработчика (код — в журнал сервера). */
export const smsLoginAvailable = () => Boolean(smsSender) || process.env.NODE_ENV !== "production";

/** Отправить код: не чаще раза в минуту и не больше 5 в час на номер. */
export async function sendSmsCode(rawPhone: string, textFor: (code: string) => string): Promise<{ ok: true; phone: string } | { ok: false; error: "phone" | "wait" | "limit" | "off"; sec?: number }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "phone" };
  if (!smsLoginAvailable()) return { ok: false, error: "off" };
  const recent = await prisma.smsCode.findMany({ where: { phone, createdAt: { gte: new Date(Date.now() - 3600_000) } }, orderBy: { createdAt: "desc" } });
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < SMS_RESEND_SEC * 1000) {
    return { ok: false, error: "wait", sec: Math.ceil(SMS_RESEND_SEC - (Date.now() - recent[0].createdAt.getTime()) / 1000) };
  }
  if (recent.length >= SMS_PER_HOUR) return { ok: false, error: "limit" };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.smsCode.create({ data: { phone, codeHash: hash(`${phone}:${code}`), expiresAt: new Date(Date.now() + SMS_TTL_MS) } });
  if (smsSender) await smsSender(phone, textFor(code));
  else console.info(`[sms] режим-заглушка: код для ${phone} — ${code}`);
  return { ok: true, phone };
}

/** Проверить код и войти: покупатель находится по телефону (или создаётся). До 5 попыток на код. */
export async function verifySmsCode(rawPhone: string, code: string, refCode?: string | null): Promise<{ ok: true; token: string; clientId: string } | { ok: false; error: "phone" | "code" | "expired" }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: "phone" };
  const row = await prisma.smsCode.findFirst({ where: { phone, usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!row || row.expiresAt < new Date() || row.attempts >= 5) return { ok: false, error: "expired" };
  if (row.codeHash !== hash(`${phone}:${code.replace(/\D/g, "")}`)) {
    await prisma.smsCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "code" };
  }
  await prisma.smsCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  const client = (await prisma.client.findUnique({ where: { phone }, select: { id: true } })) ?? (await prisma.client.create({ data: { phone }, select: { id: true } }));
  if (refCode) await setReferrer(client.id, refCode);
  return { ok: true, token: await createClientSession(client.id, "sms"), clientId: client.id };
}

// ---------- привязать Telegram к кабинету (вошёл по SMS) ----------

/** Ссылка t.me/<бот>?start=link_КОД (30 минут): бот привяжет Telegram к этому покупателю. */
export async function telegramLinkFor(clientId: string): Promise<string | null> {
  const bot = await botUsername();
  if (!bot) return null;
  const code = randomBytes(12).toString("base64url");
  await prisma.linkCode.create({ data: { code, clientId, expiresAt: new Date(Date.now() + 30 * 60_000) } });
  return `https://t.me/${bot}?start=link_${code}`;
}
