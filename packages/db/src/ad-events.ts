// Аналитика, шаг А3: покупка с сервера в Meta (Conversions API), TikTok (Events API) и GA4 (Measurement Protocol); отмена — возврат в GA4.
//
// Заказ создан (сайт или «1 клік»; не тестовый, не «подозрительный») и аналитика включена → по строке очереди AdEvent на каждый кабинет,
// у которого есть ключ, и сразу отправка в фоне (покупатель не ждёт). Не вышло из-за сети или перегрузки — повторы в runJobs
// (1, 5, 15, 60, 180, 720 минут); неверный токен — без повторов (после исправления ключа в «Интеграциях» недавние ошибки уходят снова).
// Без ключа: на компьютере разработки — заглушка (строка помечается stub, в сеть не ходим, запись в консоль), в production — не отправляем.
// Заказ отменён или возвращён, а покупка в GA4 была посчитана (с сервера или из браузера) — событие refund в GA4.
// Куки рекламы, адрес и браузер покупателя кладутся в заказ при оформлении (Order.adContext); адрес и браузер стираются, когда
// покупка ушла во все кабинеты. Ключи — только через secret("analytics.…"); тела запросов и разбор ответов — @handyman/core/ad-events.

import {
  AD_PLATFORMS, AD_PLATFORM_RU, AD_SENDING_STALE_MIN, GA4_MP_DEBUG_URL, GA4_MP_URL, META_GRAPH_VERSION, TIKTOK_EVENTS_URL, adPurchaseAllowed, adRetryDelayMin,
  adSourceUrl, ga4Body, metaPurchaseBody, parseAdContext, readGa4DebugCheck, readGa4Send, readMetaCheck, readMetaSend, readTiktokSend, tiktokPurchaseBody,
  type AdContext, type AdKind, type AdOrder, type AdPlatform, type AdSendResult,
} from "@handyman/core/ad-events";
import { analyticsIdError } from "@handyman/core/shop";
import { prisma, Prisma } from "./client";
import { secret } from "./integrations";
import { loadAnalyticsSettings } from "./analytics";
import { logError } from "./errors";

const min = (n: number) => n * 60_000;

// ---------- ключи и режим ----------

type Creds = {
  meta: { pixelId: string; token: string; testCode: string };
  tiktok: { pixelId: string; token: string; testCode: string };
  ga4: { measurementId: string; apiSecret: string };
};

async function creds(): Promise<Creds> {
  const [metaPixelId, metaToken, metaTest, ttPixelId, ttToken, ttTest, ga4Id, ga4Secret] = await Promise.all([
    secret("analytics.metaPixelId"), secret("analytics.metaCapiToken"), secret("analytics.metaTestCode"),
    secret("analytics.tiktokPixelId"), secret("analytics.tiktokToken"), secret("analytics.tiktokTestCode"),
    secret("analytics.ga4Id"), secret("analytics.ga4ApiSecret"),
  ]);
  // значения из .env не проходили проверку формы — неверное просто не используем
  const ok = (field: string, v: string) => (v && !analyticsIdError(field, v) ? v : "");
  return {
    meta: { pixelId: ok("metaPixelId", metaPixelId), token: ok("metaCapiToken", metaToken), testCode: ok("metaTestCode", metaTest) },
    tiktok: { pixelId: ok("tiktokPixelId", ttPixelId), token: ok("tiktokToken", ttToken), testCode: ok("tiktokTestCode", ttTest) },
    ga4: { measurementId: ok("ga4Id", ga4Id), apiSecret: ok("ga4ApiSecret", ga4Secret) },
  };
}

export type AdMode = "live" | "stub" | "off";

/** live — ID и ключ есть; stub — ключа нет, но это не production (заглушка); off — не отправляем. */
export async function adModes(c?: Creds): Promise<Record<AdPlatform, AdMode>> {
  const k = c ?? (await creds());
  const none: AdMode = process.env.NODE_ENV === "production" ? "off" : "stub";
  return {
    meta: k.meta.pixelId && k.meta.token ? "live" : none,
    tiktok: k.tiktok.pixelId && k.tiktok.token ? "live" : none,
    ga4: k.ga4.measurementId && k.ga4.apiSecret ? "live" : none,
  };
}

// ---------- сеть ----------

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Для тестов: подменить запросы к Meta, TikTok и Google (null — обычный fetch). */
export const setAnalyticsFetch = (f: FetchLike | null) => {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
};

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* GA4 отвечает пустым телом */
  }
  return { status: res.status, body: parsed };
}

