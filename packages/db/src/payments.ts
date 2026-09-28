// Оплата картой через monobank (шаг 3.2): счёт на предоплату / всю сумму / доплату, статус оплаты, возврат.
// Статус узнаём тремя путями: уведомление mono на /api/pay/mono (нужен https-адрес сайта, PUBLIC_URL; подпись проверяется),
// опрос mono раз в минуту из фоновых задач (работает и без адреса), кнопка «Я сплатив, перевірити» у покупателя.
// Без токена mono: на компьютере разработки — тестовые счета («заглушка», оплата кнопкой «Тест: імітувати оплату»),
// в production — онлайн-оплаты нет, как до шага 3.2 (ссылку присылает менеджер).
// Правила (суммы, разбор ответов) — @handyman/core/shop (payments.ts); ключ — только через secret("mono.token").
// Шаг 3.3: каждое изменение оплаты ставит кассовый чек Checkbox (продажа / возврат) — receipts.ts.

import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { prisma, Prisma } from "./client";
import {
  INVOICE_KIND_RU, INVOICE_VALIDITY_SEC, MONO_PENDING, creditedOf, invoiceRequest, isFinal, isStale, monoErrorText, monoWebhookUrl, pollDue,
  readCreateResponse, readMonoInvoice, sitePayTarget, toKop, unpaidOf, type InvoiceKind, type MonoInvoiceData, type MonoStatus,
} from "@handyman/core/shop";
import { fillText, paths, resolveTexts, shopHref } from "@handyman/core/site";
import { secret } from "./integrations";
import { loadTextOverrides } from "./site-content";
import { notifyManagers } from "./notify";
import { loadCheckoutSettings, setOrderStatus } from "./orders";
import { sendAutoMessages, sendOrderMessages } from "./messages";
import { queuePaymentReceiptTx, receiptMode, sendReceipt } from "./receipts";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;
const tail = (id: string) => `…${id.slice(-6)}`;

// ---------- режим и запросы к mono ----------

export type MonoMode = "live" | "stub" | "off";

/** live — токен есть; stub — нет токена, но это не production (тестовая оплата); off — онлайн-оплаты нет. */
export async function monoMode(): Promise<MonoMode> {
  if (await secret("mono.token")) return "live";
  return process.env.NODE_ENV === "production" ? "off" : "stub";
}

/** Оплата картой на сайте (кнопка «Сплатити» у покупателя): только при галочке «Оплата картой на сайте» в «Сайт → Оформление заказа».
 *  Счета менеджера из заказа от неё не зависят (там — monoMode). */
