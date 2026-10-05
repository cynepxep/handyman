import { test } from "node:test";
import assert from "node:assert/strict";
import { adSpendFor, cac, channelOf, isBotAgent, isMetricStep, rate, roas, spendChannelOf } from "../src/shop";

test("канал по меткам: клик-идентификатор важнее utm_source; без меток — «без рекламы»; мусор — тоже", () => {
  assert.equal(channelOf({ utm_source: "google", utm_medium: "cpc" }), "google");
  assert.equal(channelOf({ gclid: "abc" }), "google");
  assert.equal(channelOf({ utm_source: "newsletter", fbclid: "x" }), "meta");
  assert.equal(channelOf({ utm_source: "Instagram" }), "meta");
  assert.equal(channelOf({ utm_source: "ig" }), "meta");
  assert.equal(channelOf({ ttclid: "t" }), "tiktok");
  assert.equal(channelOf({ utm_source: "viber_blogger" }), "other");
  assert.equal(channelOf('{"utm_source":"tiktok"}'), "none"); // строка — не объект из базы
  assert.equal(channelOf(null), "none");
  assert.equal(channelOf({ landing: "/" }), "none");
  assert.equal(channelOf([1, 2]), "none");
});

test("канал расхода — по названию строки в «Расходах»", () => {
  assert.equal(spendChannelOf("Google Ads, сентябрь"), "google");
  assert.equal(spendChannelOf("Реклама в Инстаграм"), "meta");
  assert.equal(spendChannelOf("Facebook"), "meta");
  assert.equal(spendChannelOf("ТікТок"), "tiktok");
  assert.equal(spendChannelOf("Блогер на YouTube"), "google");
  assert.equal(spendChannelOf("Листовки"), "other");
});

test("расход на рекламу за дни периода: месячная сумма делится на дни месяца; чужие месяцы не считаются", () => {
  const exp = [
    { month: "2026-09", title: "Google Ads", amount: 3000 }, // 100 ₴ в день
    { month: "2026-09", title: "Instagram", amount: 600 }, // 20 ₴ в день
    { month: "2026-10", title: "Google Ads", amount: 3100 }, // 100 ₴ в день
    { month: "2026-08", title: "TikTok", amount: 5000 },
    { month: "2026-09", title: "ошибка", amount: -10 },
  ];
  const s = adSpendFor(exp, ["2026-09-29", "2026-09-30", "2026-10-01"]);
  assert.equal(s.total, 340);
  assert.deepEqual(s.byChannel, { google: 300, meta: 40 });
  assert.deepEqual(adSpendFor(exp, []), { total: 0, byChannel: {} });
  // весь месяц — вся сумма
  const sept = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
  assert.equal(adSpendFor(exp, sept).total, 3600);
});

test("доли, CAC, ROAS: делить не на что — null", () => {
  assert.equal(rate(1, 3), 33.3);
  assert.equal(rate(5, 0), null);
  assert.equal(cac(1000, 4), 250);
  assert.equal(cac(0, 4), null);
  assert.equal(cac(1000, 0), null);
  assert.equal(roas(5000, 1000), 5);
  assert.equal(roas(5000, 0), null);
  assert.equal(roas(0, 300), 0);
});

test("роботы и шаги", () => {
  assert.equal(isBotAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(isBotAgent("facebookexternalhit/1.1"), true);
  assert.equal(isBotAgent("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 Chrome-Lighthouse"), true);
  assert.equal(isBotAgent(""), true);
  assert.equal(isBotAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), false);
  assert.equal(isMetricStep("cart"), true);
  assert.equal(isMetricStep("purchase"), false);
});
