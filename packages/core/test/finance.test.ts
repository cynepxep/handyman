import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FINANCE, normalizeFinance, normalizeMonth, orderProfit, shiftMonth, validateExpense } from "../src/shop";

test("прибыль по заказу: закупка из заказа, иначе текущая, иначе оценка по дилерской скидке; комиссия и доставка вычитаются", () => {
  const s = { ...DEFAULT_FINANCE, commissionPct: { ...DEFAULT_FINANCE.commissionPct, FULL: 1.5 }, dealerDiscountPct: 25 };
  const p = orderProfit({
    total: 1000, payMode: "FULL", shopDeliveryCost: 60,
    lines: [
      { qty: 2, unitPrice: 200, unitCost: 120, currentCost: 999 }, // снимок важнее текущей
      { qty: 1, unitPrice: 400, unitCost: null, currentCost: 300 },
      { qty: 1, unitPrice: 200, unitCost: null, currentCost: null }, // оценка: 200 × 0,75 = 150
    ],
  }, s);
  assert.deepEqual(p, { revenue: 1000, cost: 690, estimated: 1, unknown: 0, commission: 15, delivery: 60, profit: 235, marginPct: 23.5 });
});

test("без оценки (скидка 0) позиция без закупки считается «без закупки», а не выдумывается", () => {
  const p = orderProfit({ total: 100, payMode: "PREPAY", shopDeliveryCost: 0, lines: [{ qty: 1, unitPrice: 100, unitCost: null, currentCost: null }] }, DEFAULT_FINANCE);
  assert.equal(p.unknown, 1);
  assert.equal(p.cost, 0);
  assert.equal(p.profit, 100);
});

test("настройки: мусор → нули, проценты ограничены, запятая понимается", () => {
  assert.deepEqual(normalizeFinance(null), DEFAULT_FINANCE);
  const s = normalizeFinance({ commissionPct: { FULL: "1,3", CARD: 99 }, dealerDiscountPct: -5, minMarginPct: "12" });
  assert.equal(s.commissionPct.FULL, 1.3);
  assert.equal(s.commissionPct.CARD, 20);
  assert.equal(s.dealerDiscountPct, 0);
  assert.equal(s.minMarginPct, 12);
});

test("месяцы: проверка, сдвиг через год", () => {
  assert.equal(normalizeMonth("2026-09"), "2026-09");
  assert.match(normalizeMonth("вчера"), /^\d{4}-\d{2}$/);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("расход: сумма больше нуля, неизвестная категория → «Другое», пустое название → категория", () => {
  assert.deepEqual(validateExpense({ month: "2026-09", category: "Аренда", title: "", amount: "8 000,50" }), { ok: true, value: { month: "2026-09", category: "Аренда", title: "Аренда", amount: 8000.5 } });
  const other = validateExpense({ month: "2026-09", category: "???", title: "Вода", amount: 100 });
  assert.ok(other.ok && other.value.category === "Другое");
  assert.equal(validateExpense({ month: "2026-09", amount: 0 }).ok, false);
  assert.equal(validateExpense({ month: "сентябрь", amount: 10 }).ok, false);
});
