// Кассовые чеки через Checkbox (шаг 3.3): чек продажи после каждой настоящей оплаты картой (monobank), чек возврата при возврате денег,
// ручной чек из заказа (например, наличные при самовывозе). Ссылка на готовый чек — покупателю в Telegram (и на почту через Checkbox,
// если у клиента есть почта) и на странице заказа.
// Порядок: оплата зачтена → строка FiscalReceipt (в той же транзакции, что и оплата — чек не потеряется и не задвоится) → сразу пробуем
// отправить; не вышло — фоновая задача повторяет (1, 2, 5, 10, 30 минут…), после 8 попыток — тревога менеджерам и кнопка «Повторить».
// Смена кассира открывается сама перед первым чеком и закрывается в 23:00 по Киеву (jobs.ts).
// Без ключей Checkbox: на компьютере разработки — тестовые чеки (в налоговую не уходят), в production — чеков нет.
// Правила (строки чека, тело запроса, разбор ответов) — @handyman/core/shop (receipts.ts); ключи — только через secret("checkbox.…").

import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "./client";
import {
  RECEIPT_KIND_RU, RECEIPT_MAX_ATTEMPTS, RECEIPT_PAY_RU, checkboxErrorText, goodsTotal, readCheckboxReceipt, readShift, receiptGoods, receiptPageUrl,
  receiptRetryDelayMin, sellReceiptBody, type CheckboxReceipt, type ReceiptGood, type ReceiptKind, type ReceiptLine, type ReceiptPayType, type ReceiptStatus,
} from "@handyman/core/shop";
import { fillText, resolveTexts } from "@handyman/core/site";
import { secret } from "./integrations";
import { loadTextOverrides } from "./site-content";
import { notifyManagers } from "./notify";
import { sendOrderMessages } from "./messages";
import { logError } from "./errors";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;
const tail = (id: string) => `…${id.slice(-6)}`;

export class ReceiptError extends Error {}

// ---------- режим и запросы к Checkbox ----------

export type ReceiptMode = "live" | "stub" | "off";

