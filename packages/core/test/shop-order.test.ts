import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CHECKOUT, canSkipCall, cleanCart, computeTotals, formatPhone, normalizePhone, orderNumber, parseCheckoutSettings, stockLevel,
  validateCheckout, validateCheckoutSettingsForm, type CheckoutSettings,
} from "../src/shop";

test("телефон: разные записи → +380XXXXXXXXX, чужие номера не проходят", () => {
  for (const v of ["0933662407", "093 366 24 07", "+380 (93) 366-24-07", "380933662407", "80933662407"]) assert.equal(normalizePhone(v), "+380933662407", v);
  for (const v of ["", "12345", "+48 123 456 789", "093366240", "09336624071"]) assert.equal(normalizePhone(v), null, v);
  assert.equal(formatPhone("+380933662407"), "+380 (93) 366-24-07");
});

test("наличие: свой склад → в Одессе, иначе поставщик, иначе под заказ; от звонка можно отказаться только без «під замовлення»", () => {
  assert.equal(stockLevel(2, false), "local");
  assert.equal(stockLevel(0, true), "supplier");
  assert.equal(stockLevel(0, false), "order");
  assert.equal(canSkipCall(["local", "supplier"]), true);
  assert.equal(canSkipCall(["local", "order"]), false);
});

test("корзина из браузера: мусор выброшен, одинаковые строки сложены, количество 1–99", () => {
  assert.deepEqual(cleanCart([{ sku: "A", qty: 2 }, { sku: "A", qty: 3 }, { sku: "", qty: 1 }, { sku: "B", qty: 0 }, { sku: "C", qty: 500 }, "x", null]), [
    { sku: "A", qty: 5 },
    { sku: "C", qty: 99 },
  ]);
  assert.deepEqual(cleanCart("не массив"), []);
});

const S: CheckoutSettings = { ...DEFAULT_CHECKOUT, prepayAmount: 200 };
const lines = [{ price: 1599, qty: 1 }, { price: 30.5, qty: 3 }];

test("суммы: предоплата, полная оплата, на карту, «уточнит менеджер»", () => {
  const pre = computeTotals(lines, "prepay", S);
  assert.deepEqual([pre.subtotal, pre.total, pre.dueNow, pre.later, pre.discountPct], [1690.5, 1690.5, 200, 1490.5, 0]);
  const full = computeTotals(lines, "full", S);
  assert.deepEqual([full.total, full.dueNow, full.later], [1690.5, 1690.5, 0]);
  assert.deepEqual(computeTotals(lines, "card", S).dueNow, 1690.5);
  const later = computeTotals(lines, "later", S);
  assert.deepEqual([later.dueNow, later.later], [0, 1690.5]);
  assert.equal(computeTotals([{ price: 90, qty: 1 }], "prepay", S).dueNow, 90, "предоплата не больше суммы заказа");
});

test("суммы: скидка за полную оплату (если владелец включит) — для «повна» и «на картку», не для предоплаты", () => {
  const withDisc = { ...S, fullPayDiscountPct: 2 };
  const full = computeTotals([{ price: 1000, qty: 2 }], "full", withDisc);
  assert.deepEqual([full.subtotal, full.total, full.unitPrices[0], full.discountPct], [2000, 1960, 980, 2]);
  assert.equal(computeTotals([{ price: 1000, qty: 2 }], "prepay", withDisc).total, 2000);
  assert.equal(computeTotals([{ price: 33.33, qty: 3 }], "card", withDisc).unitPrices[0], 32.66, "округление до копеек");
});

test("номер заказа HM-####", () => {
  assert.equal(orderNumber(1), "HM-1001");
  assert.equal(orderNumber(125), "HM-1125");
});

const good = {
  firstName: "Іван", lastName: "Петренко", phone: "093 366 24 07", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12",
  pay: "prepay", items: [{ sku: "000237651", qty: 1 }],
};

test("форма оформления: хорошая проходит, телефон приводится к +380", () => {
  const r = validateCheckout(good, S);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.phone, "+380933662407");
    assert.equal(r.value.npType, "warehouse");
  }
});

test("форма оформления: ошибки — ключи текстов на языке сайта", () => {
  const r = validateCheckout({ ...good, firstName: "", lastName: "П", phone: "12", city: "", npPoint: "", items: [] }, S);
  assert.ok(!r.ok);
  if (!r.ok) assert.deepEqual(r.errors, { firstName: "errName", lastName: "err.lastName", phone: "errPhone", items: "emptyT", city: "err.city", npPoint: "err.npPoint" });
  const courier = validateCheckout({ ...good, delivery: "courier", address: "" }, S);
  assert.ok(!courier.ok && courier.errors.address === "errAddr");
  const pickup = validateCheckout({ ...good, delivery: "pickup", city: "", npPoint: "" }, S);
  assert.ok(pickup.ok, "самовывоз — без адреса");
});

test("форма оформления: выключенный способ не принимается; «не телефонуйте» снимается при «під замовлення»", () => {
  const off = { ...S, pay: { ...S.pay, card: false }, delivery: { ...S.delivery, courier: false } };
  const r = validateCheckout({ ...good, pay: "card", delivery: "courier", address: "Одеса, вул. Дерибасівська, 1" }, off);
  assert.ok(!r.ok && r.errors.pay === "err.pay" && r.errors.delivery === "err.delivery");
  const onOrder = validateCheckout({ ...good, noCallback: true }, S, ["local", "order"]);
  assert.ok(onOrder.ok && onOrder.value.noCallback === false);
  const ok = validateCheckout({ ...good, noCallback: "on" }, S, ["local"]);
  assert.ok(ok.ok && ok.value.noCallback === true);
});

test("настройки оформления: стандартные, мусор, хотя бы один способ, форма админки", () => {
  assert.deepEqual(parseCheckoutSettings(null), DEFAULT_CHECKOUT);
  assert.equal(parseCheckoutSettings({ prepayAmount: "350" }).prepayAmount, 350);
  assert.equal(parseCheckoutSettings({ prepayAmount: -5 }).prepayAmount, 0);
  assert.deepEqual(parseCheckoutSettings({ pay: { prepay: false, full: false, card: false } }).pay, DEFAULT_CHECKOUT.pay, "все выключены — берём стандартные");
  const form = validateCheckoutSettingsForm({ prepayAmount: "300", fullPayDiscountPct: "0", "pay.prepay": "on", "delivery.np": "on" });
  assert.ok(form.ok && form.value.prepayAmount === 300 && form.value.pay.full === false && form.value.delivery.pickup === false);
  assert.ok(!validateCheckoutSettingsForm({ prepayAmount: "300", "delivery.np": "on" }).ok, "без способа оплаты нельзя");
  assert.ok(!validateCheckoutSettingsForm({ prepayAmount: "abc", "pay.full": "on", "delivery.np": "on" }).ok);
});
