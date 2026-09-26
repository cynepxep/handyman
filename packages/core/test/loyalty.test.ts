import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOYALTY, clientDiscountPct, nextStoredTier, normalizeLoyalty, normalizePhone, tierBySpent, tierProgress, validateClientEdit } from "../src/shop";

const ON = { ...DEFAULT_LOYALTY, enabled: true };

test("уровни: по сумме покупок Старт → Майстер (5 000) → Профі (15 000) → Легенда (40 000); «Опт» не пересчитывается", () => {
  assert.equal(tierBySpent(0, ON), "START");
  assert.equal(tierBySpent(4999.99, ON), "START");
  assert.equal(tierBySpent(5000, ON), "MASTER");
  assert.equal(tierBySpent(15000, ON), "PRO");
  assert.equal(tierBySpent(1_000_000, ON), "LEGEND");
  assert.equal(nextStoredTier("WHOLESALE", 0, ON), "WHOLESALE");
  assert.equal(nextStoredTier("LEGEND", 100, ON), "START"); // после возврата сумма упала — уровень тоже
});

test("прогресс до следующего уровня: сколько осталось и доля пути", () => {
  assert.deepEqual(tierProgress(3800, "START", ON), { next: "MASTER", left: 1200, pctDone: 76 });
  assert.deepEqual(tierProgress(10000, "MASTER", ON), { next: "PRO", left: 5000, pctDone: 50 });
  assert.equal(tierProgress(50000, "LEGEND", ON), null);
  assert.equal(tierProgress(50000, "WHOLESALE", ON), null);
});

test("скидка: личная работает всегда и не складывается с уровнем; уровни выключены по умолчанию", () => {
  assert.equal(DEFAULT_LOYALTY.enabled, false);
  assert.deepEqual(clientDiscountPct({ tier: "PRO", manualDiscountPct: null }, DEFAULT_LOYALTY), { pct: 0, source: "none" });
  assert.deepEqual(clientDiscountPct({ tier: "PRO", manualDiscountPct: 7 }, DEFAULT_LOYALTY), { pct: 7, source: "manual" });
  assert.deepEqual(clientDiscountPct({ tier: "PRO", manualDiscountPct: null }, ON), { pct: 5, source: "tier" });
  assert.deepEqual(clientDiscountPct({ tier: "LEGEND", manualDiscountPct: 2 }, ON), { pct: 2, source: "manual" });
  assert.deepEqual(clientDiscountPct({ tier: "WHOLESALE", manualDiscountPct: null }, { ...ON, wholesalePct: 8 }), { pct: 8, source: "tier" });
  assert.deepEqual(clientDiscountPct({ tier: "START", manualDiscountPct: null }, ON), { pct: 0, source: "none" });
});

test("настройки уровней: мусор → по умолчанию, пороги только растут, у «Старт» всегда 0, скидка не больше 50 %", () => {
  assert.deepEqual(normalizeLoyalty(null), DEFAULT_LOYALTY);
  const s = normalizeLoyalty({
    enabled: true,
    levels: [{ key: "START", min: 999, pct: 1 }, { key: "MASTER", min: 3000, pct: 90 }, { key: "PRO", min: 2000, pct: "4" }, { key: "LEGEND", min: "abc", pct: 12 }],
    wholesalePct: -5,
  });
  assert.equal(s.enabled, true);
  assert.deepEqual(s.levels.map((l) => [l.key, l.min, l.pct]), [["START", 0, 1], ["MASTER", 3000, 50], ["PRO", 3001, 4], ["LEGEND", 40000, 12]]);
  assert.equal(s.wholesalePct, 0);
});

test("форма клиента в админке: телефон приводится к +380, неверные почта/скидка/телефон — понятная ошибка", () => {
  const ok = validateClientEdit({ name: "  Іван   Петренко ", phone: "093 366 24 07", email: "IVAN@Mail.com", lang: "RU", note: "бригада", manualDiscountPct: "5,5", wholesale: "on" }, normalizePhone);
  assert.deepEqual(ok, { ok: true, value: { name: "Іван Петренко", phone: "+380933662407", email: "ivan@mail.com", lang: "RU", note: "бригада", manualDiscountPct: 5.5, wholesale: true } });
  const empty = validateClientEdit({ manualDiscountPct: "0" }, normalizePhone);
  assert.ok(empty.ok && empty.value.manualDiscountPct === null && empty.value.phone === "" && empty.value.lang === "UK" && !empty.value.wholesale);
  for (const bad of [{ phone: "12345" }, { email: "не почта" }, { manualDiscountPct: "70" }, { manualDiscountPct: "abc" }]) {
    const r = validateClientEdit(bad, normalizePhone);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test("итог заказа со скидкой покупателя: складывается со скидкой за полную оплату, не больше 50 %", async () => {
  const { computeTotals, DEFAULT_CHECKOUT } = await import("../src/shop");
  const s = { ...DEFAULT_CHECKOUT, prepayAmount: 200, fullPayDiscountPct: 2 };
  const lines = [{ price: 1000, qty: 1 }];
  assert.equal(computeTotals(lines, "prepay", s, 5).total, 950);
  assert.equal(computeTotals(lines, "full", s, 5).discountPct, 7);
  assert.equal(computeTotals(lines, "full", s, 5).total, 930);
  assert.equal(computeTotals(lines, "full", s, 60).discountPct, 50);
  assert.equal(computeTotals(lines, "prepay", s).total, 1000, "гость — без скидки уровня");
});