/** live — ключ кассы, логин и пароль кассира есть; stub — нет, но это не production (тестовые чеки); off — чеков нет. */
export async function receiptMode(): Promise<ReceiptMode> {
  const [license, login, password] = await Promise.all([secret("checkbox.licenseKey"), secret("checkbox.login"), secret("checkbox.password")]);
  if (license && login && password) return "live";
  return process.env.NODE_ENV === "production" ? "off" : "stub";
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
let shiftWaitMs = 1500;
/** Для тестов: подменить запросы к Checkbox (null — обычный fetch) и паузу ожидания открытия смены. */
export const setReceiptsFetch = (f: FetchLike | null, waitMs = 1500) => {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
  shiftWaitMs = waitMs;
  session = null;
};

/** Адрес API Checkbox (для тестовой кассы — CHECKBOX_BASE=https://dev-api.checkbox.in.ua). */
export const checkboxBase = () => (process.env.CHECKBOX_BASE?.trim() || "https://api.checkbox.in.ua").replace(/\/+$/, "");
const receiptPage = (id: string) => receiptPageUrl(id, process.env.CHECKBOX_RECEIPT_PAGE);

let session: { who: string; token: string } | null = null;

async function raw(path: string, init: { method: "GET" | "POST"; body?: unknown; token?: string; license: string }): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetchImpl(`${checkboxBase()}/api/v1${path}`, {
      method: init.method,
      headers: {
        accept: "application/json", "X-Client-Name": "Handyman", "X-Client-Version": "1.0", "X-License-Key": init.license,
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ReceiptError(timeout ? "Checkbox не ответил за 20 секунд." : "Не удалось связаться с Checkbox (нет интернета или сервис недоступен).");
  }
}

async function keys() {
  const [license, login, password] = await Promise.all([secret("checkbox.licenseKey"), secret("checkbox.login"), secret("checkbox.password")]);
  if (!license || !login || !password) throw new ReceiptError("Checkbox не подключён: впишите ключ кассы, логин и пароль кассира в «Интеграциях».");
  return { license, login, password };
}

/** Запрос от имени кассира. Токен входа хранится в памяти; не приняли (сменили пароль, истёк) — входим заново один раз. */
async function cb(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ status: number; body: unknown }> {
  const k = await keys();
  const who = `${k.license}|${k.login}|${k.password}`;
  for (let i = 0; i < 2; i++) {
    if (session?.who !== who) {
      const r = await raw("/cashier/signin", { method: "POST", body: { login: k.login, password: k.password }, license: k.license });
      const token = (r.body as { access_token?: unknown } | null)?.access_token;
      if (r.status >= 300 || typeof token !== "string") throw new ReceiptError(checkboxErrorText(r.status, r.body));
      session = { who, token };
    }
    const res = await raw(path, { ...init, token: session.token, license: k.license });
    if (res.status !== 401 || i > 0) return res;
    session = null;
  }
  throw new ReceiptError("Checkbox не принял вход кассира.");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Смена кассира должна быть открыта: нет смены или закрыта — открываем и ждём «OPENED» (обычно пара секунд). */
async function ensureShift(): Promise<void> {
  const cur = await cb("/cashier/shift", { method: "GET" });
  if (cur.status >= 300 && cur.status !== 404) throw new ReceiptError(checkboxErrorText(cur.status, cur.body));
  let s = cur.status === 200 ? readShift(cur.body) : null;
  if (s?.status === "OPENED") return;
  if (!s || s.status === "CLOSED") {
    const r = await cb("/shifts", { method: "POST", body: {} });
    if (r.status >= 300) throw new ReceiptError(`Смена не открылась. ${checkboxErrorText(r.status, r.body)}`);
    s = readShift(r.body);
    console.info("[receipts] открыта смена кассира в Checkbox");
  }
  for (let i = 0; i < 6 && s?.status !== "OPENED"; i++) {
    await sleep(shiftWaitMs);
    const again = await cb("/cashier/shift", { method: "GET" });
    s = again.status === 200 ? readShift(again.body) : s;
  }
  if (s?.status !== "OPENED") throw new ReceiptError("Смена в Checkbox ещё открывается — чек отправим чуть позже.");
}

/** Чек в Checkbox по нашему id (null — такого нет). */
async function fetchReceipt(id: string): Promise<CheckboxReceipt | null> {
  const r = await cb(`/receipts/${encodeURIComponent(id)}`, { method: "GET" });
  if (r.status === 404 || r.status === 400 || r.status === 422) return null;
  if (r.status >= 300) throw new ReceiptError(checkboxErrorText(r.status, r.body));
  return readCheckboxReceipt(r.body);
}

// ---------- постановка в очередь ----------

type QueueInput = {
  orderId: string; no: string; invoiceId: string | null; kind: ReceiptKind; payType: ReceiptPayType; amount: number; who: string;
  stub: boolean; goods: ReceiptGood[]; relatedId?: string | null;
};

async function queueTx(tx: Prisma.TransactionClient, p: QueueInput): Promise<string> {
  const id = randomUUID();
  await tx.fiscalReceipt.create({
    data: {
      id, orderId: p.orderId, invoiceId: p.invoiceId, kind: p.kind, payType: p.payType, amount: p.amount, goods: json(p.goods),
      relatedId: p.relatedId ?? null, stub: p.stub, createdBy: p.who, nextTryAt: new Date(),
    },
  });
  return id;
}

/**
 * Оплата по счёту mono изменилась на `delta` ₴ — поставить чек (вызывается внутри транзакции оплаты, поэтому ровно один раз на оплату).
 * Тестовая оплата при подключённом Checkbox чек не получает (денег не было). Возврат — только если по этой оплате был чек продажи.
 * Возвращает id чека (отправить после транзакции) или null.
 */
export async function queuePaymentReceiptTx(
  tx: Prisma.TransactionClient,
  p: { mode: ReceiptMode; orderId: string; no: string; invoiceId: string; invoiceKind: string; stubInvoice: boolean; delta: number; items: ReceiptLine[] },
): Promise<string | null> {
  if (p.delta === 0 || p.mode === "off" || (p.stubInvoice && p.mode === "live")) return null;
  const stub = p.mode === "stub";
  if (p.delta > 0) {
    const goods = receiptGoods({ no: p.no, amount: p.delta, items: p.items, partial: p.invoiceKind === "prepay" ? "prepay" : "pay" });
    return queueTx(tx, { orderId: p.orderId, no: p.no, invoiceId: p.invoiceId, kind: "sell", payType: "CASHLESS", amount: p.delta, who: "monobank", stub, goods });
  }
  const refund = round2(-p.delta);
  const sold = await tx.fiscalReceipt.findFirst({ where: { invoiceId: p.invoiceId, kind: "sell", status: { not: "error" }, stub }, orderBy: { createdAt: "desc" } });
  if (!sold) {
    await tx.orderHistory.create({ data: { orderId: p.orderId, text: `Чек возврата ${money(refund)} не создан: по этой оплате не было кассового чека` } });
    return null;
  }
  const soldGoods = sold.goods as unknown as ReceiptGood[];
  const goods = Math.abs(goodsTotal(soldGoods) - refund) < 0.005 ? soldGoods : receiptGoods({ no: p.no, amount: refund, partial: "refund" });
  return queueTx(tx, { orderId: p.orderId, no: p.no, invoiceId: p.invoiceId, kind: "return", payType: "CASHLESS", amount: refund, who: "monobank", stub, goods, relatedId: sold.id });
}

// ---------- отправка ----------

const STUCK_MS = 5 * 60_000;

/**
 * Отправить чек в Checkbox (или «пробить» тестовый). Строка сначала занимается (queued → sending) — одновременные попытки
 * (оплата + фоновая задача) не отправят чек дважды; к тому же id чека в Checkbox — наш, повтор не создаст второй чек.
 */
export async function sendReceipt(id: string, now = new Date()): Promise<ReceiptStatus | null> {
  const row0 = await prisma.fiscalReceipt.findUnique({ where: { id }, select: { stub: true } });
  if (!row0) return null;
  if (!row0.stub && (await receiptMode()) !== "live") return null;
  const claimed = await prisma.fiscalReceipt.updateMany({
    where: { id, OR: [{ status: "queued" }, { status: "sending", updatedAt: { lt: new Date(now.getTime() - STUCK_MS) } }] },
    data: { status: "sending", attempts: { increment: 1 } },
  });
  if (!claimed.count) return null;
  const r = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id }, include: { order: { select: { client: { select: { email: true } } } } } });
  if (r.stub) return applyReceipt(id, { id, status: "DONE", fiscalCode: `ТЕСТ-${id.slice(0, 8).toUpperCase()}`, taxUrl: null, error: null });
  try {
    // повтор: чек мог дойти до Checkbox в прошлый раз (оборвалась связь) — сначала спросим
    let got = r.attempts > 1 ? await fetchReceipt(id) : null;
    if (got?.status === "ERROR") return applyReceipt(id, got);
    if (!got) {
      await ensureShift();
      const body = sellReceiptBody({
        id, goods: r.goods as unknown as ReceiptGood[], payType: r.payType as ReceiptPayType, isReturn: r.kind === "return", relatedId: r.relatedId,
        emails: r.order.client.email ? [r.order.client.email] : [],
      });
      const res = await cb("/receipts/sell", { method: "POST", body });
      if (res.status >= 300) throw new ReceiptError(checkboxErrorText(res.status, res.body));
      got = readCheckboxReceipt(res.body);
      if (!got) throw new ReceiptError("Checkbox прислал непонятный ответ.");
      // обычно фискальный номер появляется через секунду-две — спросим сразу, чтобы ссылка ушла покупателю без ожидания
      for (let i = 0; i < 3 && got && got.status !== "DONE" && got.status !== "ERROR"; i++) {
        await sleep(shiftWaitMs);
        got = (await fetchReceipt(id).catch(() => null)) ?? got;
      }
    }
    return applyReceipt(id, got, now);
  } catch (e) {
    return failAttempt(id, e, now);
  }
}

