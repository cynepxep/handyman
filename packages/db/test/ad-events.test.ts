// Аналитика, шаг А3, на базе handyman_test: покупка с сервера в Meta / TikTok / GA4 — очередь, заглушка, отправка (сеть подменена),
// повторы, неверный ключ и его исправление, какие заказы не уходят, возврат в GA4 при отмене, адрес и браузер стираются, проверка подключения.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ga4ClientId } from "@handyman/core/ad-events";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

process.env.SECRETS_KEY = "test-secrets-key";
for (const k of ["GTM_ID", "GA4_ID", "META_PIXEL_ID", "TIKTOK_PIXEL_ID", "META_CAPI_TOKEN", "TIKTOK_EVENTS_TOKEN", "GA4_API_SECRET", "META_TEST_EVENT_CODE", "TIKTOK_TEST_EVENT_CODE"]) process.env[k] = "";
process.env.PUBLIC_URL = "https://handyman.example";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let an: typeof import("../src/analytics");
let ad: typeof import("../src/ad-events");
let integ: typeof import("../src/integrations");
const SKU = "A3-TEST-1";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> | null };
let calls: Call[] = [];
/** ответ по адресу: meta / tiktok / ga4 */
let reply: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });

const ok = (url: string) =>
  url.includes("graph.facebook.com") ? { status: 200, body: { events_received: 1, fbtrace_id: "x" } }
  : url.includes("tiktok") ? { status: 200, body: { code: 0, message: "OK" } }
  : { status: 204, body: null };

const ctx = { fbp: "fb.1.1712345678901.1234567890", ttp: "ttp-cookie-1", gaClientId: "111.1712345678", ip: "203.0.113.5", ua: "Mozilla/5.0 (iPhone)", url: "http://localhost:3100/checkout" };

const form = (over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: "093 366 24 07", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items: [{ sku: SKU, qty: 2 }], ...over,
});

async function place(over: { isTest?: boolean; adContext?: object | null } = {}) {
  const r = await orders.placeOrder(form(), { lang: "uk", isTest: over.isTest ?? false, adContext: over.adContext === undefined ? ctx : (over.adContext as never) });
  assert.ok(r.ok);
  await ad.adEventsSettled();
  return prisma.order.findUniqueOrThrow({ where: { no: r.no }, include: { adEvents: { orderBy: { platform: "asc" } } } });
}

async function setKeys(values: Record<string, string>) {
  await integ.saveIntegration("analytics", values, "Владелец");
}

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  an = await import("../src/analytics");
  ad = await import("../src/ad-events");
  integ = await import("../src/integrations");
  ad.setAnalyticsFetch(async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const r = reply(url);
    return { status: r.status, text: async () => (r.body === null ? "" : JSON.stringify(r.body)) };
  });
  const brand = await prisma.brand.create({ data: { name: "Milwaukee" } });
  await prisma.product.create({ data: { sku: SKU, nameUk: "Дриль акумуляторний", nameRu: "Дрель", price: 1999.5, categoryId: "ak", brandId: brand.id, supplierAvailable: true } });
  ready = true;
});

beforeEach(async () => {
  if (!ready) return;
  calls = [];
  reply = ok;
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret", "AdEvent"');
  await prisma.setting.deleteMany({ where: { key: "analytics.settings" } });
  integ.integrationsChanged();
  an.analyticsChanged();
});

after(async () => {
  if (ready) {
    ad.setAnalyticsFetch(null);
    integ.setIntegrationsFetch(null);
    await prisma.$disconnect();
  }
  cleanup();
});

test("аналитика выключена — ничего не отправляется, адрес и браузер покупателя в заказе не остаются", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const o = await place();
  assert.equal(o.adEvents.length, 0);
  assert.equal(calls.length, 0);
  const c = o.adContext as Record<string, unknown>;
  assert.equal(c.fbp, ctx.fbp, "куки остаются (пригодятся для отчётов)");
  assert.equal(c.ip, undefined);
  assert.equal(c.ua, undefined);
});

