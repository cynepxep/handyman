// Аналитика (шаг А1): товары для событий GA4, «слать ли покупку», метки рекламы, ID кабинетов, пункт «Проверки перед запуском».
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ECOMMERCE_EVENTS, analyticsConfigPush, analyticsIdError, analyticsItem, ecommerceOf, itemsValue, parseUtm, purchaseDecision, purchaseEvent,
  utmFromParams, utmLabel,
} from "../src/shop/analytics";
import { validateField } from "../src/integrations";
import { readGtmCheck } from "../src/integrations";
import { launchChecklist, type LaunchFacts } from "../src/launch-check";

test("товар события: артикул, название, бренд, категории меню без повторов, цена до копейки, пустых полей нет", () => {
  const it = analyticsItem({
    sku: "4933479862", name: "  Дриль-шуруповерт   Milwaukee M18 ", brand: "Milwaukee",
    categories: ["Електроінструмент", "Дрилі-шуруповерти", "Дрилі-шуруповерти", null], price: 4999.999, qty: 2,
  });
  assert.deepEqual(it, {
    item_id: "4933479862", item_name: "Дриль-шуруповерт Milwaukee M18", item_brand: "Milwaukee",
    item_category: "Електроінструмент", item_category2: "Дрилі-шуруповерти", price: 5000, quantity: 2,
  });
  const bare = analyticsItem({ sku: "A1", name: "Біта", brand: " ", price: 12.5 });
  assert.deepEqual(bare, { item_id: "A1", item_name: "Біта", price: 12.5, quantity: 1 }, "без бренда и категорий — поля не попадают");
  const listed = analyticsItem({ sku: "A1", name: "Біта", price: 10, qty: 0, listId: "group:bits", listName: "Біти", index: 3 });
  assert.equal(listed.quantity, 1, "количество не меньше 1");
  assert.equal(listed.item_list_id, "group:bits");
  assert.equal(listed.index, 3);
});

test("сумма товаров и поле ecommerce: валюта UAH, value = Σ цена × количество", () => {
  const items = [analyticsItem({ sku: "A", name: "A", price: 292.5, qty: 3 }), analyticsItem({ sku: "B", name: "B", price: 0.1, qty: 3 })];
  assert.equal(itemsValue(items), 877.8);
  const e = ecommerceOf(items, { coupon: undefined });
  assert.equal(e.currency, "UAH");
  assert.equal(e.value, 877.8);
  assert.equal(e.items.length, 2);
  assert.ok(ECOMMERCE_EVENTS.has("purchase") && ECOMMERCE_EVENTS.has("add_to_wishlist"));
  assert.ok(!ECOMMERCE_EVENTS.has("search") && !ECOMMERCE_EVENTS.has("phone_click"), "не e-commerce — без сброса ecommerce");
});

test("покупка: номер заказа = transaction_id = event_id, сумма — цены заказа (после скидок), доставка 0", () => {
  const e = purchaseEvent("HM-1042", [
    { sku: "A", name: "Дриль", qty: 1, unitPrice: 3800, brand: "Bosch", categories: ["Електроінструмент"] },
    { sku: "B", name: "Біта", qty: 10, unitPrice: 27.55 },
  ]);
  assert.equal(e.event, "purchase");
  assert.equal(e.event_id, "HM-1042");
  assert.equal(e.ecommerce.transaction_id, "HM-1042");
  assert.equal(e.ecommerce.value, 4075.5);
  assert.equal(e.ecommerce.shipping, 0);
  assert.equal(e.ecommerce.items[0].item_brand, "Bosch");
  assert.equal(e.ecommerce.items[1].quantity, 10);
});

test("слать ли покупку: один раз; тестовые, «подозрительные» и из браузера с админкой — нет", () => {
  const base = { isTest: false, suspicious: null, analyticsAt: null };
  assert.deepEqual(purchaseDecision(base), { send: true });
  assert.deepEqual(purchaseDecision({ ...base, analyticsAt: new Date() }), { send: false, reason: "sent" });
  assert.deepEqual(purchaseDecision({ ...base, isTest: true }), { send: false, reason: "test" });
  assert.deepEqual(purchaseDecision({ ...base, suspicious: "blocked" }), { send: false, reason: "suspicious" });
  assert.deepEqual(purchaseDecision({ ...base, staff: true }), { send: false, reason: "staff" });
});