async function failAttempt(id: string, e: unknown, now: Date): Promise<ReceiptStatus> {
  const why = e instanceof ReceiptError ? e.message : "Непредвиденная ошибка при отправке чека.";
  if (!(e instanceof ReceiptError)) logError("[receipts]", e);
  const r = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id }, include: { order: { select: { no: true, isTest: true } } } });
  logError(`[receipts] чек ${tail(id)} (${r.order.no}), попытка ${r.attempts}: ${why}`);
  if (r.attempts < RECEIPT_MAX_ATTEMPTS) {
    await prisma.fiscalReceipt.update({ where: { id }, data: { status: "queued", error: why, nextTryAt: new Date(now.getTime() + receiptRetryDelayMin(r.attempts) * 60_000) } });
    return "queued";
  }
  return giveUp(r, why);
}

async function giveUp(r: { id: string; orderId: string; kind: string; amount: Prisma.Decimal; order: { no: string; isTest: boolean } }, why: string): Promise<ReceiptStatus> {
  await prisma.$transaction([
    prisma.fiscalReceipt.update({ where: { id: r.id }, data: { status: "error", error: why, nextTryAt: null } }),
    prisma.orderHistory.create({ data: { orderId: r.orderId, text: `Кассовый чек (${RECEIPT_KIND_RU[r.kind as ReceiptKind]}) на ${money(r.amount.toNumber())} не создан: ${why}` } }),
  ]);
  await notifyManagers(
    `${r.order.isTest ? "🧪 ТЕСТ · " : ""}🧾❗ Чек по ${r.order.no} на ${money(r.amount.toNumber())} не создан: ${why} Откройте заказ → «Кассовые чеки» → «Повторить».`,
    r.orderId,
  ).catch((e) => logError("[receipts] тревога не сохранена", e));
  return "error";
}

