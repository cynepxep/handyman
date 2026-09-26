// Склад (шаг 4.4) на базе handyman_test: резерв → отгрузка → возврат, отмена до отправки, возврат в работу, приход, инвентаризация, «заканчивается».
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let stock: typeof import("../src/stock");
let p1: { id: string; sku: string };
let p2: { id: string; sku: string };

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  await prisma.stockDoc.deleteMany();
  orders = await import("../src/orders");
  stock = await import("../src/stock");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const [a, b] = await prisma.product.findMany({ where: { visible: true }, orderBy: { sku: "asc" }, take: 2, select: { id: true, sku: true } });
  p1 = a;
  p2 = b;
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const cell = async (productId: string) => {
  const items = await prisma.stockItem.findMany({ where: { productId } });
  return { onHand: items.reduce((s, i) => s + i.onHand, 0), reserved: items.reduce((s, i) => s + i.reserved, 0) };
};
const order = async (sku: string, qty: number) => {
  const r = await orders.placeManualOrder({ phone: "+380935551100", name: "Тест", items: [{ sku, qty }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: false }, "test");
  assert.ok(r.ok);
  return r.id;
};

test("резерв: заказ откладывает товар (на полке столько же), отгрузка списывает, возврат после отправки возвращает на полку", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await orders.setOwnStock(p1.id, 5, "test");
  const id = await order(p1.sku, 3);
  assert.deepEqual(await cell(p1.id), { onHand: 5, reserved: 3 });
  assert.equal((await orders.ownStockOf([p1.id])).get(p1.id), 2); // покупателям доступно 2
  await orders.setOrderStatus(id, "PACKED", "test");
  assert.deepEqual(await cell(p1.id), { onHand: 5, reserved: 3 }); // собран — ещё на складе
  await orders.setOrderStatus(id, "SHIPPED", "test");
  assert.deepEqual(await cell(p1.id), { onHand: 2, reserved: 0 });
  await orders.setOrderStatus(id, "DONE", "test"); // из «Отправлен» в «Выполнен» — второй раз не списывает
  assert.deepEqual(await cell(p1.id), { onHand: 2, reserved: 0 });
  await orders.setOrderStatus(id, "RETURNED", "test", undefined, "defect");
  assert.deepEqual(await cell(p1.id), { onHand: 5, reserved: 0 });
  await orders.setOrderStatus(id, "RETURNED", "test", undefined, "other"); // повтор — без двойного возврата
  assert.deepEqual(await cell(p1.id), { onHand: 5, reserved: 0 });
});

test("отмена до отправки снимает резерв; вернули в работу — резерв снова (сколько есть); заказать больше, чем есть — резерв частичный", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await orders.setOwnStock(p2.id, 2, "test");
  const id = await order(p2.sku, 5);
  assert.deepEqual(await cell(p2.id), { onHand: 2, reserved: 2 });
  await orders.setOrderStatus(id, "CANCELLED", "test", undefined, "price");
  assert.deepEqual(await cell(p2.id), { onHand: 2, reserved: 0 });
  await orders.setOrderStatus(id, "NEW", "test");
  assert.deepEqual(await cell(p2.id), { onHand: 2, reserved: 2 });
  await orders.setOrderStatus(id, "CANCELLED", "test", undefined, "price");
});

test("старый заказ (до шага 4.4 списывал сразу): отмена по-прежнему возвращает на склад", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const id = await order(p2.sku, 1); // p2: на складе 2, резерв 1
  const it = await prisma.stockItem.findFirstOrThrow({ where: { productId: p2.id } });
  // превращаем в «старый»: без резерва, со списанием SALE
  await prisma.stockMovement.deleteMany({ where: { refOrderId: id } });
  await prisma.stockItem.update({ where: { id: it.id }, data: { reserved: 0, onHand: 1 } });
  await prisma.stockMovement.create({ data: { stockItemId: it.id, delta: -1, reason: "SALE", refOrderId: id } });
  await orders.setOrderStatus(id, "CANCELLED", "test");
  assert.deepEqual(await cell(p2.id), { onHand: 2, reserved: 0 });
});

test("приход и инвентаризация: документы с номером, закупочная цена в товар, разница в журнал; в списке склада стоимость", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const rec = await stock.receiveStock({ supplier: "Vitals", note: "накладная 17", lines: [{ sku: p1.sku, qty: 10, unitCost: 40 }, { sku: p2.sku, qty: 1, unitCost: null }] }, "Склад");
  assert.ok(rec.ok);
  assert.deepEqual(await cell(p1.id), { onHand: 15, reserved: 0 });
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: p1.id } })).purchasePrice?.toNumber(), 40);
  const bad = await stock.receiveStock({ supplier: "", note: "", lines: [{ sku: "НЕТ", qty: 1, unitCost: null }] }, "x");
  assert.ok(!bad.ok);

  const inv = await stock.inventoryStock({ note: "", lines: [{ sku: p1.sku, counted: 14 }, { sku: p2.sku, counted: 3 }] }, "Склад");
  assert.ok(inv.ok && inv.diffs === 1); // p2: было 3 — без разницы
  assert.deepEqual(await cell(p1.id), { onHand: 14, reserved: 0 });
  const moves = await stock.listMoves({ docId: inv.docId });
  assert.deepEqual(moves.rows.map((m) => [m.reason, m.delta]), [["ADJUSTMENT", -1]]);

  const list = await stock.listStock({});
  const row = list.rows.find((r) => r.productId === p1.id)!;
  assert.equal(row.available, 14);
  assert.equal(list.totals.value, 14 * 40 + 0); // у p2 нет закупочной цены
  assert.equal(list.totals.noCost, 1);
  assert.equal((await stock.listStockDocs()).length, 2);
});

test("минимальный остаток: заказ, после которого товара стало не больше порога, — одно уведомление менеджеру", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await stock.setStockSettings(p1.id, { minStock: 12, purchasePrice: 40 }, "test"); // сейчас доступно 14
  const before = await prisma.outbox.count({ where: { audience: "manager", text: { startsWith: "⚠️ Заканчивается" } } });
  const a = await order(p1.sku, 2); // 14 → 12: перешли порог
  const b = await order(p1.sku, 1); // 12 → 11: уже ниже — повторно не пишем
  const after = await prisma.outbox.findMany({ where: { audience: "manager", text: { startsWith: "⚠️ Заканчивается" } } });
  assert.equal(after.length - before, 1);
  assert.match(after.at(-1)!.text, new RegExp(`${p1.sku}.*доступно 12 шт\\., минимум 12`));
  assert.equal((await stock.lowStockList()).some((r) => r.productId === p1.id), true);
  await orders.setOrderStatus(a, "CANCELLED", "test", undefined, "test");
  await orders.setOrderStatus(b, "CANCELLED", "test", undefined, "test");
});