test("метки рекламы: из адреса входа, только известные, обрезанные; без меток — null; кука туда и обратно", () => {
  const now = new Date("2026-10-04T10:00:00Z");
  const sp = new URLSearchParams("utm_source=google&utm_medium=cpc&utm_campaign=spring%20sale&gclid=abc123&foo=bar&utm_term=" + "x".repeat(300));
  const u = utmFromParams(sp, "/catalog/dryli?utm_source=google", now)!;
  assert.equal(u.utm_source, "google");
  assert.equal(u.utm_campaign, "spring sale");
  assert.equal(u.gclid, "abc123");
  assert.equal(u.utm_term!.length, 200);
  assert.equal(u.landing, "/catalog/dryli");
  assert.equal(u.at, "2026-10-04T10:00:00.000Z");
  assert.ok(!("foo" in u));
  assert.equal(utmFromParams(new URLSearchParams("q=дриль&ref=ABCD"), "/", now), null, "обычный переход — метки не трогаем");
  assert.deepEqual(parseUtm(encodeURIComponent(JSON.stringify(u))), u, "кука в URI-кодировке");
  assert.deepEqual(parseUtm(JSON.stringify(u)), u);
  assert.deepEqual(parseUtm({ fbclid: "f1\u0000", evil: "<script>", landing: "http://x" }), { fbclid: "f1" }, "посторонние поля и не-пути отбрасываются");
  for (const bad of ["", "{", "[1]", "null", 42, null, { foo: 1 }]) assert.equal(parseUtm(bad), null, String(bad));
});

test("метки для менеджера: источник / канал / кампания, клики рекламы", () => {
  assert.equal(utmLabel({ utm_source: "google", utm_medium: "cpc", utm_campaign: "drills", gclid: "x" }), "google / cpc / drills (Google Ads)");
  assert.equal(utmLabel({ fbclid: "x" }), "Facebook/Instagram (клик по рекламе)");
  assert.equal(utmLabel({ ttclid: "x", gbraid: "y" }), "Google Ads, TikTok (клик по рекламе)");
  assert.equal(utmLabel({ utm_source: "viber" }), "viber");
  assert.equal(utmLabel(null), "");
});

test("ID кабинетов: понятная ошибка на неверный формат, «Интеграции» проверяют поле при сохранении", () => {
  const good: Record<string, string> = {
    gtmId: "GTM-AB12CD3", ga4Id: "G-ABC123DEF4", adsConversionId: "AW-123456789", adsPurchaseLabel: "AbC-dEf_123",
    metaPixelId: "1234567890123456", tiktokPixelId: "C1ABCDEF2GHIJ3KLMN4O",
  };
  for (const [f, v] of Object.entries(good)) {
    assert.equal(analyticsIdError(f, v), null, f);
    assert.equal(validateField("analytics", f, v), null, f);
  }
  const bad: Record<string, string> = {
    gtmId: "gtm-ab12cd3", ga4Id: "UA-12345-1", adsConversionId: "123456789", adsPurchaseLabel: "AW-1/x", metaPixelId: "12ab", tiktokPixelId: "c1-abc",
  };
  for (const [f, v] of Object.entries(bad)) assert.match(validateField("analytics", f, v) ?? "", /./, f);
  assert.equal(analyticsIdError("gtmId", "  "), null, "пусто — «оставить как было»");
});

test("конфигурация для контейнера GTM: событие hm_config с ID и каналом, пустые ID не передаются значением", () => {
  const c = analyticsConfigPush({ gtmId: "GTM-AB12CD3", ga4Id: "G-ABC123DEF4", adsConversionId: "", adsPurchaseLabel: "", metaPixelId: "1234567890", tiktokPixelId: "" }, "miniapp");
  assert.equal(c.event, "hm_config");
  assert.equal(c.hm_ga4_id, "G-ABC123DEF4");
  assert.equal(c.hm_meta_pixel_id, "1234567890");
  assert.equal(c.hm_ads_id, undefined);
  assert.equal(c.channel, "miniapp");
  assert.ok(!JSON.stringify(c).includes("GTM-"), "ID контейнера в dataLayer не нужен");
});

test("проверка контейнера GTM: опубликован / не найден / ошибка, подсказка про выключенную аналитику", () => {
  const ok = readGtmCheck(200, "GTM-AB12CD3", ["Google Analytics 4"], false);
  assert.equal(ok.ok, true);
  assert.match(ok.message, /опубликован/);
  assert.match(ok.message, /выключена/);
  assert.match(readGtmCheck(200, "GTM-AB12CD3", [], true).message, /не вписаны/);
  assert.equal(readGtmCheck(404, "GTM-AB12CD3", [], true).ok, false);
  assert.match(readGtmCheck(404, "GTM-AB12CD3", [], true).message, /Отправить/);
  assert.equal(readGtmCheck(500, "GTM-AB12CD3", [], true).ok, false);
});

