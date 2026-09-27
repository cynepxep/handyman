// Кассовые чеки Checkbox (шаг 3.3): строки чека, тело запроса (копейки, тысячные), разбор ответов и ошибок, повторы, смена, форма ручного чека.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkboxErrorText, goodsTotal, readCheckboxReceipt, readShift, receiptGoods, receiptPageUrl, receiptRetryDelayMin, sellReceiptBody, shiftCloseDue,
  validateManualReceipt, RECEIPT_MAX_ATTEMPTS,
} from "../src/shop";

const items = [{ name: "Круг 125", sku: "000123", qty: 3, unitPrice: 33.33 }, { name: "Болгарка", sku: "000777", qty: 1, unitPrice: 1400.01 }];

test("строки чека: построчно — только на всю сумму, иначе одна строка «Передплата/Оплата/Повернення»", () => {
  const full = receiptGoods({ no: "HM-1001", amount: 1500, items, partial: "pay" });
  assert.deepEqual(full, [{ code: "000123", name: "Круг 125", price: 33.33, qty: 3 }, { code: "000777", name: "Болгарка", price: 1400.01, qty: 1 }]);
  assert.equal(goodsTotal(full), 1500);
  assert.deepEqual(receiptGoods({ no: "HM-1001", amount: 200, items, partial: "prepay" }), [{ code: "HM-1001", name: "Передплата за замовлення HM-1001", price: 200, qty: 1 }]);
  assert.deepEqual(receiptGoods({ no: "HM-1001", amount: 1300, items, partial: "pay" })[0].name, "Оплата замовлення HM-1001");
  assert.deepEqual(receiptGoods({ no: "HM-1001", amount: 50.5, partial: "refund" }), [{ code: "HM-1001", name: "Повернення коштів за замовлення HM-1001", price: 50.5, qty: 1 }]);
  assert.equal(receiptGoods({ no: "HM-1001", amount: 1500.01, items, partial: "pay" }).length, 1, "не сходится на копейку — одной строкой");
});

test("тело чека: копейки, количество в тысячных, оплата = сумме строк, возврат со ссылкой на продажу, почта только правильная", () => {
  const goods = receiptGoods({ no: "HM-1001", amount: 1500, items, partial: "pay" });
  const b = sellReceiptBody({ id: "u-1", goods, payType: "CASHLESS", emails: ["a@b.ua", "не почта"] });
  assert.equal(b.id, "u-1");
  assert.deepEqual(b.goods[0], { good: { code: "000123", name: "Круг 125", price: 3333 }, quantity: 3000 });
  assert.deepEqual(b.payments, [{ type: "CASHLESS", value: 150000, label: "Картка" }]);
  assert.deepEqual(b.delivery, { emails: ["a@b.ua"] });
  assert.equal("related_receipt_id" in b, false);
  const r = sellReceiptBody({ id: "u-2", goods: receiptGoods({ no: "HM-1001", amount: 50, partial: "refund" }), payType: "CASHLESS", isReturn: true, relatedId: "u-1" });
  assert.deepEqual(r.goods[0], { good: { code: "HM-1001", name: "Повернення коштів за замовлення HM-1001", price: 5000 }, quantity: 1000, is_return: true });
  assert.equal(r.related_receipt_id, "u-1");
  assert.equal("delivery" in r, false);
  assert.equal(sellReceiptBody({ id: "u-3", goods, payType: "CASH" }).payments[0].label, "Готівка");
});

test("ответы Checkbox: чек, ошибка чека, смена, понятные ошибки", () => {
  assert.deepEqual(readCheckboxReceipt({ id: "u-1", status: "DONE", fiscal_code: "TEST-123", tax_url: "https://cabinet.tax.gov.ua/x" }),
    { id: "u-1", status: "DONE", fiscalCode: "TEST-123", taxUrl: "https://cabinet.tax.gov.ua/x", error: null });
  assert.equal(readCheckboxReceipt({ id: "u-1", status: "CREATED" })?.fiscalCode, null);
  assert.equal(readCheckboxReceipt({ id: "u-1", status: "ERROR", transaction: { status: "ERROR", response_error_message: "Зміну не відкрито" } })?.error, "Зміну не відкрито");
  assert.equal(readCheckboxReceipt({ status: "DONE" }), null);
  assert.equal(readCheckboxReceipt(null), null);
  assert.deepEqual(readShift({ id: "s-1", status: "OPENED" }), { id: "s-1", status: "OPENED" });
  assert.equal(readShift(null), null);
  assert.match(checkboxErrorText(401, {}), /логин, пароль кассира или ключ кассы/);
  assert.equal(checkboxErrorText(422, { message: "Validation error", detail: [{ loc: ["body", "goods"], msg: "field required", type: "x" }] }),
    "Checkbox ответил ошибкой 422: Validation error: field required.");
  assert.equal(checkboxErrorText(400, { message: "Зміну не відкрито" }), "Checkbox ответил ошибкой 400: Зміну не відкрито.");
});

test("повторы, ссылка на чек, закрытие смены", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(receiptRetryDelayMin), [1, 2, 5, 10, 30, 60, 120, 120]);
  assert.ok(RECEIPT_MAX_ATTEMPTS >= 5);
  assert.equal(receiptPageUrl("u-1"), "https://check.checkbox.ua/u-1");
  assert.equal(receiptPageUrl("u-1", "https://example.test/"), "https://example.test/u-1");
  assert.equal(shiftCloseDue(22), false);
  assert.equal(shiftCloseDue(23), true);
});

test("ручной чек: сумма больше нуля и не больше непробитой части, способ оплаты обязателен", () => {
  assert.deepEqual(validateManualReceipt("1 300,50", "CASH", 1500), { ok: true, amount: 1300.5, payType: "CASH" });
  assert.equal(validateManualReceipt("0", "CASH", 1500).ok, false);
  assert.equal(validateManualReceipt("abc", "CASH", 1500).ok, false);
  const over = validateManualReceipt("1600", "CASHLESS", 1500);
  assert.equal(over.ok, false);
  assert.match(over.ok ? "" : over.error, /1500/);
  assert.equal(validateManualReceipt("100", "CRYPTO", 1500).ok, false);
});
