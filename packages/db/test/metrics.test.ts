// «Отчёты → Метрики» на базе handyman_test: счётчик посетителей без cookies (раз в день, роботы мимо, соль меняется каждый день),
// воронка до выкупа, средний чек, валовая прибыль, CAC и ROAS по расходу «Реклама», повторные покупки, каналы по меткам.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let fin: typeof import("../src/finance");
let mx: typeof import("../src/metrics");
const SKU = "MX-TEST-1";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

const form = (phone: string, qty = 1) => ({
  firstName: "Іван", lastName: "Петренко", phone, delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items: [{ sku: SKU, qty }],
});

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  fin = await import("../src/finance");
  mx = await import("../src/metrics");
  await prisma.$executeRawUnsafe('TRUNCATE "Expense"');
  await prisma.product.create({ data: { sku: SKU, nameUk: "Шуруповерт", nameRu: "Шуруповерт", price: 1000, purchasePrice: 700, categoryId: "ak", supplierAvailable: true } });
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const counts = async () => Object.fromEntries((await prisma.metricDay.findMany()).map((r) => [`${r.step}:${r.channel}`, r.count]));

test("счётчик: один человек — один раз в день на шаг; корзина отмечает и визит; роботы мимо; канал по меткам; новый день — новая соль", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const now = new Date("2026-10-05T09:00:00Z");
  assert.equal(await mx.recordMetric("visit", { ip: "1.1.1.1", ua: PHONE_UA }, now), true);
  assert.equal(await mx.recordMetric("visit", { ip: "1.1.1.1", ua: PHONE_UA }, now), false, "тот же человек в тот же день");
  assert.equal(await mx.recordMetric("visit", { ip: "1.1.1.1", ua: PC_UA }, now), true, "другой браузер с того же адреса — другой человек");
  assert.equal(await mx.recordMetric("visit", { ip: "2.2.2.2", ua: "Googlebot/2.1 (+http://www.google.com/bot.html) Mozilla/5.0" }, now), false);
  assert.equal(await mx.recordMetric("cart", { ip: "3.3.3.3", ua: PHONE_UA, utm: '{"utm_source":"google","gclid":"x"}' }, now), true);
  assert.equal(await mx.recordMetric("checkout", { ip: "3.3.3.3", ua: PHONE_UA, utm: { gclid: "x" } }, now), true);
  assert.deepEqual(await counts(), { "visit:none": 2, "visit:google": 1, "cart:google": 1, "checkout:google": 1 });
  const seen = await prisma.metricSeen.findFirstOrThrow();
  assert.equal(seen.visitor.length, 16);
  assert.ok(!seen.visitor.includes("1.1.1.1"), "в базе отпечаток, а не адрес");

  // через два дня: соль новая, отпечатки позавчера и раньше удалены, тот же человек снова считается
  const later = new Date("2026-10-07T09:00:00Z");
  const saltBefore = (await prisma.setting.findUniqueOrThrow({ where: { key: "metrics.salt" } })).value as { salt: string };
  assert.equal(await mx.recordMetric("visit", { ip: "1.1.1.1", ua: PHONE_UA }, later), true);
  const saltAfter = (await prisma.setting.findUniqueOrThrow({ where: { key: "metrics.salt" } })).value as { salt: string; day: string };
  assert.notEqual(saltAfter.salt, saltBefore.salt);
  assert.equal(saltAfter.day, "2026-10-07");
  assert.equal(await prisma.metricSeen.count({ where: { day: new Date("2026-10-05T00:00:00Z") } }), 0);
  assert.equal(await prisma.metricSeen.count(), 1);
  await prisma.$executeRawUnsafe('TRUNCATE "MetricDay", "MetricSeen"');
});