const facts = (): LaunchFacts => ({
  production: true,
  env: { PUBLIC_URL: "https://handyman.example" },
  owner: { exists: true, defaultPassword: false, passwordIsAdminToken: false, twoFactor: true },
  staff: { require2fa: true, activeWithout2fa: 0 },
  tmp: { route: false, account: false },
  backup: { lastOkAt: null, checkOk: null, checkAt: null, offsite: false },
  integrations: [{ id: "analytics", title: "Аналитика и реклама", configured: false, check: null }],
  openErrors: 0,
  indexing: { open: false, at: null },
  sitemap: { urls: 10, products: 5 },
  searchConsole: { code: false, verified: false },
  analytics: { enabled: false },
});

test("проверка перед запуском: «Аналитика подключена» — желательно, не мешает запуску, без дубля в «Интеграциях»", () => {
  const f = facts();
  const item = () => launchChecklist(f).find((i) => i.id === "analytics")!;
  assert.equal(launchChecklist(f).find((i) => i.id === "integration-analytics"), undefined);
  assert.equal(item().status, "warn");
  assert.match(item().detail, /не вписан/);
  f.integrations[0].configured = true;
  assert.match(item().detail, /выключена/);
  f.analytics.enabled = true;
  assert.match(item().detail, /не нажимали/);
  f.integrations[0].check = { ok: false, at: "2026-10-04T10:00:00Z" };
  assert.equal(item().status, "warn", "непройденная проверка — всё равно не «не готово»");
  f.integrations[0].check = { ok: true, at: "2026-10-04T10:00:00Z" };
  assert.equal(item().status, "ok");
});

test("звонки и мессенджеры: что за ссылка и на какой странице нажали", async () => {
  const { analyticsPageType, contactClick } = await import("../src/shop/analytics");
  assert.deepEqual(contactClick("tel:+380501234567"), { event: "phone_click" });
  assert.deepEqual(contactClick("https://t.me/handyman_bot?start=x"), { event: "telegram_click", messenger: "telegram" });
  assert.deepEqual(contactClick("tg://resolve?domain=handyman"), { event: "telegram_click", messenger: "telegram" });
  assert.deepEqual(contactClick("viber://chat?number=%2B380501234567"), { event: "telegram_click", messenger: "viber" });
  assert.equal(contactClick("https://instagram.com/handyman"), null);
  assert.equal(contactClick("/catalog"), null);
  assert.equal(analyticsPageType("/"), "home");
  assert.equal(analyticsPageType("/ru"), "home");
  assert.equal(analyticsPageType("/ru/product/123/dril"), "product");
  assert.equal(analyticsPageType("/task/sverlinnia"), "catalog");
  assert.equal(analyticsPageType("/order/HM-1001"), "thanks");
  assert.equal(analyticsPageType("/info/kontakty"), "info");
  assert.equal(analyticsPageType("/rules"), "other");
});

test("ранний скрипт: dataLayer, признак, канал Mini App, hm_config до gtm.js; «<» из ID не ломает страницу", async () => {
  const { analyticsInitScript } = await import("../src/shop/analytics");
  const vm = await import("node:vm");
  const ids = { gtmId: "GTM-AB12CD3", ga4Id: "G-ABC</script>", adsConversionId: "", adsPurchaseLabel: "", metaPixelId: "", tiktokPixelId: "" };
  const code = analyticsInitScript(ids);
  assert.ok(!code.includes("<"), "в коде страницы нет «<»");
  for (const [hash, stored, channel] of [["", null, "web"], ["#tgWebAppData=x", null, "miniapp"], ["", "1", "miniapp"]] as const) {
    const w: Record<string, unknown> = {};
    vm.runInNewContext(code, { window: w, location: { hash }, sessionStorage: { getItem: () => stored } });
    const dl = JSON.parse(JSON.stringify(w.dataLayer)) as Array<Record<string, unknown>>; // массив из другого «окна» — сравниваем копию
    assert.equal(w.__hmA, 1);
    assert.equal(w.__hmCh, channel);
    assert.deepEqual(dl.map((e) => e.event), ["hm_config", "gtm.js"]);
    assert.equal(dl[0].channel, channel);
    assert.equal(dl[0].hm_ga4_id, "G-ABC</script>");
  }
});
