// Клиенты на базе handyman_test: сумма покупок и уровень по выполненным заказам (тестовые не считаются), правки с журналом, поиск.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let clients: typeof import("../src/clients");
let sku = "";
let price = 0;

const form = (phone: string, qty = 1) => ({
  firstName: "Іван", lastName: "Петренко", phone, delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay", items: [{ sku, qty }],
});

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  clients = await import("../src/clients");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const p = await prisma.product.findFirstOrThrow({ where: { supplierAvailable: true, visible: true }, orderBy: { price: "desc" } });
  sku = p.sku;
  price = p.price.toNumber();
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const idOf = async (no: string) => (await prisma.order.findUniqueOrThrow({ where: { no } })).id;

test("сумма покупок: растёт только от выполненных нетестовых заказов, откат статуса уменьшает; уровень по настройкам", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await clients.saveLoyalty({ enabled: true, levels: [{ key: "MASTER", min: 1, pct: 3 }, { key: "PRO", min: price * 2 + 1, pct: 5 }] }, "test");
  const a = await orders.placeOrder(form("0931112233"), { lang: "uk" });
  const b = await orders.placeOrder(form("0931112233"), { lang: "uk" });
  const test1 = await orders.placeOrder(form("0931112233"), { lang: "uk", isTest: true });
  assert.ok(a.ok && b.ok && test1.ok);
  const client = await prisma.client.findUniqueOrThrow({ where: { phone: "+380931112233" } });
  assert.equal(client.spent.toNumber(), 0);

  await orders.setOrderStatus(await idOf(a.no), "DONE", "test");
  await orders.setOrderStatus(await idOf(test1.no), "DONE", "test"); // тестовый — не считается
  let c = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
  assert.equal(c.spent.toNumber(), a.total);
  assert.equal(c.tier, "MASTER");

  await orders.setOrderStatus(await idOf(b.no), "DONE", "test");
  c = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
  assert.equal(c.spent.toNumber(), Math.round((a.total + b.total) * 100) / 100);

  await orders.setOrderStatus(await idOf(b.no), "RETURNED", "test"); // возврат — сумма уменьшилась
  c = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
  assert.equal(c.spent.toNumber(), a.total);

  // смена порогов пересчитывает уровни всех клиентов
  await clients.saveLoyalty({ enabled: true, levels: [{ key: "MASTER", min: a.total + 1, pct: 3 }] }, "test");
  assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).tier, "START");

  const d = await clients.getClientDetail(client.id);
  assert.ok(d);
  assert.equal(d.stats.orders, 2); // тестовый не в счёт
  assert.equal(d.stats.done, 1);
  assert.equal(d.stats.cancelled, 1);
  assert.ok(d.progress && d.progress.next === "MASTER" && d.progress.left === 1);
});

test("правка клиента: изменения в журнале, телефон нельзя занять чужой или удалить, «Опт» включается и снимается", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r1 = await orders.placeOrder(form("0935550001"), { lang: "uk" });
  const r2 = await orders.placeOrder(form("0935550002"), { lang: "uk" });
  assert.ok(r1.ok && r2.ok);
  const c1 = await prisma.client.findUniqueOrThrow({ where: { phone: "+380935550001" } });
  const base = { name: "Петренко Іван", phone: "+380935550001", email: "", lang: "UK" as const, note: "", manualDiscountPct: null, wholesale: false };

  const busy = await clients.updateClient(c1.id, { ...base, phone: "+380935550002" }, "test");
  assert.equal(busy.ok, false);
  const noPhone = await clients.updateClient(c1.id, { ...base, phone: "" }, "test");
  assert.equal(noPhone.ok, false);

  const ok = await clients.updateClient(c1.id, { ...base, note: "бригада, звонить после 17", manualDiscountPct: 5, wholesale: true, lang: "RU" }, "Менеджер");
  assert.deepEqual(ok, { ok: true, changed: 4 });
  let c = await prisma.client.findUniqueOrThrow({ where: { id: c1.id }, include: { auditEntries: true } });
  assert.equal(c.tier, "WHOLESALE");
  assert.equal(c.manualDiscountPct, 5);
  assert.deepEqual(c.auditEntries.map((e) => e.field).sort(), ["Заметка", "Личная скидка", "Уровень", "Язык"]);
  assert.ok(c.auditEntries.every((e) => e.who === "Менеджер"));
  assert.equal(c.auditEntries.find((e) => e.field === "Уровень")?.newValue, "Опт");

  assert.deepEqual(await clients.updateClient(c1.id, { ...base, note: "бригада, звонить после 17", manualDiscountPct: 5, wholesale: true, lang: "RU" }, "x"), { ok: true, changed: 0 });
  await clients.updateClient(c1.id, { ...base, note: "бригада, звонить после 17", manualDiscountPct: 5, lang: "RU" }, "test");
  c = await prisma.client.findUniqueOrThrow({ where: { id: c1.id }, include: { auditEntries: true } });
  assert.notEqual(c.tier, "WHOLESALE"); // «Опт» снят — уровень снова по сумме
});

test("список клиентов: поиск по части номера и имени, сортировка по сумме", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const byDigits = await clients.listClients({ q: "555000" });
  assert.equal(byDigits.total, 2);
  const byPhone = await clients.listClients({ q: "093 555 00 02" });
  assert.equal(byPhone.total, 1);
  assert.equal(byPhone.rows[0].phone, "+380935550002");
  const byName = await clients.listClients({ q: "петренко" });
  assert.ok(byName.total >= 3);
  const bySpent = await clients.listClients({ sort: "spent" });
  assert.equal(bySpent.rows[0].phone, "+380931112233");
  assert.equal(bySpent.rows[0]._count.orders, 3);
});
