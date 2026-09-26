// Отчёты (шаг 4.6) на базе handyman_test: продажи без тестовых и отмен, новые/повторные, топ товаров, скорость обработки, каталог.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let rep: typeof import("../src/reports");
let skus: string[] = [];

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  rep = await import("../src/reports");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  skus = (await prisma.product.findMany({ where: { visible: true }, orderBy: { sku: "asc" }, take: 2, select: { sku: true } })).map((p) => p.sku);
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const place = async (phone: string, sku: string, qty: number, isTest = false) => {
  const r = await orders.placeManualOrder({ phone, name: "Звіт", items: [{ sku, qty }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest }, "Оля");
  assert.ok(r.ok);
  return r.id;
};

test("продажи, товары, заказы за 7 дней: тестовые и отменённые не в выручке; клиент с заказом до периода — повторный", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const { periodRange } = await import("@handyman/core/shop");
  const old = await place("+380935554401", skus[0], 1);
  await prisma.order.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 20 * 86400_000) } }); // «давний» заказ
  const a = await place("+380935554401", skus[0], 3); // повторный клиент
  const b = await place("+380935554402", skus[1], 1); // новый
  await place("+380935554403", skus[1], 5, true); // тестовый
  const c = await place("+380935554404", skus[1], 2);
  await orders.setOrderStatus(c, "CANCELLED", "Оля", undefined, "price");
  await orders.setOrderStatus(a, "PACKED", "Петя");

  const p = periodRange({ period: "7d" });
  const s = await rep.salesReport(p);
  const [ta, tb] = await Promise.all([a, b].map((id) => prisma.order.findUniqueOrThrow({ where: { id } })));
  assert.equal(s.cur.orders, 3); // a, b, c (тестовый не считается)
  assert.equal(s.cur.sold, 2);
  assert.equal(s.cur.revenue, Math.round((ta.total.toNumber() + tb.total.toNumber()) * 100) / 100);
  assert.equal(s.cur.lost, 1);
  assert.equal(s.cur.newClients, 2); // b и c
  assert.equal(s.cur.repeatClients, 1); // a
  assert.equal(s.lostByReason[0].key, "Дорого / нашёл дешевле");
  assert.equal(s.days.length, 7);
  assert.equal(s.days.reduce((x, d) => x + d.orders, 0), 2);
  assert.equal(s.bySource[0].key, "manual");

  const pr = await rep.productsReport(p);
  assert.equal(pr.byQty[0].sku, skus[0]);
  assert.equal(pr.byQty[0].qty, 3);

  const or = await rep.ordersReport(p);
  assert.equal(or.total, 3);
  assert.ok(or.firstTouchMedian != null && or.firstTouchMedian >= 0);
  assert.deepEqual(or.byWho.map((w) => w.who).sort(), ["Оля", "Петя"]);
  assert.equal(or.byCreator[0].key, "Оля");

  const cat = await rep.catalogStats();
  assert.ok(cat.total >= 2 && cat.visible >= 2);
  const dash = await rep.dashboard(p);
  assert.ok(dash.action.some((o) => o.id === b)); // «Новый» требует действия
});
