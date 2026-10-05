// Заказы в админке (шаг 4.3) на базе handyman_test: заказ по звонку, фильтры, причина отмены, реквизиты.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let skuA = "";
let skuB = "";
let priceA = 0;

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const [a, b] = await prisma.product.findMany({ where: { visible: true }, orderBy: { sku: "asc" }, take: 2 });
  skuA = a.sku;
  skuB = b.sku;
  priceA = a.price.toNumber();
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const manual = (over: Record<string, unknown> = {}) => ({
  phone: "+380931230000", name: "Бригада Ковальчука", items: [{ sku: skuA, qty: 2 }, { sku: skuB, qty: 1 }], delivery: "to_confirm" as const, pay: "later" as const,
  city: "", npPoint: "", address: "", comment: "звонил в 10:15", isTest: false, ...over,
});

test("заказ по звонку: цены из базы, источник «manual», кто оформил, клиент создан; чужой артикул — понятная ошибка", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeManualOrder(manual(), "Менеджер Оля");
  assert.ok(r.ok);
  const o = await prisma.order.findUniqueOrThrow({ where: { id: r.id }, include: { items: true, client: true, history: true } });
  assert.equal(o.source, "manual");
  assert.equal(o.createdBy, "Менеджер Оля");
  assert.equal(o.items.find((i) => i.sku === skuA)?.unitPrice.toNumber(), priceA);
  assert.equal(o.client.phone, "+380931230000");
  assert.match(o.history[0].text, /по звонку \(Менеджер Оля\)/);
  const bad = await orders.placeManualOrder(manual({ items: [{ sku: "НЕТ-ТАКОГО", qty: 1 }] }), "x");
  assert.ok(!bad.ok && bad.error.includes("НЕТ-ТАКОГО"));
});

test("фильтры: требуют действия, источник, тестовые скрыть/только, даты; сумма без отмен и тестовых", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const t1 = await orders.placeManualOrder(manual({ isTest: true }), "x");
  const c1 = await orders.placeManualOrder(manual(), "x");
  assert.ok(t1.ok && c1.ok);
  await orders.setOrderStatus(c1.id, "CANCELLED", "x", undefined, "price");
  const all = await orders.listOrders({});
  assert.equal(all.total, 3);
  assert.equal((await orders.listOrders({ test: "hide" })).total, 2);
  assert.equal((await orders.listOrders({ test: "only" })).total, 1);
  assert.equal((await orders.listOrders({ status: "action" })).total, 2); // два «Новых», отменённый — нет
  assert.equal(all.actionCount, 1); // тестовый не в счётчике
  assert.equal((await orders.listOrders({ source: "site" })).total, 0);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  assert.equal((await orders.listOrders({ from: today, to: today })).total, 3);
  assert.equal((await orders.listOrders({ from: "2020-01-01", to: "2020-01-02" })).total, 0);
  const first = await prisma.order.findFirstOrThrow({ where: { isTest: false, status: "NEW" } });
  assert.equal(all.sum, first.total.toNumber()); // отменённый и тестовый не в сумме
});

test("причина отмены: сохраняется и пишется в историю; без причины — «Другое»; при возврате в работу стирается", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeManualOrder(manual(), "x");
  assert.ok(r.ok);
  await orders.setOrderStatus(r.id, "CANCELLED", "Оля", undefined, "np_refused");
  let o = await prisma.order.findUniqueOrThrow({ where: { id: r.id }, include: { history: { orderBy: { ts: "asc" } } } });
  assert.equal(o.cancelReason, "np_refused");
  assert.match(o.history.at(-1)!.text, /Не забрал на Новой Почте/);
  await orders.setOrderStatus(r.id, "CANCELLED", "Оля", undefined, "duplicate"); // смена только причины — тоже в историю
  o = await prisma.order.findUniqueOrThrow({ where: { id: r.id }, include: { history: { orderBy: { ts: "asc" } } } });
  assert.equal(o.cancelReason, "duplicate");
  assert.match(o.history.at(-1)!.text, /^Причина: Дубль заказа/);
  await orders.setOrderStatus(r.id, "NEW", "Оля");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: r.id } })).cancelReason, null);
  await orders.setOrderStatus(r.id, "RETURNED", "Оля", undefined, "что-то чужое");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: r.id } })).cancelReason, "other");
});

test("реквизиты продавца: сохраняются и читаются", async (t) => {
  if (!ready) return t.skip(skipMsg);
  assert.equal((await orders.loadSeller()).name, "");
  await orders.saveSeller({ name: "ФОП Тест", code: "1234567890", iban: "UA213223130000026007233566001", bank: "", address: "", note: "" }, "test");
  assert.equal((await orders.loadSeller()).name, "ФОП Тест");
});