export async function sitePayMode(): Promise<MonoMode> {
  return (await loadCheckoutSettings()).onlinePay ? monoMode() : "off";
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Для тестов: подменить запросы к mono (null — обычный fetch). */
export const setPaymentsFetch = (f: FetchLike | null) => {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
  pubKey = null;
};

const monoBase = () => (process.env.MONO_BASE?.trim() || "https://api.monobank.ua").replace(/\/+$/, "");

export class PaymentError extends Error {}

async function mono(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ status: number; body: unknown }> {
  const token = await secret("mono.token");
  if (!token) throw new PaymentError("Онлайн-оплата не подключена: впишите токен monobank в «Интеграциях».");
  try {
    const res = await fetchImpl(`${monoBase()}${path}`, {
      method: init.method,
      headers: { "X-Token": token, accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new PaymentError(timeout ? "monobank не ответил за 15 секунд — попробуйте ещё раз." : "Не удалось связаться с monobank (нет интернета или сервис недоступен).");
  }
}

// ---------- подпись уведомлений ----------

let pubKey: { token: string; pem: string; at: number } | null = null;

/** Открытый ключ мерчанта. Заново (ключ мог смениться) — не чаще раза в 10 минут: поддельные уведомления не заставят дёргать mono. */
async function monoPubKey(fresh: boolean): Promise<string | null> {
  const token = await secret("mono.token");
  if (!token) return null;
  if (pubKey?.token === token && (!fresh || Date.now() - pubKey.at < 10 * 60_000)) return pubKey.pem;
  const r = await mono("/api/merchant/pubkey", { method: "GET" }).catch(() => null);
  const key = (r?.body as { key?: unknown } | null)?.key;
  if (!r || r.status !== 200 || typeof key !== "string") return pubKey?.token === token ? pubKey.pem : null;
  pubKey = { token, pem: Buffer.from(key, "base64").toString("utf8"), at: Date.now() };
  return pubKey.pem;
}

const signatureOk = (raw: string, sign: string, pem: string) => {
  try {
    return verifySignature("sha256", Buffer.from(raw, "utf8"), createPublicKey(pem), Buffer.from(sign, "base64"));
  } catch {
    return false;
  }
};

/** Подпись X-Sign — ECDSA (SHA-256) тела уведомления открытым ключом мерчанта. Ключ мог смениться — при неудаче берём его заново. */
export async function verifyMonoSignature(raw: string, sign: string): Promise<boolean> {
  if (!sign) return false;
  const pem = await monoPubKey(false);
  if (pem && signatureOk(raw, sign, pem)) return true;
  const again = await monoPubKey(true);
  return again != null && again !== pem && signatureOk(raw, sign, again);
}

// ---------- тексты для банка и покупателя ----------

type OrderLite = { id: string; no: string; accessKey: string | null; lang: "UK" | "RU" | null };
const langOf = (o: { lang: "UK" | "RU" | null }) => (o.lang === "RU" ? "ru" : "uk");

async function textsFor(lang: "uk" | "ru") {
  return resolveTexts(await loadTextOverrides(), lang);
}

/** Полный адрес страницы заказа («Дякуємо») — туда mono возвращает покупателя после оплаты. */
export function orderPageUrl(o: OrderLite, origin: string): string {
  const base = (process.env.PUBLIC_URL?.trim() || origin).replace(/\/+$/, "");
  return `${base}${shopHref(langOf(o), paths.order(o.no, o.accessKey ?? ""))}`;
}

// ---------- счёт ----------

export type CreatedInvoice = { id: string; pageUrl: string; amount: number; stub: boolean };

/** Выставить счёт на `amount` ₴. Сумму уже проверил вызывающий (с сайта — sitePayTarget, менеджер — не больше неоплаченного). */
async function createInvoice(orderId: string, p: { kind: InvoiceKind; amount: number; who: string; origin: string }): Promise<CreatedInvoice> {
  const mode = await monoMode();
  if (mode === "off") throw new PaymentError("Онлайн-оплата не подключена: впишите токен monobank в «Интеграциях».");
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, no: true, accessKey: true, lang: true, total: true, items: { select: { name: true, sku: true, qty: true, unitPrice: true } } },
  });
  if (!o) throw new PaymentError("Заказ не найден.");
  const back = orderPageUrl(o, p.origin);
  let id: string;
  let pageUrl: string;
  if (mode === "stub") {
    id = `stub_${randomBytes(9).toString("base64url")}`;
    pageUrl = back;
  } else {
    const t = await textsFor(langOf(o));
    const destination = fillText(t[p.kind === "prepay" ? "pay.purpose.prepay" : "pay.purpose.full"] ?? "", { no: o.no }) || o.no;
    const full = Math.abs(p.amount - o.total.toNumber()) < 0.005;
    const body = invoiceRequest({
      no: o.no, amount: p.amount, destination, redirectUrl: back, webHookUrl: monoWebhookUrl(process.env.PUBLIC_URL),
      items: full ? o.items.map((i) => ({ name: i.name, sku: i.sku, qty: i.qty, unitPrice: i.unitPrice.toNumber() })) : undefined,
    });
    const res = await mono("/api/merchant/invoice/create", { method: "POST", body });
    const r = readCreateResponse(res.status, res.body);
    if (!r.ok) {
      console.error(`[payments] счёт для ${o.no} не создан: ${r.error}`);
      throw new PaymentError(r.error);
    }
    id = r.invoiceId;
    pageUrl = r.pageUrl;
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.payInvoice.create({
      data: {
        id, orderId, kind: p.kind, amount: p.amount, pageUrl, stub: mode === "stub", createdBy: p.who,
        // опрашиваем mono до конца срока ссылки (+15 минут на запоздавшую оплату); тестовый счёт не опрашиваем
        checkUntil: mode === "stub" ? null : new Date(now.getTime() + (INVOICE_VALIDITY_SEC + 15 * 60) * 1000),
      },
    }),
    prisma.order.update({ where: { id: orderId }, data: { monoInvoiceId: id } }),
    prisma.orderHistory.create({
      data: { orderId, text: `Счёт на оплату картой: ${money(p.amount)} (${INVOICE_KIND_RU[p.kind]}${mode === "stub" ? ", ТЕСТОВЫЙ — mono не подключён" : ""}) — ${p.who}` },
    }),
  ]);
  return { id, pageUrl, amount: p.amount, stub: mode === "stub" };
}