/** Записать ответ Checkbox: готов — номер и ссылка (и ссылка покупателю), ещё обрабатывается — спросим через минуту, ошибка — сдаёмся. */
async function applyReceipt(id: string, got: CheckboxReceipt, now = new Date()): Promise<ReceiptStatus> {
  const r = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id }, include: { order: { select: { no: true, isTest: true } } } });
  if (got.status === "ERROR") return giveUp(r, got.error ?? "Checkbox не смог зарегистрировать чек.");
  if (got.status !== "DONE") {
    await prisma.fiscalReceipt.update({ where: { id }, data: { status: "sent", error: null, nextTryAt: new Date(now.getTime() + 60_000) } });
    return "sent";
  }
  const url = r.stub ? null : receiptPage(id);
  await prisma.$transaction([
    prisma.fiscalReceipt.update({ where: { id }, data: { status: "done", fiscalCode: got.fiscalCode, url, error: null, nextTryAt: null } }),
    prisma.orderHistory.create({
      data: {
        orderId: r.orderId,
        text: `Кассовый чек (${RECEIPT_KIND_RU[r.kind as ReceiptKind]}, ${RECEIPT_PAY_RU[r.payType as ReceiptPayType] ?? r.payType}) на ${money(r.amount.toNumber())}${r.stub ? " — ТЕСТОВЫЙ, Checkbox не подключён" : ""}: № ${got.fiscalCode ?? "—"}`,
      },
    }),
  ]);
  if (url) await sendReceiptToClient(id, "Checkbox", true).catch((e) => logError("[receipts] ссылка покупателю не отправлена", e));
  return "done";
}

/** Спросить Checkbox о чеке, который он ещё обрабатывает. */
async function pollReceipt(id: string, now: Date): Promise<void> {
  try {
    const got = await fetchReceipt(id);
    if (got) await applyReceipt(id, got, now);
    else await prisma.fiscalReceipt.update({ where: { id }, data: { nextTryAt: new Date(now.getTime() + 60_000) } });
  } catch (e) {
    logError(`[receipts] проверка чека ${tail(id)}:`, e instanceof Error ? e.message : e);
    await prisma.fiscalReceipt.update({ where: { id }, data: { nextTryAt: new Date(now.getTime() + 5 * 60_000) } });
  }
}

