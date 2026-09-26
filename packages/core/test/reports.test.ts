import { test } from "node:test";
import assert from "node:assert/strict";
import { humanMinutes, median, pctChange, periodDays, periodRange, toCsv } from "../src/shop";

const NOW = new Date("2026-09-26T09:00:00Z"); // 12:00 по Киеву

test("периоды по Киеву: 7 дней включая сегодня, прошлый период такой же длины перед ним; свой диапазон; мусор → 7 дней", () => {
  const w = periodRange({ period: "7d" }, NOW);
  assert.equal(w.fromYmd, "2026-09-20");
  assert.equal(w.toYmd, "2026-09-26");
  assert.equal(w.days, 7);
  assert.equal(w.from.toISOString(), "2026-09-19T21:00:00.000Z");
  assert.equal(w.to.toISOString(), "2026-09-26T21:00:00.000Z");
  assert.equal(w.prevFrom.toISOString(), "2026-09-12T21:00:00.000Z");
  assert.equal(w.prevTo.toISOString(), "2026-09-19T21:00:00.000Z");
  const m = periodRange({ period: "month" }, NOW);
  assert.equal(m.fromYmd, "2026-09-01");
  const c = periodRange({ period: "custom", from: "2026-09-01", to: "2026-09-03" }, NOW);
  assert.equal(c.days, 3);
  assert.equal(c.label, "01.09–03.09");
  assert.equal(periodRange({ period: "custom", from: "2026-09-05", to: "2026-09-01" }, NOW).kind, "7d");
  assert.deepEqual(periodDays(c), ["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("сравнение, медиана, время по-человечески", () => {
  assert.equal(pctChange(120, 100), 20);
  assert.equal(pctChange(50, 100), -50);
  assert.equal(pctChange(5, 0), null);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(median([]), null);
  assert.equal(humanMinutes(45), "45 мин");
  assert.equal(humanMinutes(95), "1 ч 35 мин");
  assert.equal(humanMinutes(3000), "2 дн 2 ч");
});

test("CSV для Excel: BOM, «;», числа с запятой, кавычки там, где нужно", () => {
  const csv = toCsv([{ key: "a", title: "Товар" }, { key: "b", title: "Сумма" }], [{ a: 'Круг "125"; мет.', b: 1250.5 }, { a: "Біти", b: null }]);
  assert.equal(csv, '﻿Товар;Сумма\r\n"Круг ""125""; мет.";1250,5\r\nБіти;\r\n');
});