export type SitePay = { ok: true; pageUrl: string; stub: boolean } | { ok: false; reason: "notFound" | "nothing" | "off" | "error" };

/**
 * Кнопка «Сплатити» на странице заказа: сумма — из заказа (sitePayTarget), не из браузера. Если уже есть живая ссылка
 * на ту же сумму (покупатель вернулся, не заплатив) — отдаём её же, новый счёт не плодим.
 */
export async function payFromSite(no: string, key: string, origin: string): Promise<SitePay> {
  const o = await prisma.order.findUnique({
    where: { no },
    select: { id: true, accessKey: true, payMode: true, status: true, total: true, dueNow: true, paidAmount: true },
  });
  if (!o || !key || o.accessKey !== key) return { ok: false, reason: "notFound" };
  const target = sitePayTarget({ payMode: o.payMode, status: o.status, total: o.total.toNumber(), dueNow: o.dueNow.toNumber(), paidAmount: o.paidAmount.toNumber() });
  if (!target) return { ok: false, reason: "nothing" };
  const mode = await sitePayMode();
  if (mode === "off") return { ok: false, reason: "off" };
  const fresh = new Date(Date.now() - (INVOICE_VALIDITY_SEC - 3600) * 1000);
  const open = await prisma.payInvoice.findFirst({
    where: { orderId: o.id, status: { in: MONO_PENDING }, amount: target.amount, createdAt: { gt: fresh }, stub: mode === "stub" },
    orderBy: { createdAt: "desc" },
  });
  if (open) return { ok: true, pageUrl: open.pageUrl, stub: open.stub };
  try {
    const inv = await createInvoice(o.id, { kind: target.kind, amount: target.amount, who: "сайт", origin });
    return { ok: true, pageUrl: inv.pageUrl, stub: inv.stub };
  } catch (e) {
    console.error("[payments] оплата с сайта:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "error" };
  }
}

/** Счёт от менеджера из карточки заказа: сумма — от 1 ₴ до неоплаченной части. `send` — отправить ссылку покупателю. */
export async function createManagerInvoice(orderId: string, amount: number, who: string, origin: string, send: boolean): Promise<CreatedInvoice & { sent?: string }> {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { no: true, lang: true, payMode: true, status: true, total: true, dueNow: true, paidAmount: true } });
  if (!o) throw new PaymentError("Заказ не найден.");
  const max = unpaidOf({ payMode: o.payMode, status: o.status, total: o.total.toNumber(), dueNow: o.dueNow.toNumber(), paidAmount: o.paidAmount.toNumber() });
  if (amount > max + 0.001) throw new PaymentError(`Не больше неоплаченной части заказа: ${money(max)}.`);
  const inv = await createInvoice(orderId, { kind: "manual", amount, who, origin });
  await prisma.auditLog.create({ data: { who, action: "payment.invoice", target: orderId, details: json({ no: o.no, amount, invoice: tail(inv.id) }) } });
  if (!send) return inv;
  const t = await textsFor(langOf(o));
  const text = fillText(t["pay.link.msg"] ?? "{url}", { no: o.no, sum: money(amount), url: inv.pageUrl });
  const rep = await sendOrderMessages(orderId, { customText: text }, who);
  const sent = rep.sent ? "ссылка отправлена покупателю в Telegram" : rep.noChannel ? "покупатель ещё без бота — скопируйте ссылку" : rep.dev ? "бот не настроен — скопируйте ссылку" : "не отправилось — скопируйте ссылку";
  return { ...inv, sent };
}

