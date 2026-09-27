// Витрина+ (шаг 5.6): цена от количества, отзывы, «Передзвоніть мені», подписки, сравнение, /start для подписок, фильтры совместимости в адресе.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSkuList, compareRows, nextQtyPrice, qtyPrices, ratingSummary, unitPriceAt, validateCallback, validateReview, watchDue,
} from "../src/shop";
import { parseStart } from "../src/shop/telegram-logic";
import { clearFilters, filterCount, hasFilters, listingQuery, parseListing } from "../src/site";

test("опт и упаковка: только дешевле обычной, цена падает с количеством, уровень — только своим", () => {
  const breaks = [
    { minQty: 5, pricePerUnit: 95, clientTier: null },
    { minQty: 20, pricePerUnit: 80, clientTier: null },
    { minQty: 3, pricePerUnit: 120, clientTier: null }, // дороже обычной — не работает
    { minQty: 10, pricePerUnit: 70, clientTier: "WHOLESALE" as const },
    { minQty: 1, pricePerUnit: 50, clientTier: null }, // от 1 шт. — это не опт
  ];
  const packs = [{ unitLabel: "уп.", unitsPerPack: 10, packPrice: 900 }];
  const guest = qtyPrices(100, breaks, packs, null);
  assert.deepEqual(guest.map((q) => [q.minQty, q.unitPrice]), [[5, 95], [10, 90], [20, 80]]);
  assert.deepEqual(guest[1].pack, { label: "уп.", units: 10, price: 900 });
  // оптовый покупатель: от 10 — 70 (дешевле упаковки), от 20 — 80 уже не выгоднее → отбрасывается
  const opt = qtyPrices(100, breaks, packs, "WHOLESALE");
  assert.deepEqual(opt.map((q) => [q.minQty, q.unitPrice]), [[5, 95], [10, 70]]);
  assert.equal(unitPriceAt(100, guest, 1), 100);
  assert.equal(unitPriceAt(100, guest, 5), 95);
  assert.equal(unitPriceAt(100, guest, 12), 90);
  assert.equal(unitPriceAt(100, guest, 99), 80);
  assert.deepEqual(nextQtyPrice(guest, 7), guest[1]);
  assert.equal(nextQtyPrice(guest, 20), null);
  assert.deepEqual(qtyPrices(100, [], [{ unitLabel: "", unitsPerPack: 10, packPrice: 1000 }]), [], "упаковка без выгоды не показывается");
});

test("отзыв и вопрос: имя, текст, оценка 1–5 только у отзыва, ссылки — реклама", () => {
  assert.deepEqual(validateReview({ name: " Іван ", text: "Добрий круг, ріже швидко", rating: "5" }), { ok: true, value: { kind: "review", name: "Іван", text: "Добрий круг, ріже швидко", rating: 5 } });
  assert.deepEqual(validateReview({ kind: "question", name: "Олег", text: "Підійде до Bosch GWS?", rating: "9" }), { ok: true, value: { kind: "question", name: "Олег", text: "Підійде до Bosch GWS?", rating: null } });
  assert.equal(validateReview({ name: "I", text: "норм товар" , rating: 4 }).ok, false);
  assert.deepEqual(validateReview({ name: "Іван", text: "ок", rating: 4 }), { ok: false, error: "review.err.text" });
  assert.deepEqual(validateReview({ name: "Іван", text: "Все добре", rating: 0 }), { ok: false, error: "review.err.rating" });
  assert.deepEqual(validateReview({ name: "Спам", text: "купи тут https://a.b і тут www.c.d", rating: 5 }), { ok: false, error: "review.err.links" });
  const r = validateReview({ name: "Іван", text: "рядок\u0000\n\n\n\nще", rating: 3 });
  assert.ok(r.ok && r.value.text === "рядок \n\nще", "управляющие символы и лишние пустые строки убраны");
  assert.deepEqual(ratingSummary([5, 4, 4, 0, 7]), { avg: 4.3, count: 3, dist: [0, 0, 0, 2, 1] });
  assert.deepEqual(ratingSummary([]), { avg: 0, count: 0, dist: [0, 0, 0, 0, 0] });
});

test("«Передзвоніть мені»: украинский телефон обязателен, имя — по желанию", () => {
  assert.deepEqual(validateCallback({ phone: "093 366 24 07", name: " Петро " }), { ok: true, value: { phone: "+380933662407", name: "Петро", note: "" } });
  assert.deepEqual(validateCallback({ phone: "123" }), { ok: false, error: "errPhone" });
});

test("подписки: цена ниже, чем при подписке / появился (у нас или у поставщика); скрытый товар — молчим", () => {
  assert.equal(watchDue("PRICE", 100, { price: 99, stock: "order", visible: true }), true);
  assert.equal(watchDue("PRICE", 100, { price: 100, stock: "local", visible: true }), false);
  assert.equal(watchDue("STOCK", 100, { price: 120, stock: "supplier", visible: true }), true);
  assert.equal(watchDue("STOCK", 100, { price: 120, stock: "order", visible: true }), false);
  assert.equal(watchDue("PRICE", 100, { price: 50, stock: "local", visible: false }), false);
});

test("сравнение: строки по порядку, пропуски — null, «одинаково» без учёта регистра и пробелов; список артикулов чистится", () => {
  const rows = compareRows([
    { attributes: [{ name: "Діаметр", value: "125 мм" }, { name: "Товщина", value: "1,2 мм" }] },
    { attributes: [{ name: "Діаметр", value: "125  ММ" }, { name: "Посадка", value: "22,23" }] },
  ]);
  assert.deepEqual(rows, [
    { name: "Діаметр", values: ["125 мм", "125  ММ"], same: true },
    { name: "Товщина", values: ["1,2 мм", null], same: false },
    { name: "Посадка", values: [null, "22,23"], same: false },
  ]);
  assert.deepEqual(cleanSkuList(["a", " a ", "b", 5, "", "c", "d", "e"]), ["a", "b", "c", "d"]);
  assert.deepEqual(cleanSkuList("a"), []);
});

test("/start для подписок: wp_<товар> — цена, ws_<товар> — наличие; кривой код — без подписки", () => {
  assert.deepEqual(parseStart("/start wp_clx1abc2def3ghi4"), { isStart: true, payload: { kind: "watch", watch: "PRICE", code: "clx1abc2def3ghi4" } });
  assert.deepEqual(parseStart("/start ws_clx1abc2def3ghi4"), { isStart: true, payload: { kind: "watch", watch: "STOCK", code: "clx1abc2def3ghi4" } });
  assert.deepEqual(parseStart("/start wp_../x"), { isStart: true, payload: null });
});

test("адрес списка: fit/tool — место (остаются после «Скинути»), mine — фильтр", () => {
  const s = parseListing(new URLSearchParams("fit=disc-125&mine=1&tool=bad key&sale=1"), []);
  assert.equal(s.fit, "disc-125");
  assert.equal(s.tool, undefined, "код с пробелом отброшен");
  assert.equal(s.mine, true);
  assert.equal(listingQuery(s), "?sale=1&fit=disc-125&mine=1");
  assert.equal(filterCount(s), 2);
  const cleared = clearFilters(s);
  assert.equal(cleared.fit, "disc-125");
  assert.equal(cleared.mine, undefined);
  assert.equal(hasFilters(cleared), false);
});
