// Финансы (шаг 4.5) на базе handyman_test: снимок закупки в заказе, дата «Выполнен», прибыль месяца, расходы, деньги в пути.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let fin: typeof import("../src/finance");
let prod: { id: string; sku: string; price: number };

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  await prisma.expense.deleteMany();
  orders = await import("../src/orders");
  fin = await import("../src/finance");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const p = await prisma.product.findFirstOrThrow({ where: { visible: true }, orderBy: { price: "desc" } });
  prod = { id: p.id, sku: p.sku, price: p.price.toNumber() };
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const order = async (isTest = false) => {
  const r = await orders.placeManualOrder({ phone: "+380935552200", name: "Фін", items: [{ sku: prod.sku, qty: 2 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest }, "test");
  assert.ok(r.ok);
  return r.id;
};

test("закупка на момент заказа, «Выполнен» ставит дату, прибыль месяца без тестовых, расходы и сравнение", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.product.update({ where: { id: prod.id }, data: { purchasePrice: prod.price * 0.6 } });
  const a = await order();
  const test1 = await order(true);
  await prisma.product.update({ where: { id: prod.id }, data: { purchasePrice: prod.price * 0.9 } }); // закупка подорожала — старый заказ не меняется
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: a } });
  assert.equal(item.unitCost?.toNumber(), Math.round(prod.price * 0.6 * 100) / 100);

  await fin.saveFinance({ commissionPct: { LATER: 2 } }, "test");
  await fin.setOrderDeliveryCost(a, 50, "test");
  await orders.setOrderStatus(a, "DONE", "test");
  await orders.setOrderStatus(test1, "DONE", "test");
  const done = await prisma.order.findUniqueOrThrow({ where: { id: a } });
  assert.ok(done.doneAt);

  const month = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }).slice(0, 7);
  await fin.addExpense({ month, category: "Аренда", title: "Склад", amount: 1000 }, "Владелец");
  const rep = await fin.monthReport(month);
  assert.equal(rep.totals.count, 1); // тестовый не в отчёте
  const revenue = prod.price * 2;
  const cost = Math.round(prod.price * 0.6 * 100) / 100 * 2;
  const profit = Math.round((revenue - cost - revenue * 0.02 - 50) * 100) / 100;
  assert.equal(rep.totals.revenue, revenue);
  assert.equal(rep.orders[0].profit.profit, profit);
  assert.equal(rep.totals.expenses, 1000);
  assert.equal(rep.totals.net, Math.round((profit - 1000) * 100) / 100);
  assert.equal((await fin.orderProfitOf(a))?.delivery, 50);

  await orders.setOrderStatus(a, "SHIPPED", "test"); // ушёл из «Выполнен» — дата стирается, из отчёта выпадает
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: a } })).doneAt, null);
  assert.equal((await fin.monthReport(month)).totals.count, 0);
  await orders.setOrderStatus(a, "CANCELLED", "test", undefined, "test");
});

test("деньги в пути: отправленные с остатком к оплате; копия расходов прошлого месяца; удаление расхода", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeOrder(
    { firstName: "Іван", lastName: "Петренко", phone: "0935552201", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay", items: [{ sku: prod.sku, qty: 1 }] },
    { lang: "uk" },
  );
  assert.ok(r.ok);
  const id = (await prisma.order.findUniqueOrThrow({ where: { no: r.no } })).id;
  await orders.setOrderStatus(id, "SHIPPED", "test");
  const month = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }).slice(0, 7);
  const rep = await fin.monthReport(month);
  assert.equal(rep.inTransit.count, 1);
  assert.equal(rep.inTransit.amount, Math.round((r.total - r.dueNow) * 100) / 100);

  const next = new Date(Date.now() + 40 * 86400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }).slice(0, 7);
  const { shiftMonth } = await import("@handyman/core/shop");
  const copied = await fin.copyExpensesFromPrev(shiftMonth(month, 1), "test");
  assert.equal(copied, 1);
  const exp = await prisma.expense.findFirstOrThrow({ where: { month: shiftMonth(month, 1) } });
  await fin.deleteExpense(exp.id, "test");
  assert.equal(await prisma.expense.count({ where: { month: shiftMonth(month, 1) } }), 0);
  assert.ok(next);
});
