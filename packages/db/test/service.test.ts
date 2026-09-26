// Задачи и гарантия (шаг 4.5б) на базе handyman_test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let svc: typeof import("../src/service");
let sku = "";

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  await prisma.task.deleteMany();
  await prisma.serviceCase.deleteMany();
  orders = await import("../src/orders");
  svc = await import("../src/service");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  sku = (await prisma.product.findFirstOrThrow({ where: { visible: true }, orderBy: { sku: "asc" } })).sku;
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const order = async () => {
  const r = await orders.placeManualOrder({ phone: "+380935553300", name: "Сервіс Тест", items: [{ sku, qty: 1 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: false }, "test");
  assert.ok(r.ok);
  return r;
};

test("задачи: к заказу (клиент подставляется), просроченные сверху, выполнить и вернуть, свои + общие", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const o = await order();
  const late = await svc.createTask({ title: "перезвонить", dueAt: new Date(Date.now() - 3600_000), assignee: null, orderId: o.id }, "Оля");
  await svc.createTask({ title: "без срока", dueAt: null, assignee: "petya" }, "Оля");
  await svc.createTask({ title: "завтра", dueAt: new Date(Date.now() + 30 * 3600_000), assignee: "olya" }, "Оля");
  assert.ok(late.clientId);
  const all = await svc.listTasks();
  assert.deepEqual(all.rows.map((r) => r.title), ["перезвонить", "завтра", "без срока"]);
  assert.equal(all.rows[0].bucket, "overdue");
  assert.equal(all.rows[0].orderNo, o.no);
  assert.equal(all.counts.overdue, 1);
  assert.deepEqual((await svc.listTasks({ assignee: "olya" })).rows.map((r) => r.title), ["перезвонить", "завтра"]); // свои + без исполнителя
  assert.equal((await svc.listTasks({ orderId: o.id })).rows.length, 1);
  await svc.setTaskDone(late.id, true, "Оля");
  assert.equal((await svc.listTasks()).counts.overdue, 0);
  assert.equal((await svc.listTasks({ done: true })).rows[0].doneBy, "Оля");
  await svc.setTaskDone(late.id, false, "Оля");
  assert.equal((await svc.listTasks()).counts.overdue, 1);
  const hist = await prisma.orderHistory.findMany({ where: { orderId: o.id, text: { startsWith: "Задача" } } });
  assert.equal(hist.length, 1);
});

test("гарантия: обращение по номеру заказа (клиент, телефон, товар), смена статуса и итога, сообщение без бота — «скопируйте»", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const o = await order();
  const bad = await svc.createServiceCase({ productName: "x", serial: "", problem: "y", phone: "", name: "", orderNo: "HM-99999", sku: "" }, "x");
  assert.equal(bad.ok, false);
  const r = await svc.createServiceCase({ productName: "Шуруповерт", serial: "SN123", problem: "не крутит", phone: "", name: "", orderNo: o.no, sku }, "Оля");
  assert.ok(r.ok);
  let c = await svc.getServiceCase(r.id);
  assert.equal(c?.phone, "+380935553300");
  assert.ok(c?.clientId && c.productId && c.orderId);
  assert.equal(c?.events.length, 1);
  const draft = svc.serviceDraft({ seq: r.seq, productName: "Шуруповерт" }, "READY", "uk");
  assert.match(draft, new RegExp(`С-${r.seq}.*Шуруповерт.*готовий`));
  const u = await svc.updateServiceCase(r.id, { status: "CLOSED", resolution: "replaced", note: "выдали новый", message: draft }, "Оля");
  assert.ok(u.ok);
  assert.equal(u.sent, "NO_CHANNEL");
  c = await svc.getServiceCase(r.id);
  assert.equal(c?.status, "CLOSED");
  assert.equal(c?.resolution, "replaced");
  assert.match(c!.events[1].text, /Статус: Выдан.*Итог: Заменён.*выдали новый/);
  assert.match(c!.events[2].text, /без бота/);
  assert.equal((await svc.listServiceCases({ open: true })).length, 0);
  assert.equal((await svc.listServiceCases({ q: "SN123" })).length, 1);
});
