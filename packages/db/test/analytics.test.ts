// Аналитика (шаг А1) на базе handyman_test: включатель и ID для витрины, событие покупки — один раз на заказ (и не для тестовых,
// «подозрительных», из браузера с админкой), метки рекламы в заказе, проверка контейнера GTM, пункт «Проверки перед запуском».
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

process.env.SECRETS_KEY = "test-secrets-key";
process.env.GTM_ID = "";
process.env.GA4_ID = "";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let an: typeof import("../src/analytics");
let integ: typeof import("../src/integrations");
let lc: typeof import("../src/launch-check");
const SKU = "A1-TEST-1";

const form = (over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: "093 366 24 07", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items: [{ sku: SKU, qty: 2 }], ...over,
});

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  an = await import("../src/analytics");
  integ = await import("../src/integrations");
  lc = await import("../src/launch-check");
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret"');
  integ.integrationsChanged();
  an.analyticsChanged();
  const brand = await prisma.brand.create({ data: { name: "Milwaukee" } });
  await prisma.product.create({ data: { sku: SKU, nameUk: "Дриль акумуляторний", nameRu: "Дрель", price: 1999.5, categoryId: "ak", brandId: brand.id, supplierAvailable: true } });
  ready = true;
});

after(async () => {
  if (ready) {
    integ.setIntegrationsFetch(null);
    await prisma.$disconnect();
  }
  process.env.GTM_ID = "";
  process.env.GA4_ID = "";
  cleanup();
});

test("включатель и ID: по умолчанию выключено; включено без ID контейнера — ничего не грузится; новый ID виден сразу", async (t) => {
  if (!ready) return t.skip(skipMsg);
  assert.equal((await an.loadAnalyticsSettings()).enabled, false);
  assert.equal((await an.analyticsConfig()).on, false);
  await an.saveAnalyticsSettings(true, "Владелец");
  const st = await an.loadAnalyticsSettings();
  assert.equal(st.enabled, true);
  assert.equal(st.by, "Владелец");
  assert.equal((await an.analyticsConfig()).on, false, "включено, но ID контейнера нет");
  const log = await prisma.auditLog.findFirst({ where: { action: "analytics.toggle" }, orderBy: { ts: "desc" } });
  assert.deepEqual(log?.details, { enabled: true });

  // неверный ID из .env не используется
  process.env.GTM_ID = "gtm-wrong";
  an.analyticsChanged();
  assert.equal((await an.analyticsConfig()).on, false);
  process.env.GTM_ID = "";

  // ID из «Интеграций»: неверный формат не сохраняется, верный — сразу на витрине (без ожидания 30 секунд)
  await assert.rejects(integ.saveIntegration("analytics", { gtmId: "GTM-ab" }, "Владелец"), /GTM-ABC1234/);
  await integ.saveIntegration("analytics", { gtmId: "GTM-AB12CD3", ga4Id: "G-ABC123DEF4", metaPixelId: "1234567890123456" }, "Владелец");
  const c = await an.analyticsConfig();
  assert.equal(c.on, true);
  assert.equal(c.ids.gtmId, "GTM-AB12CD3");
  assert.equal(c.ids.ga4Id, "G-ABC123DEF4");
  assert.equal(c.ids.tiktokPixelId, "");
  await an.saveAnalyticsSettings(false, "Владелец");
  assert.equal((await an.analyticsConfig()).on, false, "выключили — сразу ничего не грузится");
  await an.saveAnalyticsSettings(true, "Владелец");
});

test("«Проверить подключение»: Google отдаёт gtm.js только опубликованного контейнера", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const urls: string[] = [];
  let status = 200;
  integ.setIntegrationsFetch((url) => {
    urls.push(url);
    return Promise.resolve({ status, json: () => Promise.reject(new Error("это скрипт, не JSON")) });
  });
  const ok = await integ.checkIntegration("analytics", "Владелец");
  assert.equal(ok.ok, true, ok.message);
  assert.match(ok.message, /GTM-AB12CD3 найден/);
  assert.match(ok.message, /Google Analytics 4, Meta Pixel/);
  assert.equal(urls[0], "https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD3");
  status = 404;
  const bad = await integ.checkIntegration("analytics", "Владелец");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /не нашёл/);
  status = 200;
  await integ.checkIntegration("analytics", "Владелец");
  const facts = await lc.launchFacts();
  assert.equal(facts.analytics.enabled, true);
  const item = (await lc.launchCheck()).find((i) => i.id === "analytics");
  assert.equal(item?.status, "ok");
});