/** Фоновая задача (раз в минуту): отправить чеки из очереди, спросить о принятых, поднять зависшие. */
export async function processReceipts(now = new Date()): Promise<number> {
  const live = (await receiptMode()) === "live";
  const rows = await prisma.fiscalReceipt.findMany({
    where: {
      ...(live ? {} : { stub: true }),
      OR: [
        { status: "queued", OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }] },
        { status: "sending", updatedAt: { lt: new Date(now.getTime() - STUCK_MS) } },
        { status: "sent", nextTryAt: { lte: now } },
      ],
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  let n = 0;
  for (const r of rows) {
    try {
      if (r.status === "sent") await pollReceipt(r.id, now);
      else await sendReceipt(r.id, now);
      n++;
    } catch (e) {
      logError(`[receipts] ${tail(r.id)}:`, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

/** Закрыть смену кассира (фоновая задача в 23:00; Z-отчёт делает Checkbox). true — закрыли. */
export async function closeShift(): Promise<boolean> {
  if ((await receiptMode()) !== "live") return false;
  const cur = await cb("/cashier/shift", { method: "GET" });
  const s = cur.status === 200 ? readShift(cur.body) : null;
  if (s?.status !== "OPENED") return false;
  const r = await cb("/shifts/close", { method: "POST", body: {} });
  if (r.status >= 300) {
    const why = checkboxErrorText(r.status, r.body);
    await notifyManagers(`🧾❗ Смена кассира в Checkbox не закрылась: ${why} Закройте её в кабинете Checkbox.`).catch(() => undefined);
    throw new ReceiptError(why);
  }
  await prisma.auditLog.create({ data: { who: "система", action: "checkbox.shift.close", details: json({ shift: tail(s.id) }) } });
  return true;
}

// ---------- ссылка покупателю ----------

/** Отправить покупателю ссылку на чек (Telegram; нет бота — строка «скопируйте» в заказе). `once` — только если ещё не отправляли. */
export async function sendReceiptToClient(id: string, who: string, once = false): Promise<string> {
  const r = await prisma.fiscalReceipt.findUnique({ where: { id }, include: { order: { select: { no: true, lang: true, client: { select: { lang: true } } } } } });
  if (!r?.url) throw new ReceiptError("У чека ещё нет ссылки.");
  if (once) {
    const first = await prisma.fiscalReceipt.updateMany({ where: { id, sentToClientAt: null }, data: { sentToClientAt: new Date() } });
    if (!first.count) return "уже отправлено";
  } else await prisma.fiscalReceipt.update({ where: { id }, data: { sentToClientAt: new Date() } });
  const lang = (r.order.lang ?? r.order.client.lang) === "RU" ? "ru" : "uk";
  const t = resolveTexts(await loadTextOverrides(), lang);
  const text = fillText(t["pay.receipt.msg"] ?? "{url}", { no: r.order.no, sum: money(r.amount.toNumber()), url: r.url });
  const rep = await sendOrderMessages(r.orderId, { customText: text }, who);
  return rep.sent ? "ссылка на чек отправлена покупателю в Telegram" : rep.noChannel ? "покупатель ещё без бота — скопируйте ссылку" : rep.dev ? "бот не настроен — скопируйте ссылку" : "не отправилось — скопируйте ссылку";
}

// ---------- админка ----------

/** Сколько по заказу ещё можно пробить чеком продажи: сумма заказа − чеки продажи + чеки возврата (без «не создан»). */
export async function receiptableOf(orderId: string): Promise<number> {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { total: true, receipts: { where: { status: { not: "error" } }, select: { kind: true, amount: true } } } });
  if (!o) return 0;
  const net = o.receipts.reduce((a, r) => a + (r.kind === "sell" ? 1 : -1) * r.amount.toNumber(), 0);
  return Math.max(0, round2(o.total.toNumber() - net));
}

/** Чек вручную из карточки заказа (оплата наличными/терминалом при самовывозе, по звонку). */
export async function createManualReceipt(orderId: string, amount: number, payType: ReceiptPayType, who: string): Promise<{ id: string; status: ReceiptStatus | null }> {
  const mode = await receiptMode();
  if (mode === "off") throw new ReceiptError("Checkbox не подключён: впишите ключ кассы, логин и пароль кассира в «Интеграциях».");
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { no: true, items: { select: { name: true, sku: true, qty: true, unitPrice: true } } } });
  if (!o) throw new ReceiptError("Заказ не найден.");
  const max = await receiptableOf(orderId);
  if (amount > max + 0.001) throw new ReceiptError(`Не больше суммы заказа без уже пробитых чеков: ${money(max)}.`);
  const items = o.items.map((i) => ({ name: i.name, sku: i.sku, qty: i.qty, unitPrice: i.unitPrice.toNumber() }));
  const goods = receiptGoods({ no: o.no, amount, items, partial: "pay" });
  const id = await prisma.$transaction(async (tx) => {
    const rid = await queueTx(tx, { orderId, no: o.no, invoiceId: null, kind: "sell", payType, amount, who, stub: mode === "stub", goods });
    await tx.orderHistory.create({ data: { orderId, text: `Кассовый чек вручную: ${money(amount)} ${RECEIPT_PAY_RU[payType]} — ${who}` } });
    await tx.auditLog.create({ data: { who, action: "receipt.manual", target: orderId, details: json({ no: o.no, amount, payType }) } });
    return rid;
  });
  return { id, status: await sendReceipt(id) };
}

/** «Повторить» чек «не создан»: если Checkbox всё-таки его принял — берём его; иначе — новая попытка с новым номером чека. */
export async function retryReceipt(id: string, who: string): Promise<ReceiptStatus | null> {
  const r = await prisma.fiscalReceipt.findUnique({ where: { id } });
  if (!r) throw new ReceiptError("Чек не найден.");
  if (r.status !== "error") throw new ReceiptError("Этот чек не в статусе «не создан».");
  if (!r.stub && (await receiptMode()) !== "live") throw new ReceiptError("Checkbox не подключён: впишите ключи в «Интеграциях».");
  const known = r.stub ? null : await fetchReceipt(id);
  if (known && known.status !== "ERROR") {
    await prisma.fiscalReceipt.update({ where: { id }, data: { status: "sending", attempts: 1 } });
    return applyReceipt(id, known);
  }
  const fresh = r.stub ? id : randomUUID();
  await prisma.$transaction([
    prisma.fiscalReceipt.update({ where: { id }, data: { id: fresh, status: "queued", attempts: 0, error: null, nextTryAt: new Date() } }),
    prisma.fiscalReceipt.updateMany({ where: { relatedId: id }, data: { relatedId: fresh } }),
    prisma.orderHistory.create({ data: { orderId: r.orderId, text: `Кассовый чек на ${money(r.amount.toNumber())}: повторная отправка — ${who}` } }),
  ]);
  return sendReceipt(fresh);
}

/** Чеки заказа для админки (новые сверху). */
export const orderReceipts = (orderId: string) => prisma.fiscalReceipt.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });

/** Готовые чеки для страницы заказа покупателя (по номеру и ключу из ссылки). */
export async function orderReceiptLinks(no: string, key: string): Promise<Array<{ kind: ReceiptKind; amount: number; url: string }>> {
  const o = await prisma.order.findUnique({
    where: { no },
    select: { accessKey: true, receipts: { where: { status: "done", stub: false, url: { not: null } }, orderBy: { createdAt: "asc" }, select: { kind: true, amount: true, url: true } } },
  });
  if (!o || !key || o.accessKey !== key) return [];
  return o.receipts.map((r) => ({ kind: r.kind as ReceiptKind, amount: r.amount.toNumber(), url: r.url! }));
}
