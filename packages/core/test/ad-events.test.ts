// Аналитика, шаг А3: покупка с сервера — куки рекламы, SHA-256 телефона/почты, тела запросов Meta / TikTok / GA4, ответы, повторы, правила.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AD_MAX_ATTEMPTS, adContextFrom, adOrderValue, adPurchaseAllowed, adRetryDelayMin, adSourceUrl, ga4Body, ga4ClientId, gaClientIdFromCookie, gaSessionIdFromCookie,
  metaPurchaseBody, normEmail, parseAdContext, phoneDigits, readGa4DebugCheck, readGa4Send, readMetaCheck, readMetaSend, readTiktokSend, tiktokPurchaseBody,
  type AdOrder,
} from "../src/ad-events";
import { purchaseEvent } from "../src/shop/analytics";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const order: AdOrder = {
  no: "HM-1042", createdAt: new Date("2026-10-04T10:00:00Z"), clientId: "client-1", phone: "+380933662407", email: " Ivan@Example.COM ",
  lines: [
    { sku: "000123", name: "Круг 125", qty: 3, unitPrice: 33.33, brand: "Bosch", category: "Диски" },
    { sku: "000777", name: "Болгарка", qty: 1, unitPrice: 1400, brand: null, category: null },
  ],
};

test("куки GA4: client_id из _ga, номер сессии из _ga_<поток> (старый и новый формат), мусор — пусто", () => {
  assert.equal(gaClientIdFromCookie("GA1.1.123456789.1712345678"), "123456789.1712345678");
  assert.equal(gaClientIdFromCookie("GA1.2.987.1712345678"), "987.1712345678");
  assert.equal(gaClientIdFromCookie("abc"), "");
  assert.equal(gaClientIdFromCookie(undefined), "");
  assert.equal(gaSessionIdFromCookie("GS1.1.1712345678.3.1.1712345999.0.0.0"), "1712345678");
  assert.equal(gaSessionIdFromCookie("GS2.1.s1712345678$o3$g1$t1712345999$j60$l0$h0"), "1712345678");
  assert.equal(gaSessionIdFromCookie("GS9.x"), "");
});

test("контекст из кук и заголовков: верные куки берутся, мусор — нет; _fbc собирается из fbclid перехода; адрес страницы без параметров", () => {
  const ctx = adContextFrom({
    cookies: {
      _fbp: "fb.1.1712345678901.1234567890", _ttp: "2abcDEF_ghij-123", _ga: "GA1.1.111.1712345678", _ga_ABC123: "GS2.1.s1712349999$o1",
      _fbc: "<script>",
    },
    ga4Id: "G-ABC123", ip: "203.0.113.5", ua: "Mozilla/5.0 (iPhone)", referer: "https://handyman.ua/ru/checkout?x=1#y",
    utm: { fbclid: "IwAR0abcdefghijk", ttclid: "E.C.P.abcdef123", at: "2026-10-03T08:00:00.000Z" },
  });
  assert.equal(ctx.fbp, "fb.1.1712345678901.1234567890");
  assert.equal(ctx.fbc, `fb.1.${Date.parse("2026-10-03T08:00:00.000Z")}.IwAR0abcdefghijk`, "кривая _fbc заменена собранной из fbclid");
  assert.equal(ctx.ttp, "2abcDEF_ghij-123");
  assert.equal(ctx.ttclid, "E.C.P.abcdef123");
  assert.equal(ctx.gaClientId, "111.1712345678");
  assert.equal(ctx.gaSessionId, "1712349999");
  assert.equal(ctx.ip, "203.0.113.5");
  assert.equal(ctx.url, "https://handyman.ua/ru/checkout");
  // настоящая _fbc важнее fbclid; адрес «local» (без прокси) не сохраняется
  const c2 = adContextFrom({ cookies: { _fbc: "fb.1.1712345678901.IwAR0realclickid" }, ip: "local", utm: { fbclid: "IwAR0abcdefghijk" } });
  assert.equal(c2.fbc, "fb.1.1712345678901.IwAR0realclickid");
  assert.equal(c2.ip, undefined);
  assert.deepEqual(adContextFrom({ cookies: {} }), {});
  // из заказа: только известные поля
  assert.deepEqual(parseAdContext({ fbp: "fb.1.1.1", evil: "x", ip: 5 }), { fbp: "fb.1.1.1" });
  assert.deepEqual(parseAdContext("строка"), {});
});

test("телефон и почта: нормализация перед SHA-256", () => {
  assert.equal(phoneDigits("+380 93 366-24-07"), "380933662407");
  assert.equal(phoneDigits("093 366 24 07"), "380933662407", "украинский без кода — дополняем 38");
  assert.equal(phoneDigits("123"), "");
  assert.equal(phoneDigits(null), "");
  assert.equal(normEmail(" Ivan@Example.COM "), "ivan@example.com");
  assert.equal(normEmail("не почта"), "");
});