test("покупка: один раз на заказ — второй показ «Дякуємо» и одновременные запросы без события; цены и метки — из заказа", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const utm = { utm_source: "google", utm_medium: "cpc", utm_campaign: "drills", gclid: "Cj0-abc", landing: "/catalog/dryli", at: "2026-10-04T09:00:00.000Z" };
  const r = await orders.placeOrder(form(), { lang: "uk", utm });
  assert.ok(r.ok);
  if (!r.ok) return;
  const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no }, include: { items: true } });
  assert.deepEqual(o.utm, utm, "метки рекламы сохранены в заказе");
  assert.equal(o.analyticsAt, null);

  assert.deepEqual(await an.claimPurchase(r.no, "wrong-key-123"), { send: false, reason: "not_found" }, "без правильного ключа — ничего");
  const [a, b] = await Promise.all([an.claimPurchase(r.no, r.accessKey), an.claimPurchase(r.no, r.accessKey)]);
  const sent = [a, b].filter((x) => x.send);
  assert.equal(sent.length, 1, "одновременно — событие получает только один");
  const claim = sent[0];
  if (!claim.send) return;
  assert.equal(claim.no, r.no);
  assert.deepEqual(claim.lines, [{ sku: SKU, name: "Дриль акумуляторний", qty: 2, unitPrice: o.items[0].unitPrice.toNumber(), brand: "Milwaukee", categoryId: "ak" }]);
  assert.ok((await prisma.order.findUniqueOrThrow({ where: { no: r.no } })).analyticsAt, "флаг поставлен");
  assert.deepEqual(await an.claimPurchase(r.no, r.accessKey), { send: false, reason: "sent" }, "обновили страницу — второй раз не считаем");
});

test("покупка: тестовый, «подозрительный» и из браузера с админкой — без события, флаг не ставится; без меток — пусто", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const test1 = await orders.placeOrder(form(), { lang: "uk", isTest: true });
  assert.ok(test1.ok);
  if (!test1.ok) return;
  assert.deepEqual(await an.claimPurchase(test1.no, test1.accessKey), { send: false, reason: "test" });

  const plain = await orders.placeOrder(form(), { lang: "uk" });
  assert.ok(plain.ok);
  if (!plain.ok) return;
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: plain.no } })).utm, null, "пришёл не по рекламе — меток нет");
  assert.deepEqual(await an.claimPurchase(plain.no, plain.accessKey, { staff: true }), { send: false, reason: "staff" });
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: plain.no } })).analyticsAt, null, "сотрудник смотрел — покупку потом ещё можно засчитать");

  await prisma.client.update({ where: { phone: "+380933662407" }, data: { blockedAt: new Date(), blockedBy: "test" } });
  const sus = await orders.placeOrder(form(), { lang: "uk" });
  assert.ok(sus.ok);
  if (!sus.ok) return;
  assert.deepEqual(await an.claimPurchase(sus.no, sus.accessKey), { send: false, reason: "suspicious" });
  await prisma.client.update({ where: { phone: "+380933662407" }, data: { blockedAt: null, blockedBy: null } });

  // «1 клік» — тоже заказ: метки сохраняются, покупка засчитывается один раз
  const one = await orders.placeOneClick({ sku: SKU, phone: "050 111 22 33" }, { lang: "ru", utm: { fbclid: "IwAR-x" } });
  assert.ok(one.ok);
  if (!one.ok) return;
  assert.deepEqual((await prisma.order.findUniqueOrThrow({ where: { no: one.no } })).utm, { fbclid: "IwAR-x" });
  assert.equal((await an.claimPurchase(one.no, one.accessKey)).send, true);
  assert.equal((await an.claimPurchase(one.no, one.accessKey)).send, false);
});