async function send(platform: AdPlatform, kind: AdKind, o: AdOrder, ctx: AdContext, c: Creds): Promise<AdSendResult> {
  const sourceUrl = adSourceUrl(ctx, process.env.PUBLIC_URL);
  try {
    if (platform === "meta") {
      const ver = process.env.META_GRAPH_VERSION?.trim() || META_GRAPH_VERSION;
      const url = `https://graph.facebook.com/${ver}/${encodeURIComponent(c.meta.pixelId)}/events?access_token=${encodeURIComponent(c.meta.token)}`;
      const r = await post(url, metaPurchaseBody(o, ctx, { sourceUrl, testCode: c.meta.testCode || undefined }));
      return readMetaSend(r.status, r.body);
    }
    if (platform === "tiktok") {
      const r = await post(TIKTOK_EVENTS_URL, tiktokPurchaseBody(o, ctx, { pixelId: c.tiktok.pixelId, sourceUrl, testCode: c.tiktok.testCode || undefined }), { "Access-Token": c.tiktok.token });
      return readTiktokSend(r.status, r.body);
    }
    const url = `${GA4_MP_URL}?measurement_id=${encodeURIComponent(c.ga4.measurementId)}&api_secret=${encodeURIComponent(c.ga4.apiSecret)}`;
    const r = await post(url, ga4Body(kind, o, ctx));
    return readGa4Send(r.status);
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, retry: true, error: `${AD_PLATFORM_RU[platform]}: ${timeout ? "не ответил за 15 секунд" : "нет связи (нет интернета или сервис недоступен)"}` };
  }
}

// отправки, запущенные «в фоне» после оформления заказа (тесты ждут их через adEventsSettled)
const inflight = new Set<Promise<unknown>>();
function background(p: Promise<unknown>) {
  const t = p.catch((e) => logError("[ad-events]", e instanceof Error ? e.message : e)).finally(() => inflight.delete(t));
  inflight.add(t);
}
/** Для тестов: дождаться фоновых отправок. */
export async function adEventsSettled(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

// ---------- очередь ----------

/** Вызывается после создания заказа (orders.ts). Ошибка здесь никогда не мешает оформлению. */
export async function queueAdPurchase(orderId: string): Promise<void> {
  try {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { isTest: true, suspicious: true, source: true } });
    if (!o) return;
    const modes = await adModes();
    const platforms = adPurchaseAllowed(o) && (await loadAnalyticsSettings()).enabled ? AD_PLATFORMS.filter((p) => modes[p] !== "off") : [];
    if (!platforms.length) {
      await scrubIfDone(orderId);
      return;
    }
    await prisma.adEvent.createMany({ data: platforms.map((platform) => ({ orderId, platform, kind: "purchase", nextTryAt: new Date() })), skipDuplicates: true });
    background(deliverOrder(orderId));
  } catch (e) {
    logError("[ad-events] покупка не поставлена в очередь:", e instanceof Error ? e.message : e);
  }
}

/**
 * Заказ отменён или возвращён (orders.ts → setOrderStatus): возврат в GA4 — если покупка там посчитана (ушла с сервера
 * или событие отдано в браузер — Order.analyticsAt). В Meta и TikTok отмену не передают (Д75).
 */
export async function queueAdRefund(orderId: string): Promise<void> {
  try {
    const o = await prisma.order.findUnique({
      where: { id: orderId },
      select: { isTest: true, suspicious: true, source: true, analyticsAt: true, adEvents: { where: { platform: "ga4", kind: "purchase", state: "sent" }, select: { id: true } } },
    });
    if (!o || !adPurchaseAllowed(o) || (!o.analyticsAt && !o.adEvents.length)) return;
    if (!(await loadAnalyticsSettings()).enabled || (await adModes()).ga4 === "off") return;
    const r = await prisma.adEvent.createMany({ data: [{ orderId, platform: "ga4", kind: "refund", nextTryAt: new Date() }], skipDuplicates: true });
    if (r.count) background(deliverOrder(orderId));
  } catch (e) {
    logError("[ad-events] возврат не поставлен в очередь:", e instanceof Error ? e.message : e);
  }
}

async function deliverOrder(orderId: string): Promise<void> {
  const rows = await prisma.adEvent.findMany({ where: { orderId, state: { in: ["queued", "error"] } }, select: { id: true } });
  for (const r of rows) await deliver(r.id);
}

