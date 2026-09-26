import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NOTIFY, dailyDue, deltaText, kyivClock, normalizeNotify, salesDropped, weeklyDue } from "../src/shop";

test("часы по Киеву, день недели и ISO-неделя", () => {
  const c = kyivClock(new Date("2026-09-26T18:30:00Z")); // суббота 21:30 по Киеву
  assert.deepEqual(c, { ymd: "2026-09-26", hour: 21, weekday: 5, isoWeek: "2026-W39" });
  assert.equal(kyivClock(new Date("2026-12-31T23:30:00Z")).isoWeek, "2026-W53"); // 1 января 01:30 по Киеву, неделя 2026 года
  assert.equal(kyivClock(new Date("2027-01-04T08:00:00Z")).isoWeek, "2027-W01");
});

test("сводка в 21:00 по Киеву, отчёт в понедельник с 9:00; выключенные — никогда", () => {
  assert.equal(dailyDue(DEFAULT_NOTIFY, new Date("2026-09-26T17:59:00Z")), false); // 20:59
  assert.equal(dailyDue(DEFAULT_NOTIFY, new Date("2026-09-26T18:00:00Z")), true); // 21:00
  assert.equal(dailyDue({ ...DEFAULT_NOTIFY, daily: false }, new Date("2026-09-26T20:00:00Z")), false);
  assert.equal(weeklyDue(DEFAULT_NOTIFY, new Date("2026-09-28T06:00:00Z")), true); // понедельник 9:00
  assert.equal(weeklyDue(DEFAULT_NOTIFY, new Date("2026-09-28T05:59:00Z")), false);
  assert.equal(weeklyDue(DEFAULT_NOTIFY, new Date("2026-09-29T10:00:00Z")), false); // вторник
});

test("падение продаж: меньше 60 % от обычного для этого дня недели и в среднем хотя бы 3 заказа", () => {
  assert.deepEqual(salesDropped(2, [6, 5, 7]), { dropped: true, avg: 6, pct: 67 });
  assert.equal(salesDropped(4, [6, 5, 7]).dropped, false);
  assert.equal(salesDropped(0, [1, 2, 1]).dropped, false, "мало заказов — не паникуем");
  assert.equal(deltaText(120, 100), "+20%");
  assert.equal(deltaText(70, 100), "−30%");
  assert.equal(deltaText(5, 0), "");
});

test("настройки уведомлений: мусор → по умолчанию, час 0–23", () => {
  assert.deepEqual(normalizeNotify(null), DEFAULT_NOTIFY);
  const s = normalizeNotify({ daily: false, dailyHour: 25, weeklyHour: "8", showMoney: false });
  assert.equal(s.daily, false);
  assert.equal(s.dailyHour, 21);
  assert.equal(s.weeklyHour, 8);
  assert.equal(s.showMoney, false);
});