// ---------- статус оплаты ----------

type Applied = { orderId: string; no: string; delta: number; paid: number; total: number; status: string; isTest: boolean; kind: string; receiptId?: string | null } | null;

/**
 * Применить состояние счёта от mono (уведомление, опрос, «перевірити») или тестовой оплаты. Строка счёта блокируется —
 * одновременные уведомление и опрос не зачтут оплату дважды; устаревшее уведомление (modifiedDate раньше записанного) пропускается.
 * Зачли деньги — заказ «Новый»/«Не дозвонились» становится «Оплачен», покупателю — автосообщения статуса, менеджерам — «💳 Оплачено».
 */
export async function applyInvoiceState(d: MonoInvoiceData, source: string): Promise<Applied> {
  const now = new Date();
  const rmode = await receiptMode();
  const res = await prisma.$transaction(async (tx): Promise<Applied> => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PayInvoice" WHERE id = ${d.invoiceId} FOR UPDATE`;
    if (!locked.length) return null;
    const inv = await tx.payInvoice.findUniqueOrThrow({
      where: { id: d.invoiceId },
      include: { order: { select: { id: true, no: true, total: true, status: true, isTest: true, items: { select: { name: true, sku: true, qty: true, unitPrice: true } } } } },
    });
    if (isStale(inv.modifiedAt, d.modifiedAt)) return { orderId: inv.orderId, no: inv.order.no, delta: 0, paid: 0, total: 0, status: inv.order.status, isTest: inv.order.isTest, kind: inv.kind };
    const paid = creditedOf(d);
    const delta = round2(paid - inv.paid.toNumber());
    await tx.payInvoice.update({
      where: { id: inv.id },
      data: {
        status: d.status, paid, refunded: d.refunded, failureReason: d.failureReason, modifiedAt: d.modifiedAt ?? inv.modifiedAt, checkedAt: now,
        checkUntil: isFinal(d) ? null : inv.checkUntil ?? new Date(now.getTime() + 24 * 3600_000),
      },
    });
    let orderPaid = 0;
    if (delta !== 0) {
      const sum = await tx.payInvoice.aggregate({ where: { orderId: inv.orderId }, _sum: { paid: true } });
      orderPaid = round2(sum._sum.paid?.toNumber() ?? 0);
      await tx.order.update({ where: { id: inv.orderId }, data: { paidAmount: orderPaid } });
    }
    const total = inv.order.total.toNumber();
    const note =
      delta > 0 ? `Оплата картой: +${money(delta)} (${INVOICE_KIND_RU[inv.kind as InvoiceKind] ?? inv.kind}, счёт ${tail(inv.id)}${inv.stub ? ", ТЕСТОВАЯ" : ""}). Оплачено ${money(orderPaid)} из ${money(total)}`
      : delta < 0 ? `Возврат денег покупателю: ${money(-delta)} (счёт ${tail(inv.id)}). Оплачено ${money(orderPaid)} из ${money(total)}`
      : inv.status !== d.status && (d.status === "failure" || d.status === "expired")
        ? `Счёт ${tail(inv.id)} на ${money(inv.amount.toNumber())}: ${d.status === "failure" ? `оплата не прошла${d.failureReason ? ` (${d.failureReason})` : ""}` : "срок ссылки истёк"}`
        : "";
    if (note) await tx.orderHistory.create({ data: { orderId: inv.orderId, text: `${note} — ${source}` } });
    // шаг 3.3: кассовый чек Checkbox на эту оплату/возврат — в той же транзакции (ровно один чек на одно изменение оплаты)
    const receiptId = await queuePaymentReceiptTx(tx, {
      mode: rmode, orderId: inv.orderId, no: inv.order.no, invoiceId: inv.id, invoiceKind: inv.kind, stubInvoice: inv.stub, delta,
      items: inv.order.items.map((i) => ({ name: i.name, sku: i.sku, qty: i.qty, unitPrice: i.unitPrice.toNumber() })),
    });
    return { orderId: inv.orderId, no: inv.order.no, delta, paid: orderPaid, total, status: inv.order.status, isTest: inv.order.isTest, kind: inv.kind, receiptId };
  });
  if (!res || res.delta === 0) return res;
  if (res.receiptId) await sendReceipt(res.receiptId).catch((e) => console.error("[payments] чек не отправлен (повторит фоновая задача)", e));
  const test = res.isTest ? "🧪 ТЕСТ · " : "";
  if (res.delta > 0) {
    if (res.status === "NEW" || res.status === "NO_ANSWER") {
      await setOrderStatus(res.orderId, "PAID", "monobank");
      await sendAutoMessages(res.orderId, "PAID", "monobank").catch((e) => console.error("[payments] автосообщение не отправлено", e));
    }
    await notifyManagers(`${test}💳 Оплачено ${res.no}: ${money(res.delta)} (${INVOICE_KIND_RU[res.kind as InvoiceKind] ?? res.kind}). Всего оплачено ${money(res.paid)} из ${money(res.total)}`, res.orderId)
      .catch((e) => console.error("[payments] уведомление не сохранено", e));
  } else {
    await notifyManagers(`${test}↩️ Возврат по ${res.no}: ${money(-res.delta)}. Оплачено теперь ${money(res.paid)} из ${money(res.total)}`, res.orderId)
      .catch((e) => console.error("[payments] уведомление не сохранено", e));
  }
  return res;
}

