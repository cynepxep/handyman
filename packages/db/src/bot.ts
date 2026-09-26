// Бот в Telegram (Этап 5, шаг 5.1): /start, «Поделиться номером» (единый клиент по телефону), «Мои заказы», «Помощь», вход на сайт
// через Telegram (/start login_КОД), приглашения (/start ref_КОД), произвольный текст — менеджерам. Тексты — «Сайт → Тексты», группа «Бот».
// Получение сообщений: на компьютере/сервере без https — долгий опрос (getUpdates) из фоновых задач сайта; на сервере с доменом —
// вебхук /api/telegram/webhook (Этап 8). Читать бота может только одна программа: «аренда» в Setting не даёт двум копиям сайта мешать друг другу.

import { createHash } from "node:crypto";
import { prisma, Prisma } from "./client";
import { TIER_RU, clientDiscountPct, formatPhone, normalizePhone, type TierKey } from "@handyman/core/shop";
import { botLang, mainKeyboard, parseStart, shopUrlFor, whichButton } from "@handyman/core/telegram";
import { fillText, resolveTexts } from "@handyman/core/site";
import { ensureRefCode, linkTelegramPhone, loadLoyalty, setReferrer } from "./clients";
import { loadContacts, loadTextOverrides } from "./site-content";
import { notifyManagers } from "./notify";
import { TelegramError, tg, type TgMessage, type TgUpdate } from "./telegram";

const money = (n: number) => `${n.toLocaleString("uk-UA", { maximumFractionDigits: 2 }).replace(/ /g, " ")} ₴`;

async function textsFor(lang: "uk" | "ru") {
  return resolveTexts(await loadTextOverrides(), lang);
}

async function send(chatId: number, text: string, keyboard?: unknown) {
  await tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...(keyboard ? { reply_markup: keyboard } : {}) });
}

const displayName = (u: { first_name?: string; last_name?: string }) => [u.first_name, u.last_name].filter(Boolean).join(" ").trim();

/** Обработать одно обновление от Telegram. Сообщения из групп (чат менеджеров) не трогаем — только личные. */
export async function handleUpdate(u: TgUpdate): Promise<void> {
  const m = u.message;
  if (!m || !m.from || m.from.is_bot || m.chat.type !== "private") return;
  const tgId = BigInt(m.from.id);
  const client = await prisma.client.findUnique({ where: { tgId }, select: { id: true, phone: true, lang: true, name: true, tier: true, manualDiscountPct: true } });
  const lang = botLang(client?.lang ?? null, m.from.language_code);
  const t = await textsFor(lang);
  const kb = (hasPhone: boolean) => mainKeyboard(t, { hasPhone, shopUrl: shopUrlFor(process.env.PUBLIC_URL, lang) });

  if (m.contact) return onContact(m, t, lang, kb);

  const text = m.text?.trim() ?? "";
  const start = parseStart(text);
  if (start.isStart) {
    if (client) await prisma.client.update({ where: { id: client.id }, data: { tgStartedAt: new Date() } });
    if (start.payload?.kind === "login") return onLogin(m, start.payload.code, t, lang, kb, client);
    if (start.payload?.kind === "ref") {
      await prisma.setting.upsert({ where: { key: `bot.ref.${tgId}` }, update: { value: { code: start.payload.code } }, create: { key: `bot.ref.${tgId}`, value: { code: start.payload.code } } });
      await send(m.chat.id, t["bot.ref.ok"], kb(Boolean(client?.phone)));
      return;
    }
    await send(m.chat.id, t["bot.start"], kb(Boolean(client?.phone)));
    return;
  }

  const both = [await textsFor("uk"), await textsFor("ru")];
  const btn = whichButton(text, both);
  if (btn === "orders") return onOrders(m.chat.id, client, t, lang, kb);
  if (btn === "help") {
    const contacts = await loadContacts();
    await send(m.chat.id, fillText(t["bot.help"], { phone: contacts.phones[0] ?? "" }), kb(Boolean(client?.phone)));
    return;
  }
  if (btn === "phone") {
    await send(m.chat.id, t["bot.orders.needPhone"], kb(false));
    return;
  }
  if (!text) return;
  // произвольный текст — менеджерам (ответ пока вручную: у менеджера видно, кто написал)
  const who = [displayName(m.from), m.from.username ? `@${m.from.username}` : "", client?.phone ? formatPhone(client.phone) : ""].filter(Boolean).join(", ");
  await notifyManagers(`💬 Сообщение в боте от ${who || "покупателя"}:\n${text.slice(0, 1500)}`);
  await send(m.chat.id, t["bot.msg.received"], kb(Boolean(client?.phone)));
}