test("удаление заказа: резерв возвращается, задачи и уведомления удаляются, гарантия остаётся без ссылки, запись в журнале", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const pA = await prisma.product.findUniqueOrThrow({ where: { sku: skuA } });
  await orders.setOwnStock(pA.id, 5, "test");
  const r = await orders.placeManualOrder(manual({ phone: "+380931230077" }), "x");
  assert.ok(r.ok);
  const item = await prisma.stockItem.findFirstOrThrow({ where: { productId: pA.id } });
  assert.equal(item.reserved, 2);
  await prisma.task.create({ data: { title: "Перезвонить", orderId: r.id, who: "x" } });
  const sc = await prisma.serviceCase.create({ data: { orderId: r.id, productName: "Дриль", problem: "не крутить", who: "x" } });
  await prisma.outbox.create({ data: { chatId: "1", orderId: r.id, text: "новый заказ" } });

  const d = await orders.deleteOrder(r.id, "Владелец");
  assert.deepEqual(d, { ok: true, no: r.no });
  assert.equal(await prisma.order.count({ where: { id: r.id } }), 0);
  assert.equal((await prisma.stockItem.findUniqueOrThrow({ where: { id: item.id } })).reserved, 0);
  assert.equal(await prisma.task.count({ where: { orderId: r.id } }), 0);
  assert.equal(await prisma.outbox.count({ where: { orderId: r.id } }), 0);
  assert.equal((await prisma.serviceCase.findUniqueOrThrow({ where: { id: sc.id } })).orderId, null);
  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "order.delete", target: r.no } });
  assert.equal(log.who, "Владелец");
  assert.equal((log.details as { items: unknown[] }).items.length, 2);
  assert.equal((await orders.deleteOrder(r.id, "x")).ok, false); // второй раз — «не найден», без падения
});

test("удаление заказа: оплаченный, с живой ссылкой на оплату или с настоящим чеком — нельзя; тестовые счета не мешают", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const mk = async () => {
    const r = await orders.placeManualOrder(manual({ phone: "+380931230078" }), "x");
    assert.ok(r.ok);
    return r.id;
  };
  const inv = (orderId: string, over: Record<string, unknown>) =>
    prisma.payInvoice.create({ data: { id: `del-${Math.random()}`, orderId, kind: "full", amount: 100, pageUrl: "https://pay.mbnk.biz/x", createdBy: "сайт", ...over } });

  const paid = await mk();
  await inv(paid, { status: "success", paid: 100 });
  const r1 = await orders.deleteOrder(paid, "x");
  assert.ok(!r1.ok && /оплачен/.test(r1.error));

  const pending = await mk();
  await inv(pending, { status: "created" });
  const r2 = await orders.deleteOrder(pending, "x");
  assert.ok(!r2.ok && /ссылка на оплату/.test(r2.error));

  const receipt = await mk();
  await prisma.fiscalReceipt.create({ data: { id: `rc-${Math.random()}`, orderId: receipt, kind: "sell", payType: "CASH", amount: 100, goods: [], createdBy: "x" } });
  const r3 = await orders.deleteOrder(receipt, "x");
  assert.ok(!r3.ok && /чек/.test(r3.error));
  assert.equal(await prisma.order.count({ where: { id: { in: [paid, pending, receipt] } } }), 3);

  const stub = await mk();
  await inv(stub, { status: "success", paid: 100, stub: true });
  await prisma.fiscalReceipt.create({ data: { id: `rc-${Math.random()}`, orderId: stub, kind: "sell", payType: "CASHLESS", amount: 100, goods: [], stub: true, createdBy: "x" } });
  assert.equal((await orders.deleteOrder(stub, "x")).ok, true);
  assert.equal(await prisma.payInvoice.count({ where: { orderId: stub } }), 0);
});

test("удаление выполненного заказа пересчитывает сумму покупок клиента", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeManualOrder(manual({ phone: "+380931230079" }), "x");
  assert.ok(r.ok);
  await orders.setOrderStatus(r.id, "DONE", "x");
  const o = await prisma.order.findUniqueOrThrow({ where: { id: r.id }, include: { client: true } });
  assert.equal(o.client.spent.toString(), o.total.toString());
  assert.ok((await orders.deleteOrder(r.id, "x")).ok);
  assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: o.clientId } })).spent.toNumber(), 0);
});