/** Взять отправку себе: одна попытка за раз (фоновая задача и вторая копия сайта не отправят событие дважды). */
async function claim(id: string, now: Date): Promise<boolean> {
  const r = await prisma.adEvent.updateMany({
    where: { id, state: { in: ["queued", "error", "sending"] }, nextTryAt: { lte: now } },
    // «sending» с истёкшим сроком — прошлая попытка оборвалась (перезапуск сайта): через 3 минуты её можно взять снова
    data: { state: "sending", nextTryAt: new Date(now.getTime() + min(AD_SENDING_STALE_MIN)) },
  });
  return r.count === 1;
}

async function loadOrder(orderId: string): Promise<{ order: AdOrder; ctx: AdContext } | null> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      no: true, createdAt: true, clientId: true, recipientPhone: true, adContext: true, client: { select: { email: true } },
      items: { select: { sku: true, name: true, qty: true, unitPrice: true, product: { select: { brand: { select: { name: true } }, category: { select: { nameUk: true } } } } } },
    },
  });
  if (!o) return null;
  return {
    order: {
      no: o.no, createdAt: o.createdAt, clientId: o.clientId, phone: o.recipientPhone, email: o.client.email,
      lines: o.items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, unitPrice: i.unitPrice.toNumber(), brand: i.product?.brand?.name ?? null, category: i.product?.category?.nameUk ?? null })),
    },
    ctx: parseAdContext(o.adContext),
  };
}

async function deliver(id: string, now = new Date()): Promise<boolean> {
  if (!(await claim(id, now))) return false;
  const ev = await prisma.adEvent.findUnique({ where: { id } });
  if (!ev) return false;
  const platform = ev.platform as AdPlatform;
  const kind = ev.kind as AdKind;
  const data = await loadOrder(ev.orderId);
  if (!data) return false;
  const c = await creds();
  const mode = (await adModes(c))[platform];
  let r: AdSendResult;
  let stub = false;
  if (mode === "off") r = { ok: false, retry: false, error: `${AD_PLATFORM_RU[platform]}: ключ не задан в «Интеграциях»` };
  else if (mode === "stub") {
    stub = true;
    r = { ok: true };
    console.info(`[ad-events] заглушка: ${kind} ${data.order.no} → ${AD_PLATFORM_RU[platform]} (ключа нет — в сеть не ходим)`);
  } else r = await send(platform, kind, data.order, data.ctx, c);

  const attempts = ev.attempts + 1;
  if (r.ok) {
    await prisma.adEvent.update({ where: { id }, data: { state: "sent", sentAt: new Date(), attempts, error: null, nextTryAt: null, stub } });
  } else {
    const delay = r.retry ? adRetryDelayMin(attempts) : null;
    await prisma.adEvent.update({
      where: { id },
      data: { state: "error", attempts, error: r.error.slice(0, 500), nextTryAt: delay === null ? null : new Date(now.getTime() + min(delay)) },
    });
    if (delay === null) {
      // больше не пробуем — видно в заказе (блок «Реклама: покупка с сервера») и в «Ошибках»
      logError(`[ad-events] ${kind === "refund" ? "возврат" : "покупка"} ${data.order.no} не передана в ${AD_PLATFORM_RU[platform]}: ${r.error}`);
    }
  }
  if (kind === "purchase") await scrubIfDone(ev.orderId);
  return r.ok;
}

/** Покупка ушла во все кабинеты (или больше не пробуем) — адрес и браузер покупателя из заказа стираются. */
async function scrubIfDone(orderId: string): Promise<void> {
  const pending = await prisma.adEvent.count({
    where: { orderId, kind: "purchase", OR: [{ state: { in: ["queued", "sending"] } }, { state: "error", nextTryAt: { not: null } }] },
  });
  if (pending) return;
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { adContext: true } });
  const ctx = parseAdContext(o?.adContext);
  if (!ctx.ip && !ctx.ua) return;
  delete ctx.ip;
  delete ctx.ua;
  await prisma.order.update({ where: { id: orderId }, data: { adContext: ctx as Prisma.InputJsonValue } });
}

/** Раз в минуту (jobs.ts): события, чьё время пришло (повторы после сбоев, оборванные отправки). */
export async function processAdEvents(now = new Date()): Promise<number> {
  const due = await prisma.adEvent.findMany({
    where: { state: { in: ["queued", "error", "sending"] }, nextTryAt: { lte: now } },
    select: { id: true }, orderBy: { nextTryAt: "asc" }, take: 20,
  });
  let n = 0;
  for (const d of due) if (await deliver(d.id, now)) n++;
  return n;
}