async function onContact(m: TgMessage, t: Record<string, string>, lang: "uk" | "ru", kb: (hasPhone: boolean) => unknown) {
  const c = m.contact!;
  if (c.user_id !== undefined && c.user_id !== m.from!.id) {
    await send(m.chat.id, t["bot.phone.foreign"], kb(false));
    return;
  }
  const phone = normalizePhone(c.phone_number);
  if (!phone) {
    await send(m.chat.id, t["bot.phone.bad"], kb(false));
    return;
  }
  const tgId = BigInt(m.from!.id);
  const r = await linkTelegramPhone({ tgId, phone, name: displayName(m.from!) || null, username: m.from!.username ?? null, lang: lang === "ru" ? "RU" : "UK" });
  // отложенное приглашение (пришёл по ref-ссылке до того, как поделился номером)
  const refKey = `bot.ref.${tgId}`;
  const ref = await prisma.setting.findUnique({ where: { key: refKey } });
  if (ref) {
    await setReferrer(r.id, String((ref.value as { code?: string })?.code ?? ""));
    await prisma.setting.delete({ where: { key: refKey } }).catch(() => {});
  }
  const client = await prisma.client.findUniqueOrThrow({ where: { id: r.id }, select: { name: true, tier: true, manualDiscountPct: true } });
  const disc = clientDiscountPct({ tier: client.tier as TierKey, manualDiscountPct: client.manualDiscountPct }, await loadLoyalty());
  const lines = [fillText(t["bot.phone.ok"], { name: client.name?.split(" ").slice(-1)[0] || displayName(m.from!) || "", phone: formatPhone(phone) })];
  if (disc.pct > 0) lines.push(fillText(t["bot.phone.level"], { tier: TIER_RU[client.tier as TierKey] ?? client.tier, pct: disc.pct }));
  await send(m.chat.id, lines.join("\n"), kb(true));
  await ensureRefCode(r.id).catch(() => {});
}

async function onOrders(chatId: number, client: { id: string; phone: string | null } | null, t: Record<string, string>, lang: "uk" | "ru", kb: (hasPhone: boolean) => unknown) {
  if (!client?.phone) {
    await send(chatId, t["bot.orders.needPhone"], kb(false));
    return;
  }
  const orders = await prisma.order.findMany({ where: { clientId: client.id, isTest: false }, orderBy: { createdAt: "desc" }, take: 5, select: { no: true, status: true, total: true, ttn: true, createdAt: true } });
  if (!orders.length) {
    await send(chatId, t["bot.orders.none"], kb(true));
    return;
  }
  const lines = [t["bot.orders.title"]];
  for (const o of orders) {
    lines.push(fillText(t["bot.orders.line"], { no: o.no, date: o.createdAt.toLocaleDateString(lang === "ru" ? "ru-RU" : "uk-UA", { timeZone: "Europe/Kyiv" }), status: t[`status.${o.status}`] ?? o.status, sum: money(o.total.toNumber()) }));
    if (o.ttn) lines.push(`   ${fillText(t["bot.orders.ttn"], { ttn: o.ttn })}`);
  }
  await send(chatId, lines.join("\n"), kb(true));
}

async function onLogin(m: TgMessage, code: string, t: Record<string, string>, lang: "uk" | "ru", kb: (hasPhone: boolean) => unknown, client: { id: string; phone: string | null } | null) {
  const row = await prisma.tgLogin.findUnique({ where: { code } });
  if (!row || row.expiresAt < new Date() || row.usedAt) {
    await send(m.chat.id, t["bot.login.expired"], kb(Boolean(client?.phone)));
    return;
  }
  const tgId = BigInt(m.from!.id);
  const id = client?.id ?? (await prisma.client.create({ data: { tgId, name: displayName(m.from!) || null, username: m.from!.username ?? null, lang: lang === "ru" ? "RU" : "UK", tgStartedAt: new Date() } })).id;
  await prisma.tgLogin.update({ where: { code }, data: { clientId: id, confirmedAt: new Date() } });
  await send(m.chat.id, t["bot.login.ok"], kb(Boolean(client?.phone)));
}

// ---------- долгий опрос (getUpdates) с «арендой» ----------

const LEASE_KEY = "bot.lease";
const OFFSET_KEY = "bot.offset";
const LEASE_MS = 90_000;

/** Взять/продлить «аренду» чтения бота. true — читаем мы; false — читает другая копия сайта. */
export async function claimBotLease(owner: string, now = Date.now()): Promise<boolean> {
  const value = JSON.stringify({ owner, until: now + LEASE_MS });
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "Setting" ("key", "value") VALUES (${LEASE_KEY}, ${value}::jsonb)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
    WHERE ("Setting"."value"->>'until')::bigint < ${now} OR "Setting"."value"->>'owner' = ${owner}
    RETURNING "key"`;
  return rows.length > 0;
}

export async function releaseBotLease(owner: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "Setting" WHERE "key" = ${LEASE_KEY} AND "value"->>'owner' = ${owner}`;
}

/** Один цикл опроса: забрать новые сообщения (до 25 секунд ожидания) и обработать. Возвращает, сколько обработано. */
export async function pollOnce(owner: string, waitSec = 25): Promise<number> {
  if (!(await claimBotLease(owner))) return -1;
  const saved = await prisma.setting.findUnique({ where: { key: OFFSET_KEY } });
  const offset = Number((saved?.value as { offset?: number } | undefined)?.offset ?? 0);
  const updates = await tg<TgUpdate[]>("getUpdates", { offset, timeout: waitSec, allowed_updates: ["message"] }, (waitSec + 10) * 1000);
  for (const u of updates) {
    try {
      await handleUpdate(u);
    } catch (e) {
      console.error("[bot] ошибка обработки:", e instanceof Error ? e.message : e);
    }
    const next = { offset: u.update_id + 1 } as unknown as Prisma.InputJsonValue;
    await prisma.setting.upsert({ where: { key: OFFSET_KEY }, update: { value: next }, create: { key: OFFSET_KEY, value: next } });
  }
  return updates.length;
}

/** Секрет вебхука (заголовок X-Telegram-Bot-Api-Secret-Token) — производный от токена, сам токен не раскрывается. */
export function webhookSecret(): string | null {
  const token = process.env.BOT_TOKEN?.trim();
  return token ? createHash("sha256").update(`webhook:${token}`).digest("hex").slice(0, 48) : null;
}

export { TelegramError };