test("Meta: Purchase с event_id = номер заказа, сумма как в браузере, телефон и почта — только SHA-256", () => {
  const b = metaPurchaseBody(order, { fbp: "fb.1.1.2", fbc: "fb.1.1.IwAR", ip: "203.0.113.5", ua: "UA" }, { sourceUrl: "https://handyman.ua/checkout", testCode: "TEST123" });
  const e = b.data[0];
  assert.equal(e.event_name, "Purchase");
  assert.equal(e.event_id, "HM-1042");
  assert.equal(e.event_time, Math.floor(order.createdAt.getTime() / 1000));
  assert.equal(e.action_source, "website");
  assert.equal(e.event_source_url, "https://handyman.ua/checkout");
  assert.equal(b.test_event_code, "TEST123");
  const u = e.user_data as Record<string, unknown>;
  assert.deepEqual(u.ph, [sha("380933662407")]);
  assert.deepEqual(u.em, [sha("ivan@example.com")]);
  assert.deepEqual(u.external_id, [sha("client-1")]);
  assert.equal(u.fbp, "fb.1.1.2");
  assert.equal(u.client_ip_address, "203.0.113.5");
  assert.equal(u.client_user_agent, "UA");
  const json = JSON.stringify(b);
  assert.ok(!json.includes("933662407"), "телефон открытым текстом не уходит");
  assert.ok(!json.toLowerCase().includes("ivan@"), "почта открытым текстом не уходит");
  // сумма = как у purchase в браузере (товары после скидок, без доставки)
  const browser = purchaseEvent("HM-1042", order.lines.map((l) => ({ ...l, categories: [l.category] })));
  assert.equal(e.custom_data.value, browser.ecommerce.value);
  assert.equal(e.custom_data.value, 1499.99);
  assert.equal(adOrderValue(order), 1499.99);
  assert.deepEqual(e.custom_data.content_ids, ["000123", "000777"]);
  assert.deepEqual(e.custom_data.contents[0], { id: "000123", quantity: 3, item_price: 33.33 });
  assert.equal(e.custom_data.num_items, 4);
  assert.equal(e.custom_data.currency, "UAH");
  // без кук и почты — поля просто не передаются
  const bare = metaPurchaseBody({ ...order, email: null, phone: null }, {}, { sourceUrl: "" }).data[0];
  assert.equal("em" in bare.user_data, false);
  assert.equal("ph" in bare.user_data, false);
  assert.equal("event_source_url" in bare, false);
  assert.equal("test_event_code" in metaPurchaseBody(order, {}, { sourceUrl: "" }), false);
});

test("TikTok: CompletePayment с event_id = номер заказа, телефон — SHA-256 от «+380…», ttclid и _ttp", () => {
  const b = tiktokPurchaseBody(order, { ttclid: "E.C.P.abc", ttp: "ttp-123", ip: "1.2.3.4", ua: "UA" }, { pixelId: "C1ABCDEF2GHIJ3KLMN4O", sourceUrl: "https://handyman.ua/checkout" });
  assert.equal(b.event_source, "web");
  assert.equal(b.event_source_id, "C1ABCDEF2GHIJ3KLMN4O");
  const e = b.data[0];
  assert.equal(e.event, "CompletePayment");
  assert.equal(e.event_id, "HM-1042");
  assert.equal(e.user.phone, sha("+380933662407"));
  assert.equal(e.user.email, sha("ivan@example.com"));
  assert.equal(e.user.ttclid, "E.C.P.abc");
  assert.equal(e.user.ttp, "ttp-123");
  assert.equal(e.properties.value, 1499.99);
  assert.equal(e.properties.order_id, "HM-1042");
  assert.deepEqual(e.properties.contents[0], { content_id: "000123", content_name: "Круг 125", quantity: 3, price: 33.33, brand: "Bosch" });
  assert.equal(e.page?.url, "https://handyman.ua/checkout");
});