test("отчёт: воронка, выкуп, средний чек, валовая прибыль, CAC, ROAS, повторные; тестовые не считаются", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const { periodRange, kyivYmd } = await import("@handyman/core/shop");
  const now = new Date();
  // 4 посетителя, двое положили в корзину (один — с Google Ads), один оформлял
  await mx.recordMetric("visit", { ip: "10.0.0.1", ua: PHONE_UA }, now);
  await mx.recordMetric("visit", { ip: "10.0.0.2", ua: PHONE_UA }, now);
  await mx.recordMetric("cart", { ip: "10.0.0.3", ua: PHONE_UA }, now);
  await mx.recordMetric("checkout", { ip: "10.0.0.4", ua: PHONE_UA, utm: { gclid: "g" } }, now);
  await mx.recordMetric("cart", { ip: "10.0.0.4", ua: PHONE_UA, utm: { gclid: "g" } }, now);

  // давний покупатель: заказ 40 дней назад — сейчас он «повторный»
  const place = async (...a: Parameters<typeof orders.placeOrder>) => {
    const r = await orders.placeOrder(...a);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r;
  };
  const old = await place(form("093 111 00 01"), { lang: "uk" });
  await prisma.order.update({ where: { no: old.no }, data: { createdAt: new Date(Date.now() - 40 * 86400_000) } });

  const ads = await place(form("093 111 00 02", 2), { lang: "uk", utm: { utm_source: "google", gclid: "g" } }); // новый, с рекламы
  const again = await place(form("093 111 00 01"), { lang: "uk" }); // повторный
  const lost = await place(form("093 111 00 03"), { lang: "uk", utm: { fbclid: "f" } }); // отменят
  const tst = await place(form("093 111 00 04", 5), { lang: "uk", isTest: true });
  const phone = await orders.placeManualOrder({ phone: "+380931110005", name: "Звонок", items: [{ sku: SKU, qty: 1 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: false }, "Оля");
  if (!phone.ok) throw new Error("заказ по звонку не оформлен");
  const id = async (no: string) => (await prisma.order.findUniqueOrThrow({ where: { no } })).id;
  await orders.setOrderStatus(await id(ads.no), "DONE", "test");
  await orders.setOrderStatus(await id(tst.no), "DONE", "test");
  await orders.setOrderStatus(await id(lost.no), "CANCELLED", "test", undefined, "price");

  const month = kyivYmd(now).slice(0, 7);
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  await fin.addExpense({ month, category: "Реклама", title: "Google Ads", amount: 100 * daysInMonth }, "Владелец"); // 100 ₴ в день
  await fin.addExpense({ month, category: "Аренда", title: "Склад", amount: 9999 }, "Владелец"); // не реклама

  const p = periodRange({ period: "today" });
  const m = await mx.metricsReport(p);
  const c = m.cur;
  const total = async (no: string) => (await prisma.order.findUniqueOrThrow({ where: { no } })).total.toNumber();
  const [adsT, againT, phoneT] = await Promise.all([total(ads.no), total(again.no), (await prisma.order.findUniqueOrThrow({ where: { id: phone.id } })).total.toNumber()]);

  assert.equal(c.visitors, 4);
  assert.equal(c.cart, 2);
  assert.equal(c.checkout, 1);
  assert.equal(c.orders, 4, "ads, again, lost, по звонку; тестовый не считается");
  assert.equal(c.online, 3);
  assert.equal(c.manual, 1);
  assert.equal(c.conversion, 75);
  assert.equal(c.done, 1);
  assert.equal(c.doneOnline, 1);
  assert.equal(c.doneSum, adsT);
  assert.equal(c.lost, 1);
  assert.equal(c.inWork, 2);
  assert.equal(c.buyout, 25);
  assert.equal(c.sold, 3);
  assert.equal(c.avg, Math.round(((adsT + againT + phoneT) / 3) * 100) / 100);
  // прибыль выкупленного: 2 × (1000 − 700) минус комиссия предоплаты по настройкам «Финансов»
  const profit = (await fin.orderProfitOf(await id(ads.no)))!;
  assert.equal(c.gross, profit.profit);
  assert.ok(c.gross > 0 && c.gross <= 600);
  assert.equal(c.spend, 100);
  assert.equal(c.newClients, 3, "ads, lost, по звонку");
  assert.equal(c.repeatClients, 1);
  assert.equal(c.repeatShare, 25);
  assert.equal(c.cac, Math.round((100 / 3) * 100) / 100);
  assert.equal(c.adRevenue, adsT, "отменённый с Facebook не в выручке");
  assert.equal(c.roas, Math.round((adsT / 100) * 100) / 100);
  assert.deepEqual(m.allTime, { buyers: 3, repeaters: 1, share: 33.3 }, "отменивший не считается покупателем");

  const g = c.channels.find((x) => x.channel === "google")!;
  assert.deepEqual({ v: g.visitors, cart: g.cart, ch: g.checkout, o: g.orders, rev: g.revenue, sp: g.spend, nc: g.newClients }, { v: 1, cart: 1, ch: 1, o: 1, rev: adsT, sp: 100, nc: 1 });
  assert.equal(g.roas, c.roas);
  assert.equal(g.cac, 100);
  const meta = c.channels.find((x) => x.channel === "meta")!;
  assert.equal(meta.orders, 1);
  assert.equal(meta.revenue, 0);
  assert.equal(c.channels.find((x) => x.channel === "tiktok"), undefined, "пустой канал не показывается");
  assert.equal(m.countingSince, kyivYmd(now));
  assert.equal(m.days.length, 1);
  assert.equal(m.days[0].visitors, 4);
  assert.equal(m.days[0].orders, 3);
  // прошлый период пуст
  assert.equal(m.prev.visitors, 0);
  assert.equal(m.prev.cac, null);
});