/**
 * Ключи в «Интеграциях → Аналитика» поменяли: покупки последних 6 дней, которые не ушли из-за неверного ключа (без повторов),
 * отправляются снова (Meta принимает покупку не старше 7 дней).
 */
export async function requeueAdErrors(now = new Date()): Promise<number> {
  const r = await prisma.adEvent.updateMany({
    where: { state: "error", nextTryAt: null, createdAt: { gte: new Date(now.getTime() - 6 * 86400_000) } },
    data: { state: "queued", nextTryAt: now },
  });
  return r.count;
}

// ---------- для админки ----------

/** Блок в заказе: куда и как ушла покупка. */
export const adEventsOf = (orderId: string) => prisma.adEvent.findMany({ where: { orderId }, orderBy: [{ kind: "asc" }, { platform: "asc" }] });

/** Режим каждого кабинета и сколько событий за 7 дней ушло / не ушло — для «Интеграций». */
export async function adEventsOverview(now = new Date()) {
  const [modes, rows, enabled] = await Promise.all([
    adModes(),
    prisma.adEvent.groupBy({ by: ["platform", "state", "stub"], where: { createdAt: { gte: new Date(now.getTime() - 7 * 86400_000) } }, _count: { _all: true } }),
    loadAnalyticsSettings().then((s) => s.enabled),
  ]);
  const stats = Object.fromEntries(AD_PLATFORMS.map((p) => [p, { sent: 0, stub: 0, failed: 0, waiting: 0 }])) as Record<AdPlatform, { sent: number; stub: number; failed: number; waiting: number }>;
  for (const r of rows) {
    const s = stats[r.platform as AdPlatform];
    if (!s) continue;
    if (r.state === "sent") s[r.stub ? "stub" : "sent"] += r._count._all;
    else if (r.state === "error") s.failed += r._count._all;
    else s.waiting += r._count._all;
  }
  return { enabled, modes, stats };
}

/** «Проверить подключение» (Интеграции → Аналитика): строки о покупке с сервера — Meta (токен) и GA4 (формат события). TikTok — через Test Events. */
export async function checkAdServers(): Promise<{ ok: boolean; lines: string[] }> {
  const c = await creds();
  const lines: string[] = [];
  let ok = true;
  const fail = (m: string) => {
    ok = false;
    lines.push(m);
  };
  try {
    if (c.meta.token && c.meta.pixelId) {
      const ver = process.env.META_GRAPH_VERSION?.trim() || META_GRAPH_VERSION;
      const res = await fetchImpl(`https://graph.facebook.com/${ver}/${encodeURIComponent(c.meta.pixelId)}?fields=id,name&access_token=${encodeURIComponent(c.meta.token)}`, {
        method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000),
      });
      const r = readMetaCheck(res.status, JSON.parse((await res.text().catch(() => "")) || "null"));
      if (r.ok) lines.push(r.message);
      else fail(r.message);
    } else if (c.meta.token) fail("Meta: токен Conversions API есть, а ID пикселя — нет.");
    if (c.ga4.apiSecret && c.ga4.measurementId) {
      const sample: AdOrder = { no: "HM-TEST", createdAt: new Date(), clientId: "check", phone: null, email: null, lines: [{ sku: "TEST", name: "Перевірка", qty: 1, unitPrice: 1 }] };
      const res = await post(`${GA4_MP_DEBUG_URL}?measurement_id=${encodeURIComponent(c.ga4.measurementId)}&api_secret=${encodeURIComponent(c.ga4.apiSecret)}`, ga4Body("purchase", sample, {}));
      const r = readGa4DebugCheck(res.status, res.body);
      if (r.ok) lines.push(r.message);
      else fail(r.message);
    } else if (c.ga4.apiSecret) fail("Google Analytics: секрет API есть, а идентификатора потока (G-…) — нет.");
    if (c.tiktok.token && c.tiktok.pixelId) lines.push("TikTok: токен Events API вписан — проверка только настоящей покупкой (TikTok Events → «Тестовые события», с кодом тестовых событий).");
    else if (c.tiktok.token) fail("TikTok: токен Events API есть, а ID пикселя — нет.");
  } catch {
    fail("Покупка с сервера: не удалось связаться с Meta или Google (нет интернета или сервис недоступен).");
  }
  return { ok, lines };
}