test("GA4: purchase с client_id из _ga и transaction_id; без _ga — постоянный номер из номера заказа; refund — вся сумма без товаров", () => {
  const now = new Date("2026-10-04T10:05:00Z");
  const p = ga4Body("purchase", order, { gaClientId: "111.1712345678", gaSessionId: "1712349999" }, now);
  assert.equal(p.client_id, "111.1712345678");
  assert.equal(p.timestamp_micros, order.createdAt.getTime() * 1000);
  const ev = p.events[0];
  assert.equal(ev.name, "purchase");
  const params = ev.params as Record<string, unknown>;
  assert.equal(params.transaction_id, "HM-1042");
  assert.equal(params.value, 1499.99);
  assert.equal(params.shipping, 0);
  assert.equal(params.currency, "UAH");
  assert.equal(params.session_id, "1712349999");
  const items = params.items as Array<Record<string, unknown>>;
  assert.deepEqual(items[0], { item_id: "000123", item_name: "Круг 125", price: 33.33, quantity: 3, item_brand: "Bosch", item_category: "Диски" });
  assert.equal(JSON.stringify(p).includes("933662407"), false, "телефон в GA4 не уходит");

  const id1 = ga4ClientId(order, {});
  assert.match(id1, /^\d+\.\d{10}$/);
  assert.equal(ga4ClientId(order, {}), id1, "один и тот же для покупки и отмены");
  assert.notEqual(ga4ClientId({ ...order, no: "HM-1043" }, {}), id1);

  const r = ga4Body("refund", order, {}, now);
  assert.equal(r.events[0].name, "refund");
  assert.equal((r.events[0].params as Record<string, unknown>).items, undefined);
  assert.equal((r.events[0].params as Record<string, unknown>).value, 1499.99);
  assert.equal(r.timestamp_micros, now.getTime() * 1000, "возврат — временем отмены");
  // повтор покупки через 4 дня (старше 72 часов GA4 не примет) — текущим временем
  const late = new Date(order.createdAt.getTime() + 4 * 86400_000);
  assert.equal(ga4Body("purchase", order, {}, late).timestamp_micros, late.getTime() * 1000);
});

test("ответы кабинетов: принято / ошибка без повтора (неверный токен) / повтор (сбой, перегрузка)", () => {
  assert.deepEqual(readMetaSend(200, { events_received: 1, fbtrace_id: "x" }), { ok: true });
  const bad = readMetaSend(400, { error: { message: "Invalid OAuth access token.", code: 190 } });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.retry, false);
  assert.match(!bad.ok ? bad.error : "", /Meta: Invalid OAuth/);
  const busy = readMetaSend(400, { error: { message: "limit", code: 17 } });
  assert.equal(!busy.ok && busy.retry, true);
  assert.equal((readMetaSend(503, null) as { retry: boolean }).retry, true);

  assert.deepEqual(readTiktokSend(200, { code: 0, message: "OK" }), { ok: true });
  const tbad = readTiktokSend(200, { code: 40001, message: "Access token invalid" });
  assert.equal(!tbad.ok && tbad.retry, false);
  assert.match(!tbad.ok ? tbad.error : "", /TikTok: Access token invalid \(код 40001\)/);
  assert.equal((readTiktokSend(200, { code: 40100, message: "rate" }) as { retry: boolean }).retry, true);

  assert.deepEqual(readGa4Send(204), { ok: true });
  assert.equal((readGa4Send(500) as { retry: boolean }).retry, true);
  assert.equal((readGa4Send(403) as { retry: boolean }).retry, false);
});

test("проверка подключения: Meta (токен и пиксель), GA4 (замечания отладочного адреса)", () => {
  assert.equal(readMetaCheck(200, { id: "123", name: "Handyman" }).ok, true);
  assert.match(readMetaCheck(200, { id: "123", name: "Handyman" }).message, /«Handyman»/);
  assert.equal(readMetaCheck(400, { error: { message: "bad token" } }).ok, false);
  assert.equal(readGa4DebugCheck(200, { validationMessages: [] }).ok, true);
  const g = readGa4DebugCheck(200, { validationMessages: [{ description: "Item param [price] has unsupported value" }] });
  assert.equal(g.ok, false);
  assert.match(g.message, /price/);
});

test("повторы: 1, 5, 15, 60, 180, 720 минут, после 7 попыток — всё", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(adRetryDelayMin), [1, 5, 15, 60, 180, 720]);
  assert.equal(adRetryDelayMin(AD_MAX_ATTEMPTS), null);
});

test("какие заказы уходят: сайт и «1 клік»; тестовые, «подозрительные» и по звонку — нет", () => {
  assert.equal(adPurchaseAllowed({ isTest: false, suspicious: null, source: "site" }), true);
  assert.equal(adPurchaseAllowed({ isTest: false, suspicious: null, source: "one_click" }), true);
  assert.equal(adPurchaseAllowed({ isTest: true, suspicious: null, source: "site" }), false);
  assert.equal(adPurchaseAllowed({ isTest: false, suspicious: "blocked", source: "site" }), false);
  assert.equal(adPurchaseAllowed({ isTest: false, suspicious: null, source: "manual" }), false);
});

test("адрес страницы: страница оформления на домене из PUBLIC_URL", () => {
  assert.equal(adSourceUrl({ url: "http://localhost:3100/ru/checkout" }, "https://handyman.ua/"), "https://handyman.ua/ru/checkout");
  assert.equal(adSourceUrl({ url: "http://localhost:3100/checkout" }, ""), "http://localhost:3100/checkout");
  assert.equal(adSourceUrl({}, "https://handyman.ua"), "https://handyman.ua");
  assert.equal(adSourceUrl({}, undefined), "");
});
