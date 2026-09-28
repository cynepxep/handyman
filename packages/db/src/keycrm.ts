// KeyCRM (шаг 3.5): новые заказы уходят в KeyCRM, статус из KeyCRM возвращается на сайт.
//
// Отправка. Заказ создан → если в «Интеграциях» включено «Передавать заказы в KeyCRM» и заказ не тестовый — он встаёт в очередь
// (Order.keycrmState = queued) и сразу отправляется (покупатель не ждёт). Не вышло — фоновая задача повторяет (1, 2, 5, 10, 30, 60,
// 120 минут), после 8 попыток — тревога менеджерам и кнопка «Отправить ещё раз». Кнопка в заказе работает и при выключенной передаче;
// тестовый заказ — только кнопкой с подтверждением, номер TEST-HM-…, пометка «ТЕСТ — не обрабатывать».
// Без дублей: отправку берёт одна попытка (updateMany по состоянию), номер заказа сайта — source_uuid; если прошлая попытка могла
// дойти (ответа не было), перед новой ищем заказ в KeyCRM по этому номеру.
//
// Статусы. Вебхук KeyCRM (/api/keycrm/webhook?secret=…) и запасной опрос раз в 10 минут (пока у сайта нет https-адреса) →
// по таблице соответствия меняем статус на сайте (склад, история — как при смене менеджером). Есть авто-шаблон — сообщение покупателю
// уходит само; нет — запись PendingNotif: менеджер видит в заказе «напишите покупателю».
// Без API-ключа: на компьютере разработки — заглушка (тестовые номера, в сеть не ходим), в production — не передаём.
// Ключи — только через secret("keycrm.…"); правила и разбор ответов — @handyman/core/shop (keycrm.ts).

import { createHash, timingSafeEqual } from "node:crypto";
import { prisma, Prisma, type OrderStatus } from "./client";
import {
  DEFAULT_KEYCRM_SETTINGS, KEYCRM_BASE, KEYCRM_CLOSED, KEYCRM_MAX_ATTEMPTS, KEYCRM_POLL_DAYS, KEYCRM_POLL_MIN, KEYCRM_SENDING_STALE_MIN, KEYCRM_SETTING_KEY,
  ORDER_STATUS_RU, findByUuid, keycrmErrorText, keycrmOrderBody, keycrmRetryDelayMin, keycrmStatusName, keycrmUuid, mapKeycrmStatus, normalizeKeycrmSettings,
  readKeycrmOrder, readKeycrmOrderList, readKeycrmStatuses, readKeycrmWebhook, type KeycrmOrderInfo, type KeycrmSettings, type KeycrmStatusRow,
} from "@handyman/core/shop";
import { weakWebhookSecret } from "@handyman/core/integrations";
import { secret } from "./integrations";
import { notifyManagers } from "./notify";
import { setOrderStatus } from "./orders";
import { sendAutoMessages } from "./messages";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
const min = (n: number) => n * 60_000;

export class KeycrmError extends Error {}

// ---------- настройки ----------

export async function loadKeycrmSettings(): Promise<KeycrmSettings> {
  return normalizeKeycrmSettings((await prisma.setting.findUnique({ where: { key: KEYCRM_SETTING_KEY } }))?.value ?? DEFAULT_KEYCRM_SETTINGS);
}

async function saveSettings(s: KeycrmSettings): Promise<void> {
  await prisma.setting.upsert({ where: { key: KEYCRM_SETTING_KEY }, create: { key: KEYCRM_SETTING_KEY, value: json(s) }, update: { value: json(s) } });
}

/** Переключатель «Передавать заказы в KeyCRM» (только новые заказы; уже созданные не отправляются задним числом). */
export async function setKeycrmEnabled(enabled: boolean, who: string): Promise<void> {
  const s = await loadKeycrmSettings();
  await saveSettings({ ...s, enabled });
  await prisma.auditLog.create({ data: { who, action: "keycrm.enabled", details: json({ enabled }) } });
}

/** Таблица соответствия: id статуса KeyCRM → наш статус («» — не менять). Неизвестные значения отбрасываются. */
export async function saveKeycrmStatusMap(raw: Record<string, string>, who: string): Promise<KeycrmSettings> {
  const s = await loadKeycrmSettings();
  const next = normalizeKeycrmSettings({ ...s, statusMap: raw });
  await saveSettings(next);
  await prisma.auditLog.create({ data: { who, action: "keycrm.statusMap", details: json(next.statusMap) } });
  return next;
}