/** Спросить mono о счёте и применить ответ. Тестовый счёт не спрашиваем. */
export async function refreshInvoice(id: string, source = "проверка"): Promise<MonoStatus | null> {
  const inv = await prisma.payInvoice.findUnique({ where: { id }, select: { id: true, stub: true, status: true } });
  if (!inv) return null;
  if (inv.stub) return inv.status as MonoStatus;
  const r = await mono(`/api/merchant/invoice/status?invoiceId=${encodeURIComponent(id)}`, { method: "GET" });
  const d = r.status === 200 ? readMonoInvoice(r.body) : null;
  if (!d || d.invoiceId !== id) {
    await prisma.payInvoice.update({ where: { id }, data: { checkedAt: new Date() } });
    throw new PaymentError(r.status === 200 ? "monobank прислал непонятный ответ." : monoErrorText(r.status, r.body));
  }
  await applyInvoiceState(d, source);
  return d.status;
}

/** «Я сплатив(ла), перевірити» и возврат из mono: проверить неоплаченные счета заказа. Ошибки сети не показываем покупателю. */
export async function refreshOrderPayments(no: string, key: string): Promise<void> {
  const o = await prisma.order.findUnique({ where: { no }, select: { id: true, accessKey: true } });
  if (!o || !key || o.accessKey !== key) return;
  const open = await prisma.payInvoice.findMany({ where: { orderId: o.id, stub: false, status: { in: MONO_PENDING } }, select: { id: true }, take: 5 });
  for (const i of open) await refreshInvoice(i.id, "проверка покупателем").catch((e) => console.error("[payments]", e instanceof Error ? e.message : e));
}