test("включено, ключей нет, не production — заглушка во все три кабинета, в сеть не ходим", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await an.saveAnalyticsSettings(true, "Владелец");
  const o = await place();
  assert.deepEqual(o.adEvents.map((e) => [e.platform, e.kind, e.state, e.stub]), [["ga4", "purchase", "sent", true], ["meta", "purchase", "sent", true], ["tiktok", "purchase", "sent", true]]);
  assert.equal(calls.length, 0);
  assert.equal((o.adContext as Record<string, unknown>).ip, undefined, "всё ушло — адрес стёрт");
  const ov = await ad.adEventsOverview();
  assert.deepEqual(ov.modes, { meta: "stub", tiktok: "stub", ga4: "stub" });
  assert.equal(ov.stats.meta.stub, 1);
});

test("в production без ключей — не отправляем вовсе", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await an.saveAnalyticsSettings(true, "Владелец");
  const env = process.env as Record<string, string | undefined>;
  const was = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    const o = await place();
    assert.equal(o.adEvents.length, 0);
  } finally {
    env.NODE_ENV = was;
  }
});

test("с ключами: Meta, TikTok и GA4 получают покупку с номером заказа, телефон — только SHA-256, токены — куда положено", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await an.saveAnalyticsSettings(true, "Владелец");
  await setKeys({
    metaPixelId: "1234567890123456", metaCapiToken: "EAAB-meta-token-1234567890", metaTestCode: "TEST777",
    tiktokPixelId: "C1ABCDEF2GHIJ3KLMN4O", tiktokToken: "tiktok-token-1234567890abc", ga4Id: "G-ABC123DEF4", ga4ApiSecret: "ga4-secret_123",
  });
  const o = await place();
  assert.deepEqual(o.adEvents.map((e) => [e.platform, e.state, e.stub]), [["ga4", "sent", false], ["meta", "sent", false], ["tiktok", "sent", false]]);
  assert.equal(calls.length, 3);

  const meta = calls.find((c) => c.url.includes("graph.facebook.com"))!;
  assert.match(meta.url, /^https:\/\/graph\.facebook\.com\/v\d+\.0\/1234567890123456\/events\?access_token=EAAB-meta-token-1234567890$/);
  const me = (meta.body!.data as Array<Record<string, any>>)[0];
  assert.equal(me.event_name, "Purchase");
  assert.equal(me.event_id, o.no);
  assert.equal(me.custom_data.value, 3999, "товары после скидок (2 × 1999,50), без доставки");
  assert.deepEqual(me.user_data.ph, [sha("380933662407")]);
  assert.equal(me.user_data.fbp, ctx.fbp);
  assert.equal(me.user_data.client_ip_address, ctx.ip);
  assert.equal(me.event_source_url, "https://handyman.example/checkout", "страница — на домене из PUBLIC_URL");
  assert.equal(meta.body!.test_event_code, "TEST777");

  const tt = calls.find((c) => c.url.includes("tiktok"))!;
  assert.equal(tt.headers["Access-Token"], "tiktok-token-1234567890abc");
  const te = (tt.body!.data as Array<Record<string, any>>)[0];
  assert.equal(te.event, "CompletePayment");
  assert.equal(te.event_id, o.no);
  assert.equal(te.user.phone, sha("+380933662407"));
  assert.equal(te.user.ttp, "ttp-cookie-1");

  const ga = calls.find((c) => c.url.includes("google-analytics"))!;
  assert.match(ga.url, /mp\/collect\?measurement_id=G-ABC123DEF4&api_secret=ga4-secret_123$/);
  assert.equal(ga.body!.client_id, "111.1712345678", "client_id из куки _ga — GA4 склеит с покупкой из браузера");
  const ge = (ga.body!.events as Array<Record<string, any>>)[0];
  assert.equal(ge.name, "purchase");
  assert.equal(ge.params.transaction_id, o.no);
  assert.equal(ge.params.items[0].item_category, "Акумуляторний");
  assert.equal(ge.params.items[0].item_brand, "Milwaukee");

  for (const c of calls) assert.ok(!JSON.stringify(c.body).includes("933662407"), "телефон открытым текстом никуда не уходит");
  assert.equal((o.adContext as Record<string, unknown>).ua, undefined, "всё ушло — браузер покупателя стёрт");
});

