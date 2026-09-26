import { test } from "node:test";
import assert from "node:assert/strict";
import { availableQty, isLowStock, orderStockState, validateInventory, validateReceiving } from "../src/shop";

test("доступно = на складе − в резерве по каждому складу, не меньше нуля", () => {
  assert.equal(availableQty([{ onHand: 5, reserved: 2 }, { onHand: 1, reserved: 3 }]), 3);
  assert.equal(availableQty([]), 0);
});

test("состояние заказа по движениям: резерв, списание, снятие резерва, возврат; старые заказы (сразу SALE) тоже понятны", () => {
  const s = orderStockState([
    { stockItemId: "a", delta: 3, reason: "RESERVE" },
    { stockItemId: "a", delta: -3, reason: "SALE" },
    { stockItemId: "a", delta: -3, reason: "UNRESERVE" },
    { stockItemId: "b", delta: 2, reason: "RESERVE" },
    { stockItemId: "c", delta: -1, reason: "SALE" }, // заказ до шага 4.4
    { stockItemId: "d", delta: -2, reason: "SALE" },
    { stockItemId: "d", delta: 2, reason: "RETURN" },
  ]);
  assert.deepEqual(Object.fromEntries(s), { a: { reserved: 0, sold: 3 }, b: { reserved: 2, sold: 0 }, c: { reserved: 0, sold: 1 }, d: { reserved: 0, sold: 0 } });
});

test("заканчивается: только если за товаром следят (мин. > 0) и доступно не больше порога", () => {
  assert.equal(isLowStock(2, 0), false);
  assert.equal(isLowStock(2, 2), true);
  assert.equal(isLowStock(3, 2), false);
});

test("приход: повторы складываются, цена с запятой, пустые строки пропускаются, без строк — ошибка", () => {
  const r = validateReceiving({ lines: JSON.stringify([{ sku: "A", qty: 2, unitCost: "12,5" }, { sku: "A", qty: "3" }, { sku: "B", qty: 0 }, { sku: "", qty: 1 }]), supplier: " Vitals " });
  assert.ok(r.ok);
  assert.deepEqual(r.lines, [{ sku: "A", qty: 5, unitCost: 12.5 }]);
  assert.equal(r.supplier, "Vitals");
  assert.equal(validateReceiving({ lines: "[]" }).ok, false);
  assert.equal(validateReceiving({ lines: JSON.stringify([{ sku: "A", qty: 200000 }]) }).ok, false);
});

test("инвентаризация: 0 — можно (всё продано), пустое поле — не трогаем, дробь или минус — ошибка", () => {
  const r = validateInventory({ lines: JSON.stringify([{ sku: "A", counted: 0 }, { sku: "B", counted: "" }, { sku: "C", counted: "4" }]) });
  assert.ok(r.ok);
  assert.deepEqual(r.lines, [{ sku: "A", counted: 0 }, { sku: "C", counted: 4 }]);
  assert.equal(validateInventory({ lines: JSON.stringify([{ sku: "A", counted: 1.5 }]) }).ok, false);
  assert.equal(validateInventory({ lines: JSON.stringify([{ sku: "A", counted: -1 }]) }).ok, false);
});