/** Уведомление mono (/api/pay/mono): подпись → разбор → применить. Возвращает HTTP-код ответа. */
export async function handleMonoWebhook(raw: string, sign: string | null): Promise<number> {
  if (!raw || raw.length > 100_000) return 400;
  if (!(await verifyMonoSignature(raw, sign ?? ""))) {
    console.error("[payments] уведомление mono с неверной подписью — отклонено");
    return 403;
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return 400;
  }
  const d = readMonoInvoice(body);
  if (!d) return 400;
  await prisma.webhookLog.create({ data: { source: "MONO", body: json(body) } });
  const r = await applyInvoiceState(d, "уведомление monobank");
  if (!r) console.warn(`[payments] уведомление о чужом счёте ${tail(d.invoiceId)} — пропущено`);
  return 200;
}

/** Фоновая задача (раз в минуту): спросить mono о счетах, по которым ждём оплату или возврат. */
export async function pollInvoices(now = new Date()): Promise<number> {
  if ((await monoMode()) !== "live") return 0;
  const rows = await prisma.payInvoice.findMany({
    where: { stub: false, checkUntil: { gt: now } },
    select: { id: true, createdAt: true, checkedAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  let n = 0;
  for (const r of rows.filter((x) => pollDue(x, now)).slice(0, 20)) {
    try {
      await refreshInvoice(r.id, "опрос monobank");
      n++;
    } catch (e) {
      console.error(`[payments] опрос ${tail(r.id)}:`, e instanceof Error ? e.message : e);
    }
  }
  // срок вышел — больше не спрашиваем
  await prisma.payInvoice.updateMany({ where: { checkUntil: { lte: now } }, data: { checkUntil: null } });
  return n;
}

// ---------- тестовая оплата (без токена, не в production) ----------

/** «Тест: імітувати оплату» на странице заказа: последний тестовый счёт становится оплаченным. */
export async function stubPay(no: string, key: string): Promise<boolean> {
  if ((await monoMode()) !== "stub") return false;
  const o = await prisma.order.findUnique({ where: { no }, select: { id: true, accessKey: true } });
  if (!o || !key || o.accessKey !== key) return false;
  const inv = await prisma.payInvoice.findFirst({ where: { orderId: o.id, stub: true, status: { in: MONO_PENDING } }, orderBy: { createdAt: "desc" } });
  if (!inv) return false;
  const amount = inv.amount.toNumber();
  await applyInvoiceState(
    { invoiceId: inv.id, status: "success", amount, finalAmount: amount, modifiedAt: new Date(), failureReason: null, reference: no, refunded: 0, refundPending: false },
    "тестовая оплата",
  );
  return true;
}

// ---------- возврат и отмена ссылки (админка) ----------

/** Вернуть деньги по оплаченному счёту (полностью или часть). Итог приходит от mono (сразу или позже — опросом/уведомлением). */
export async function refundInvoice(id: string, amount: number, who: string): Promise<{ status: MonoStatus | null; pending: boolean }> {
  const inv = await prisma.payInvoice.findUnique({ where: { id }, include: { order: { select: { no: true } } } });
  if (!inv) throw new PaymentError("Счёт не найден.");
  const paid = inv.paid.toNumber();
  if (amount <= 0 || amount > paid + 0.001) throw new PaymentError(`Вернуть можно не больше оплаченного по этому счёту: ${money(paid)}.`);
  await prisma.auditLog.create({ data: { who, action: "payment.refund", target: inv.orderId, details: json({ no: inv.order.no, amount, invoice: tail(id) }) } });
  if (inv.stub) {
    const left = round2(paid - amount);
    const refunded = round2(inv.refunded.toNumber() + amount);
    await applyInvoiceState(
      { invoiceId: id, status: left > 0 ? "success" : "reversed", amount: inv.amount.toNumber(), finalAmount: left, modifiedAt: new Date(), failureReason: null, reference: inv.order.no, refunded, refundPending: false },
      `тестовый возврат (${who})`,
    );
    return { status: left > 0 ? "success" : "reversed", pending: false };
  }
  const r = await mono("/api/merchant/invoice/cancel", { method: "POST", body: { invoiceId: id, extRef: `${inv.order.no}-r${Date.now()}`, amount: toKop(amount) } });
  const st = (r.body as { status?: unknown } | null)?.status;
  if (r.status !== 200 || st === "failure") {
    const why = r.status !== 200 ? monoErrorText(r.status, r.body) : "monobank отказал в возврате.";
    await prisma.orderHistory.create({ data: { orderId: inv.orderId, text: `Возврат ${money(amount)} не выполнен: ${why} — ${who}` } });
    throw new PaymentError(why);
  }
  await prisma.$transaction([
    prisma.payInvoice.update({ where: { id }, data: { checkUntil: new Date(Date.now() + 24 * 3600_000) } }),
    prisma.orderHistory.create({ data: { orderId: inv.orderId, text: `Запрошен возврат ${money(amount)} по счёту ${tail(id)} — ${who}` } }),
  ]);
  const status = await refreshInvoice(id, `возврат (${who})`).catch(() => null);
  const after = await prisma.payInvoice.findUnique({ where: { id }, select: { paid: true } });
  return { status, pending: !after || round2(after.paid.toNumber()) > round2(paid - amount) + 0.001 };
}

/** Отменить неоплаченную ссылку (сумма заказа изменилась, выставили другой счёт). */
export async function cancelInvoiceLink(id: string, who: string): Promise<void> {
  const inv = await prisma.payInvoice.findUnique({ where: { id }, select: { id: true, orderId: true, stub: true, status: true, amount: true } });
  if (!inv) throw new PaymentError("Счёт не найден.");
  if (!MONO_PENDING.includes(inv.status as MonoStatus)) throw new PaymentError("Этот счёт уже не ждёт оплаты.");
  if (!inv.stub) {
    // вдруг покупатель как раз заплатил — сначала узнаём статус
    const st = await refreshInvoice(id, `перед отменой (${who})`);
    if (st && !MONO_PENDING.includes(st)) throw new PaymentError(`Счёт уже не ждёт оплаты: ${st === "success" ? "оплачен" : st}. Обновите страницу.`);
    const r = await mono("/api/merchant/invoice/remove", { method: "POST", body: { invoiceId: id } });
    if (r.status !== 200) throw new PaymentError(monoErrorText(r.status, r.body));
  }
  await prisma.$transaction([
    prisma.payInvoice.update({ where: { id }, data: { status: "expired", failureReason: "ссылка отменена", checkUntil: null } }),
    prisma.orderHistory.create({ data: { orderId: inv.orderId, text: `Ссылка на оплату ${money(inv.amount.toNumber())} (счёт ${tail(id)}) отменена — ${who}` } }),
    prisma.auditLog.create({ data: { who, action: "payment.cancel", target: inv.orderId, details: json({ invoice: tail(id) }) } }),
  ]);
}

// ---------- показ ----------

/** Счета заказа для админки (новые сверху). */
export const orderInvoices = (orderId: string) => prisma.payInvoice.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });

/** Оплата для страницы заказа покупателя (по номеру и ключу из ссылки): сколько оплачено и последний счёт. */
export async function orderPayState(no: string, key: string) {
  const o = await prisma.order.findUnique({
    where: { no },
    select: { accessKey: true, payMode: true, status: true, total: true, dueNow: true, paidAmount: true, invoices: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, stub: true, pageUrl: true } } },
  });
  if (!o || !key || o.accessKey !== key) return null;
  const order = { payMode: o.payMode, status: o.status, total: o.total.toNumber(), dueNow: o.dueNow.toNumber(), paidAmount: o.paidAmount.toNumber() };
  return { order, last: o.invoices[0] ?? null, target: sitePayTarget(order), mode: await sitePayMode() };
}