test("какие заказы не уходят: тестовый, «подозрительный» (чёрный список), по звонку; «1 клік» — уходит", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await an.saveAnalyticsSettings(true, "Владелец");
  assert.equal((await place({ isTest: true })).adEvents.length, 0);

  const client = await prisma.client.findUniqueOrThrow({ where: { phone: "+380933662407" } });
  await prisma.client.update({ where: { id: client.id }, data: { blockedAt: new Date() } });
  const sus = await place();
  assert.equal(sus.suspicious, "blocked");
  assert.equal(sus.adEvents.length, 0);
  await prisma.client.update({ where: { id: client.id }, data: { blockedAt: null } });

  const m = await orders.placeManualOrder({ phone: "+380931230000", name: "Бригада", items: [{ sku: SKU, qty: 1 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: false }, "Менеджер");
  assert.ok(m.ok);
  await ad.adEventsSettled();
  assert.equal(await prisma.adEvent.count({ where: { orderId: m.ok ? m.id : "" } }), 0);

  const oc = await orders.placeOneClick({ sku: SKU, qty: 1, phone: "0501112233" }, { lang: "uk", adContext: ctx });
  assert.ok(oc.ok);
  await ad.adEventsSettled();
  assert.equal(await prisma.adEvent.count({ where: { order: { no: oc.ok ? oc.no : "" } } }), 3);
});

test("сбой сети — повтор через минуту, адрес покупателя ждёт; неверный токен — без повторов, после нового ключа уходит снова", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await an.saveAnalyticsSettings(true, "Владелец");
  await setKeys({ metaPixelId: "1234567890123456", metaCapiToken: "EAAB-meta-token-1234567890" });
  reply = (url) => (url.includes("graph.facebook.com") ? { status: 503, body: { error: { message: "Service unavailable" } } } : ok(url));
  const o = await place();
  const meta = o.adEvents.find((e) => e.platform === "meta")!;
  assert.equal(meta.state, "error");
  assert.equal(meta.attempts, 1);
  assert.ok(meta.nextTryAt && meta.nextTryAt.getTime() - Date.now() > 30_000 && meta.nextTryAt.getTime() - Date.now() < 90_000, "через минуту");
  assert.match(meta.error ?? "", /Meta: Service unavailable/);
  assert.equal((o.adContext as Record<string, unknown>).ip, ctx.ip, "Meta ещё будет повторять — адрес нужен");
  assert.equal(o.adEvents.find((e) => e.platform === "ga4")?.stub, true, "без ключа GA4 — заглушка");

  // рано — не трогаем; через 2 минуты — уходит
  assert.equal(await ad.processAdEvents(new Date()), 0);
  reply = ok;
  calls = [];
  assert.equal(await ad.processAdEvents(new Date(Date.now() + 2 * 60_000)), 1);
  const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { adEvents: true } });
  assert.equal(after.adEvents.find((e) => e.platform === "meta")?.state, "sent");
  assert.equal((after.adContext as Record<string, unknown>).ip, undefined, "всё ушло — адрес стёрт");

  // неверный токен: без повторов, ошибка — в журнал ошибок
  reply = (url) => (url.includes("graph.facebook.com") ? { status: 400, body: { error: { message: "Invalid OAuth access token.", code: 190 } } } : ok(url));
  const o2 = await place();
  const m2 = o2.adEvents.find((e) => e.platform === "meta")!;
  assert.equal(m2.state, "error");
  assert.equal(m2.nextTryAt, null);
  assert.ok(await prisma.errorLog.count({ where: { message: { contains: o2.no } } }), "в «Ошибках»");
  // владелец вписал новый токен — недавняя ошибка уходит снова
  reply = ok;
  await setKeys({ metaCapiToken: "EAAB-meta-token-NEW-0987654321" });
  assert.equal((await prisma.adEvent.findUniqueOrThrow({ where: { id: m2.id } })).state, "queued");
  calls = [];
  assert.equal(await ad.processAdEvents(new Date(Date.now() + 1000)), 1);
  assert.match(calls[0].url, /access_token=EAAB-meta-token-NEW-0987654321/);
});

test("одновременные повторы не отправляют одно событие дважды", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await an.saveAnalyticsSettings(true, "Владелец");
  await setKeys({ ga4Id: "G-ABC123DEF4", ga4ApiSecret: "ga4-secret_123" });
  reply = () => ({ status: 500, body: null });
  const o = await place();
  assert.equal(o.adEvents.find((e) => e.platform === "ga4")?.state, "error");
  reply = ok;
  calls = [];
  const later = new Date(Date.now() + 5 * 60_000);
  const [a, b] = await Promise.all([ad.processAdEvents(later), ad.processAdEvents(later)]);
  assert.equal(a + b, 1);
  assert.equal(calls.length, 1);
});