// ---------- режим и запросы ----------

export type KeycrmMode = "live" | "stub" | "off";

/** live — API-ключ есть; stub — нет, но это не production (тестовые номера, в сеть не ходим); off — передачи нет. */
export async function keycrmMode(): Promise<KeycrmMode> {
  if (await secret("keycrm.apiKey")) return "live";
  return process.env.NODE_ENV === "production" ? "off" : "stub";
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Для тестов: подменить запросы к KeyCRM (null — обычный fetch). */
export const setKeycrmFetch = (f: FetchLike | null) => {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
};

const base = () => (process.env.KEYCRM_BASE?.trim() || KEYCRM_BASE).replace(/\/+$/, "");

async function kc(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ status: number; body: unknown }> {
  const key = await secret("keycrm.apiKey");
  if (!key) throw new KeycrmError("KeyCRM не подключён: впишите API-ключ в «Интеграциях».");
  try {
    const res = await fetchImpl(`${base()}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${key}`, accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new KeycrmError(timeout ? "KeyCRM не ответил за 15 секунд." : "Не удалось связаться с KeyCRM (нет интернета или сервис недоступен).");
  }
}

async function sourceIdOrThrow(): Promise<number> {
  const v = Number(await secret("keycrm.sourceId"));
  if (!Number.isInteger(v) || v <= 0) throw new KeycrmError("Не указан источник заказа (ID) KeyCRM — впишите его в «Интеграциях».");
  return v;
}

// отправки, запущенные «в фоне» после оформления заказа (тесты ждут их через keycrmSettled)
const inflight = new Set<Promise<unknown>>();
function background(p: Promise<unknown>) {
  const t = p.catch((e) => console.error("[keycrm]", e instanceof Error ? e.message : e)).finally(() => inflight.delete(t));
  inflight.add(t);
}
/** Для тестов: дождаться фоновых отправок. */
export async function keycrmSettled(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

// ---------- отправка заказа ----------

/** Вызывается после создания заказа (сайт, «1 клік», «по звонку»). Ошибка здесь никогда не мешает оформлению. */
export async function afterOrderCreated(orderId: string): Promise<void> {
  try {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { isTest: true, keycrmState: true, keycrmId: true } });
    if (!o || o.isTest || o.keycrmState || o.keycrmId) return;
    if (!(await loadKeycrmSettings()).enabled || (await keycrmMode()) === "off") return;
    await prisma.order.update({ where: { id: orderId }, data: { keycrmState: "queued", keycrmNextTryAt: new Date() } });
    background(deliver(orderId));
  } catch (e) {
    console.error("[keycrm] заказ не поставлен в очередь:", e instanceof Error ? e.message : e);
  }
}

/** Взять отправку себе: одна попытка за раз (вторая копия сайта, фоновая задача и кнопка не отправят заказ дважды). */
async function claim(orderId: string, now: Date): Promise<boolean> {
  const r = await prisma.order.updateMany({
    where: { id: orderId, keycrmId: null, keycrmState: { in: ["queued", "error", "sending"] }, keycrmNextTryAt: { lte: now } },
    // «sending» с истёкшим сроком — прошлая попытка оборвалась (перезапуск сайта): через 3 минуты её можно взять снова
    data: { keycrmState: "sending", keycrmNextTryAt: new Date(now.getTime() + min(KEYCRM_SENDING_STALE_MIN)) },
  });
  return r.count === 1;
}

type DeliverResult = { ok: true; id: string } | { ok: false; error: string; busy?: boolean };

async function deliver(orderId: string, now = new Date()): Promise<DeliverResult> {
  if (!(await claim(orderId, now))) return { ok: false, busy: true, error: "Заказ уже отправляется — обновите страницу через несколько секунд." };
  const o = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, pickupWarehouse: { select: { name: true } } } });
  if (!o) return { ok: false, error: "Заказ не найден." };
  const uuid = o.keycrmUuid ?? keycrmUuid(o.no, o.isTest);
  try {
    const mode = await keycrmMode();
    if (mode === "off") throw new KeycrmError("KeyCRM не подключён: впишите API-ключ в «Интеграциях».");
    if (mode === "stub") return await finish(o.id, uuid, { id: 900000 + o.seq, statusId: 1, sourceUuid: uuid, sourceId: null }, true);
    const sourceId = await sourceIdOrThrow();
    // прошлая попытка могла создать заказ, а ответ не дошёл — сначала ищем его по номеру (иначе будет дубль)
    if (o.keycrmAttempts > 0) {
      const found = await lookup(uuid, sourceId);
      if (found) return await finish(o.id, uuid, found, false);
    }
    const body = keycrmOrderBody({
      no: o.no, uuid, isTest: o.isTest, name: o.recipientName, phone: o.recipientPhone,
      items: o.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unitPrice: i.unitPrice.toNumber() })),
      delivery: o.delivery, deliveryType: o.deliveryType, city: o.city, address: o.address, npPoint: o.npWarehouseRef, npPointRef: o.npPointRef,
      pickupName: o.pickupWarehouse?.name ?? null,
      payMode: o.payMode, total: o.total.toNumber(), dueNow: o.dueNow.toNumber(), paid: o.paidAmount.toNumber(), discountPct: o.discountPct,
      comment: o.comment, source: o.source, noCallback: o.noCallback,
    }, sourceId, Number(await secret("keycrm.npServiceId")) || null);
    const r = await kc("/order", { method: "POST", body });
    const info = r.status < 300 ? readKeycrmOrder(r.body) : null;
    if (info) return await finish(o.id, uuid, info, false);
    // KeyCRM мог отказать из-за повтора номера (заказ уже есть) — поищем сразу
    if (r.status >= 400) {
      const found = await lookup(uuid, sourceId).catch(() => null);
      if (found) return await finish(o.id, uuid, found, false);
    }
    throw new KeycrmError(r.status < 300 ? "KeyCRM не вернул номер заказа." : keycrmErrorText(r.status, r.body));
  } catch (e) {
    const error = e instanceof KeycrmError ? e.message : `Ошибка: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
    await fail(o.id, o.no, o.isTest, uuid, o.keycrmAttempts + 1, error, now);
    return { ok: false, error };
  }
}

/** Наш заказ в KeyCRM по номеру в источнике. */
async function lookup(uuid: string, sourceId: number): Promise<KeycrmOrderInfo | null> {
  const r = await kc(`/order?limit=50&filter%5Bsource_uuid%5D=${encodeURIComponent(uuid)}`, { method: "GET" });
  if (r.status >= 300) throw new KeycrmError(keycrmErrorText(r.status, r.body));
  return findByUuid(readKeycrmOrderList(r.body), uuid, sourceId);
}

async function finish(orderId: string, uuid: string, info: KeycrmOrderInfo, stub: boolean): Promise<DeliverResult> {
  const id = String(info.id);
  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: {
        keycrmId: id, keycrmState: "sent", keycrmSentAt: new Date(), keycrmError: null, keycrmNextTryAt: null, keycrmUuid: uuid, keycrmStub: stub,
        keycrmStatusId: info.statusId, keycrmCheckedAt: new Date(),
      },
    }),
    prisma.orderHistory.create({ data: { orderId, text: `Передан в KeyCRM: № ${id}${stub ? " (заглушка: KeyCRM не подключён, номер тестовый)" : ""}` } }),
  ]);
  return { ok: true, id };
}

async function fail(orderId: string, no: string, isTest: boolean, uuid: string, attempts: number, error: string, now: Date): Promise<void> {
  const delay = keycrmRetryDelayMin(attempts);
  await prisma.order.update({
    where: { id: orderId },
    data: { keycrmState: "error", keycrmError: error.slice(0, 500), keycrmAttempts: attempts, keycrmUuid: uuid, keycrmNextTryAt: delay === null ? null : new Date(now.getTime() + min(delay)) },
  });
  if (attempts === KEYCRM_MAX_ATTEMPTS) {
    await prisma.orderHistory.create({ data: { orderId, text: `Не удалось передать в KeyCRM после ${attempts} попыток: ${error.slice(0, 300)}` } });
    await notifyManagers(`${isTest ? "🧪 ТЕСТ · " : ""}❗ Заказ ${no} не передан в KeyCRM (${attempts} попыток): ${error.slice(0, 200)}. Кнопка «Отправить ещё раз» — в заказе.`, orderId)
      .catch((e) => console.error("[keycrm] тревога не сохранена", e));
  }
}

/**
 * Кнопка в заказе: «Отправить в KeyCRM» / «Отправить ещё раз». Работает и при выключенной передаче. Тестовый заказ — только с
 * подтверждением (`confirmTest`): уходит с номером TEST-HM-… и пометкой «ТЕСТ — не обрабатывать».
 */
export async function sendOrderToKeycrm(orderId: string, who: string, opts: { confirmTest?: boolean } = {}): Promise<DeliverResult> {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, no: true, isTest: true, keycrmId: true, keycrmState: true, keycrmNextTryAt: true } });
  if (!o) return { ok: false, error: "Заказ не найден." };
  if (o.keycrmId) return { ok: false, error: `Заказ уже в KeyCRM: № ${o.keycrmId}.` };
  if (o.isTest && !opts.confirmTest) return { ok: false, error: "Это тестовый заказ: поставьте галочку «Отправить тестовый заказ с пометкой ТЕСТ»." };
  if ((await keycrmMode()) === "off") return { ok: false, error: "KeyCRM не подключён: владелец вписывает API-ключ в «Интеграциях»." };
  const now = new Date();
  if (o.keycrmState === "sending" && o.keycrmNextTryAt && o.keycrmNextTryAt > now) return { ok: false, busy: true, error: "Заказ уже отправляется — обновите страницу через несколько секунд." };
  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { keycrmState: "queued", keycrmNextTryAt: now, keycrmUuid: keycrmUuid(o.no, o.isTest) } }),
    prisma.orderHistory.create({ data: { orderId, text: `Отправка в KeyCRM вручную (${who})${o.isTest ? " — тестовый заказ, с пометкой «ТЕСТ»" : ""}` } }),
    prisma.auditLog.create({ data: { who, action: "keycrm.send", target: orderId, details: json({ no: o.no, test: o.isTest }) } }),
  ]);
  return deliver(orderId, now);
}

// ---------- статусы из KeyCRM ----------

export type StatusApply = "changed" | "unmapped" | "same" | "recorded" | "none";

/**
 * Статус заказа в KeyCRM стал `statusId`. `firstSeenOnly` — мы впервые узнаём статус (опрос): только запоминаем, не меняем на сайте
 * (иначе «Новий» из KeyCRM откатил бы уже оплаченный заказ).
 */
export async function applyKeycrmStatus(orderId: string, statusId: number, via: string, opts: { firstSeenOnly?: boolean } = {}): Promise<StatusApply> {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, no: true, isTest: true, status: true, keycrmStatusId: true } });
  if (!o) return "none";
  if (o.keycrmStatusId === statusId) return "same";
  // вебхук и опрос могут прийти одновременно — статус меняет только тот, кто первым записал новый id
  const upd = await prisma.order.updateMany({
    where: { id: orderId, OR: [{ keycrmStatusId: null }, { keycrmStatusId: { not: statusId } }] },
    data: { keycrmStatusId: statusId, keycrmCheckedAt: new Date() },
  });
  if (!upd.count) return "same";
  if (o.keycrmStatusId === null && opts.firstSeenOnly) return "recorded";
  const s = await loadKeycrmSettings();
  const name = keycrmStatusName(s, statusId);
  const ours = mapKeycrmStatus(s, statusId) as OrderStatus | null;
  if (!ours) {
    await prisma.orderHistory.create({ data: { orderId, text: `В KeyCRM статус «${name}» (${via}) — на сайте не меняем: его нет в таблице соответствия` } });
    return "unmapped";
  }
  if (ours === o.status) {
    await prisma.orderHistory.create({ data: { orderId, text: `В KeyCRM статус «${name}» (${via}) — на сайте уже «${ORDER_STATUS_RU[ours] ?? ours}»` } });
    return "same";
  }
  const r = await setOrderStatus(orderId, ours, "KeyCRM", `в KeyCRM: «${name}», ${via}`);
  if (!r.ok) return "none";
  const auto = await prisma.orderStatusTemplate.count({ where: { status: ours, autoSend: true } });
  if (auto) {
    await sendAutoMessages(orderId, ours, "KeyCRM").catch((e) => console.error("[keycrm] автосообщение не отправлено", e));
  } else {
    // авто-шаблона нет — менеджер решает, что написать покупателю (старое напоминание по этому заказу заменяется новым)
    await prisma.$transaction([
      prisma.pendingNotif.updateMany({ where: { orderId, resolved: false }, data: { resolved: true } }),
      prisma.pendingNotif.create({ data: { orderId, status: ours, keycrmStatus: name } }),
    ]);
    await notifyManagers(`${o.isTest ? "🧪 ТЕСТ · " : ""}🔄 ${o.no}: в KeyCRM статус «${name}» → на сайте «${ORDER_STATUS_RU[ours] ?? ours}». Авто-сообщения нет — напишите покупателю из заказа.`, orderId)
      .catch((e) => console.error("[keycrm] уведомление не сохранено", e));
  }
  return "changed";
}

/** Напоминания «статус сменился в KeyCRM — напишите покупателю» по заказу. */
export const pendingNotifsOf = (orderId: string) =>
  prisma.pendingNotif.findMany({ where: { orderId, resolved: false }, orderBy: { createdAt: "desc" } });

/** Менеджер написал покупателю или нажал «Не нужно писать». */
export async function resolvePendingNotifs(orderId: string): Promise<number> {
  return (await prisma.pendingNotif.updateMany({ where: { orderId, resolved: false }, data: { resolved: true } })).count;
}

// ---------- вебхук ----------

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * Вебхук KeyCRM (смена статуса заказа). Секрет — в адресе (?secret=…) или в заголовке X-Webhook-Secret / Authorization: Bearer.
 * Без секрета в «Интеграциях» вебхук не принимается вовсе. Ответ: код HTTP (200 — принято или не наше, 4xx — отказ).
 */
export async function handleKeycrmWebhook(raw: string, given: string | null): Promise<number> {
  const expected = await secret("keycrm.webhookSecret");
  if (!expected) {
    console.warn("[keycrm] вебхук отклонён: в «Интеграциях» не задан секрет вебхука");
    return 403;
  }
  if (weakWebhookSecret(expected)) {
    // например, шаблон «change-me-too» из .env.example — его знает кто угодно
    console.warn("[keycrm] вебхук отклонён: секрет вебхука слишком простой — задайте свой в «Интеграциях»");
    return 403;
  }
  if (!given || !sameSecret(given, expected)) {
    console.warn("[keycrm] вебхук с неверным секретом — отклонён");
    return 403;
  }
  if (!raw || raw.length > 500_000) return 400;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return 400;
  }
  const wh = readKeycrmWebhook(body);
  if (!wh) return 200; // другое событие KeyCRM — не наше дело
  // в журнал — только то, что нужно для разбора (без телефона и адреса покупателя)
  await prisma.webhookLog.create({ data: { source: "KEYCRM", body: json({ event: wh.event, id: wh.keycrmId, status_id: wh.statusId, source_uuid: wh.sourceUuid, source_id: wh.sourceId }) } });
  let order = await prisma.order.findFirst({ where: { keycrmId: String(wh.keycrmId) }, select: { id: true } });
  if (!order && wh.sourceUuid) {
    // заказ создан, но ответ KeyCRM до нас не дошёл: узнаём его по номеру — только из нашего источника (у старого магазина номера могут совпасть)
    const ours = Number(await secret("keycrm.sourceId"));
    if (wh.sourceId !== null && wh.sourceId === ours) {
      const found = await prisma.order.findFirst({ where: { keycrmId: null, OR: [{ keycrmUuid: wh.sourceUuid }, { no: wh.sourceUuid, isTest: false }] }, select: { id: true, keycrmUuid: true, no: true, isTest: true } });
      if (found) {
        await finish(found.id, found.keycrmUuid ?? keycrmUuid(found.no, found.isTest), { id: wh.keycrmId, statusId: null, sourceUuid: wh.sourceUuid, sourceId: wh.sourceId }, false);
        order = { id: found.id };
      }
    }
  }
  if (!order) return 200;
  if (wh.statusId) await applyKeycrmStatus(order.id, wh.statusId, "вебхук KeyCRM");
  return 200;
}

// ---------- фоновые задачи ----------

/** Раз в минуту (jobs.ts): отправить заказы из очереди, чьё время пришло; раз в 10 минут спросить KeyCRM о статусах открытых заказов. */
export async function processKeycrm(now = new Date()): Promise<number> {
  const mode = await keycrmMode();
  if (mode === "off") return 0;
  const due = await prisma.order.findMany({
    where: { keycrmId: null, keycrmState: { in: ["queued", "error", "sending"] }, keycrmNextTryAt: { lte: now } },
    select: { id: true }, orderBy: { keycrmNextTryAt: "asc" }, take: 10,
  });
  let n = 0;
  for (const d of due) if ((await deliver(d.id, now)).ok) n++;
  if (mode === "live") n += await pollStatuses(now);
  return n;
}

async function pollStatuses(now: Date): Promise<number> {
  const rows = await prisma.order.findMany({
    where: {
      keycrmId: { not: null }, keycrmStub: false, status: { notIn: KEYCRM_CLOSED as OrderStatus[] },
      createdAt: { gte: new Date(now.getTime() - KEYCRM_POLL_DAYS * 86400_000) },
      OR: [{ keycrmCheckedAt: null }, { keycrmCheckedAt: { lte: new Date(now.getTime() - min(KEYCRM_POLL_MIN)) } }],
    },
    select: { id: true, keycrmId: true },
    orderBy: { keycrmCheckedAt: { sort: "asc", nulls: "first" } },
    take: 20, // KeyCRM: до 60 запросов в минуту
  });
  let changed = 0;
  for (const r of rows) {
    try {
      const res = await kc(`/order/${encodeURIComponent(r.keycrmId!)}`, { method: "GET" });
      await prisma.order.update({ where: { id: r.id }, data: { keycrmCheckedAt: now } });
      const info = res.status === 200 ? readKeycrmOrder(res.body) : null;
      if (info?.statusId && (await applyKeycrmStatus(r.id, info.statusId, "опрос KeyCRM", { firstSeenOnly: true })) === "changed") changed++;
    } catch (e) {
      console.error(`[keycrm] опрос статуса ${r.keycrmId}:`, e instanceof Error ? e.message : e);
      break; // нет связи — остальные спросим в следующий раз
    }
  }
  return changed;
}

// ---------- раздел «Интеграции → KeyCRM» ----------

const STUB_STATUSES: KeycrmStatusRow[] = [
  { id: 1, name: "Новий", alias: "new" }, { id: 2, name: "Погоджено", alias: "approved" }, { id: 3, name: "Комплектується", alias: "packing" },
  { id: 4, name: "Відправлено", alias: "shipped" }, { id: 5, name: "Виконано", alias: "completed" }, { id: 6, name: "Скасовано", alias: "canceled" },
];

/** Кнопка «Загрузить статусы из KeyCRM»: список для таблицы соответствия (в заглушке — примерный список). */
export async function refreshKeycrmStatuses(who: string): Promise<KeycrmSettings> {
  const mode = await keycrmMode();
  let statuses: KeycrmStatusRow[];
  if (mode === "stub") statuses = STUB_STATUSES;
  else {
    const r = await kc("/order/status?limit=50", { method: "GET" });
    if (r.status !== 200) throw new KeycrmError(keycrmErrorText(r.status, r.body));
    statuses = readKeycrmStatuses(r.body);
    if (!statuses.length) throw new KeycrmError("KeyCRM не вернул ни одного статуса заказа.");
  }
  const s = await loadKeycrmSettings();
  const next = { ...s, statuses, statusesAt: new Date().toISOString() };
  await saveSettings(next);
  await prisma.auditLog.create({ data: { who, action: "keycrm.statuses", details: json({ count: statuses.length, stub: mode === "stub" }) } });
  return next;
}

export async function keycrmOverview() {
  const [settings, mode, counts, hooks, apiKey, sourceId, whSecret] = await Promise.all([
    loadKeycrmSettings(), keycrmMode(),
    prisma.order.groupBy({ by: ["keycrmState"], where: { keycrmState: { not: null } }, _count: { _all: true } }),
    prisma.webhookLog.findMany({ where: { source: "KEYCRM" }, orderBy: { ts: "desc" }, take: 5 }),
    secret("keycrm.apiKey"), secret("keycrm.sourceId"), secret("keycrm.webhookSecret"),
  ]);
  const weakSecret = !!whSecret && weakWebhookSecret(whSecret);
  const byState = Object.fromEntries(counts.map((c) => [c.keycrmState ?? "", c._count._all]));
  return {
    settings, mode, byState, hooks, hasKey: !!apiKey, hasSource: !!sourceId, webhookSecret: weakSecret ? "" : whSecret, weakSecret,
    webhookBase: `${(process.env.PUBLIC_URL?.trim() || "").replace(/\/+$/, "")}/api/keycrm/webhook`,
  };
}