test("отмена заказа — возврат в GA4 (один раз), если покупка там посчитана; Meta и TikTok отмену не получают", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await an.saveAnalyticsSettings(true, "Владелец");
  await setKeys({ ga4Id: "G-ABC123DEF4", ga4ApiSecret: "ga4-secret_123", metaPixelId: "1234567890123456", metaCapiToken: "EAAB-meta-token-1234567890" });
  const o = await place({ adContext: null });
  calls = [];
  assert.deepEqual(await orders.setOrderStatus(o.id, "CANCELLED", "Менеджер", undefined, "client_refused"), { ok: true });
  await ad.adEventsSettled();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /google-analytics/);
  const ev = (calls[0].body!.events as Array<Record<string, any>>)[0];
  assert.equal(ev.name, "refund");
  assert.equal(ev.params.transaction_id, o.no);
  assert.equal(ev.params.value, 3999);
  assert.equal(calls[0].body!.client_id, ga4ClientId(o, {}), "без куки _ga — тот же client_id, что у покупки");
  // повторная смена (отмена → возврат) второго «возврата» не даёт
  await orders.setOrderStatus(o.id, "RETURNED", "Менеджер");
  await ad.adEventsSettled();
  assert.equal(calls.length, 1);
  assert.equal(await prisma.adEvent.count({ where: { orderId: o.id, kind: "refund" } }), 1);

  // покупка в GA4 не посчитана (аналитика была выключена, событие в браузер не отдано) — возврата нет
  await an.saveAnalyticsSettings(false, "Владелец");
  const o2 = await place();
  await an.saveAnalyticsSettings(true, "Владелец");
  calls = [];
  await orders.setOrderStatus(o2.id, "CANCELLED", "Менеджер");
  await ad.adEventsSettled();
  assert.equal(calls.length, 0);
  // а если событие было отдано в браузер (Order.analyticsAt) — возврат уходит
  const o3 = await place();
  await prisma.adEvent.deleteMany({ where: { orderId: o3.id } });
  await prisma.order.update({ where: { id: o3.id }, data: { analyticsAt: new Date() } });
  calls = [];
  await orders.setOrderStatus(o3.id, "CANCELLED", "Менеджер");
  await ad.adEventsSettled();
  assert.equal(calls.length, 1);
});

test("«Проверить подключение»: GTM + токен Meta + формат события GA4 одной строкой", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await setKeys({ gtmId: "GTM-AB12CD3", ga4Id: "G-ABC123DEF4", ga4ApiSecret: "ga4-secret_123", metaPixelId: "1234567890123456", metaCapiToken: "EAAB-meta-token-1234567890" });
  integ.setIntegrationsFetch(async () => ({ status: 200, json: async () => ({}) }));
  reply = (url) =>
    url.includes("graph.facebook.com") ? { status: 200, body: { id: "1234567890123456", name: "Handyman pixel" } }
    : url.includes("debug/mp") ? { status: 200, body: { validationMessages: [] } }
    : ok(url);
  const r = await integ.checkIntegration("analytics", "Владелец");
  assert.equal(r.ok, true);
  assert.match(r.message, /GTM-AB12CD3 найден/);
  assert.match(r.message, /Meta: токен Conversions API принят, пиксель «Handyman pixel»/);
  assert.match(r.message, /Google Analytics: формат покупки с сервера верный/);
  assert.ok(calls.some((c) => c.url.includes("debug/mp/collect")));

  reply = (url) => (url.includes("graph.facebook.com") ? { status: 400, body: { error: { message: "Invalid OAuth access token." } } } : { status: 200, body: { validationMessages: [] } });
  const bad = await integ.checkIntegration("analytics", "Владелец");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Meta не приняла токен/);
  // неверный формат ключа не сохраняется
  await assert.rejects(setKeys({ metaTestCode: "abc" }), /TEST12345/);
  await assert.rejects(setKeys({ ga4ApiSecret: "секрет с пробелом" }), /Секрет API/);
});
