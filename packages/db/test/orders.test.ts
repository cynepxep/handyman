// Заказы на отдельной базе handyman_test: цены только из базы, номер HM, свой склад, отмена, «купити в 1 клік», уведомление-заглушка.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let inStock: { id: string; sku: string; price: number };
let onOrder: { id: string; sku: string; price: number };

const form = (over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: "093 366 24 07", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items: [{ sku: inStock.sku, qty: 1 }], ...over,
});

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const pick = async (supplierAvailable: boolean) => {
    const p = await prisma.product.findFirstOrThrow({ where: { supplierAvailable, visible: true }, orderBy: { sku: "asc" } });
    return { id: p.id, sku: p.sku, price: p.price.toNumber() };
  };
  inStock = await pick(true);
  onOrder = await pick(false);
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

test("заказ: цены берутся из базы (подмена цены из браузера не проходит), номер HM растёт, предоплата 200", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r1 = await orders.placeOrder(form({ items: [{ sku: inStock.sku, qty: 2, price: 1 }] }), { lang: "uk" });
  assert.ok(r1.ok, JSON.stringify(r1));
  if (!r1.ok) return;
  const o = await prisma.order.findUniqueOrThrow({ where: { no: r1.no }, include: { items: true, client: true, history: true } });
  assert.equal(o.total.toNumber(), Math.round(inStock.price * 2 * 100) / 100);
  assert.equal(o.items[0].unitPrice.toNumber(), inStock.price);
  assert.equal(o.dueNow.toNumber(), Math.min(200, inStock.price * 2));
  assert.equal(o.payMode, "PREPAY");
  assert.equal(o.delivery, "NOVA_POSHTA");
  assert.equal(o.recipientPhone, "+380933662407");
  assert.equal(o.client.phone, "+380933662407");
  assert.equal(o.recipientName, "Петренко Іван");
  assert.match(o.no, /^HM-\d{4}$/);
  assert.ok(o.history.length === 1 && o.accessKey && o.accessKey.length >= 12);
  const r2 = await orders.placeOrder(form({ phone: "+380933662407" }), { lang: "ru" });
  assert.ok(r2.ok);
  if (r2.ok) assert.equal(Number(r2.no.slice(3)), Number(r1.no.slice(3)) + 1);
  assert.equal(await prisma.client.count({ where: { phone: "+380933662407" } }), 1, "тот же покупатель по телефону");
  const outbox = await prisma.outbox.findMany({ where: { orderId: o.id } });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].state, "DEV", "без токена бота — режим-заглушка, в Telegram ничего не уходит");
  assert.match(outbox[0].text, /Новый заказ HM-\d{4}/);
});

test("заказ: ошибки формы, пропавший товар, выключенный способ оплаты, сумма предоплаты из настроек", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const bad = await orders.placeOrder(form({ phone: "123", city: "" }), { lang: "uk" });
  assert.ok(!bad.ok && bad.errors.phone === "errPhone" && bad.errors.city === "err.city");
  const gone = await orders.placeOrder(form({ items: [{ sku: "НЕТ-ТАКОГО", qty: 1 }] }), { lang: "uk" });
  assert.ok(!gone.ok && gone.errors.items === "err.itemsGone");
  const s = await orders.loadCheckoutSettings();
  await orders.saveCheckoutSettings({ ...s, prepayAmount: 50, pay: { ...s.pay, card: false } }, "test");
  const card = await orders.placeOrder(form({ pay: "card" }), { lang: "uk" });
  assert.ok(!card.ok && card.errors.pay === "err.pay");
  const pre = await orders.placeOrder(form(), { lang: "uk" });
  assert.ok(pre.ok && pre.dueNow === Math.min(50, inStock.price));
  await orders.saveCheckoutSettings(s, "test");
});

test("«під замовлення»: отказаться от звонка нельзя (галочка снимается)", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeOrder(form({ items: [{ sku: onOrder.sku, qty: 1 }], noCallback: true }), { lang: "uk" });
  assert.ok(r.ok);
  if (r.ok) assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: r.no } })).noCallback, false);
  const ok = await orders.placeOrder(form({ noCallback: true }), { lang: "uk" });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: ok.no } })).noCallback, true);
});

test("свой склад: остаток задаётся, заказ списывает сколько есть, отмена возвращает один раз", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await orders.setOwnStock(inStock.id, 2, "test");
  const q = await orders.quoteCart([{ sku: inStock.sku, qty: 3 }]);
  assert.equal(q.lines[0].stock, "local");
  const r = await orders.placeOrder(form({ items: [{ sku: inStock.sku, qty: 3 }] }), { lang: "uk" });
  assert.ok(r.ok);
  if (!r.ok) return;
  const stock = () => orders.ownStockOf([inStock.id]).then((m) => m.get(inStock.id) ?? 0);
  assert.equal(await stock(), 0, "списано 2 из 3 (больше нет)");
  assert.equal((await orders.quoteCart([{ sku: inStock.sku, qty: 1 }])).lines[0].stock, "supplier");
  const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no } });
  assert.deepEqual(await orders.setOrderStatus(o.id, "CANCELLED", "test"), { ok: true });
  assert.equal(await stock(), 2, "отмена вернула на склад");
  await orders.setOrderStatus(o.id, "NEW", "test");
  await orders.setOrderStatus(o.id, "CANCELLED", "test");
  assert.equal(await stock(), 2, "повторная отмена не добавляет лишнего");
  const hist = await prisma.orderHistory.count({ where: { orderId: o.id } });
  assert.ok(hist >= 4);
  await orders.setOwnStock(inStock.id, 0, "test");
});

test("«Купити в 1 клік»: телефон обязателен, доставка и оплата — «уточнить»", async (t) => {
  if (!ready) return t.skip(skipMsg);
  assert.deepEqual(await orders.placeOneClick({ sku: inStock.sku, phone: "12" }, { lang: "uk" }), { ok: false, error: "errPhone" });
  const r = await orders.placeOneClick({ sku: inStock.sku, qty: 2, phone: "0501112233", name: "Олег" }, { lang: "uk", isTest: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no }, include: { items: true } });
  assert.deepEqual([o.payMode, o.delivery, o.source, o.isTest, o.dueNow.toNumber()], ["LATER", "TO_CONFIRM", "one_click", true, 0]);
  assert.equal(o.items[0].qty, 2);
  assert.match((await prisma.outbox.findFirstOrThrow({ where: { orderId: o.id } })).text, /ТЕСТ.*1 клик/);
});

test("страница «Дякуємо» открывается только с ключом из ссылки", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeOrder(form(), { lang: "uk" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(await orders.orderForThanks(r.no, "неверныйключ"), null);
  assert.equal(await orders.orderForThanks(r.no, ""), null);
  const ok = await orders.orderForThanks(r.no, r.accessKey);
  assert.ok(ok && ok.no === r.no && ok.total === r.total && !("recipientPhone" in ok));
});

test("заказы в админке: поиск по номеру и телефону, ТТН", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const all = await orders.listOrders();
  assert.ok(all.total >= 5);
  const byPhone = await orders.listOrders({ q: "0501112233" });
  assert.ok(byPhone.rows.length >= 1 && byPhone.rows.every((o) => o.recipientPhone === "+380501112233"));
  const first = all.rows[0];
  assert.equal((await orders.listOrders({ q: first.no })).rows[0]?.no, first.no);
  await orders.setOrderTtn(first.id, "2045 0000 1111 22", "test");
  assert.equal((await orders.getOrderDetail(first.id))?.ttn, "20450000111122");
});

test("Нова Пошта: отделение из справочника (заглушка вместо сети) — в заказ пишутся коды и точное название; чужой код не проходит", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const np = await import("../src/novaposhta");
  const CITY = "db5c88d0-391c-11dd-90d9-001a92567626";
  const POINT = "7b422fc4-e1b8-11e3-8c4a-0050568002cf";
  const calls: string[] = [];
  np.setNovaPoshtaFetch(async (_url, init) => {
    const body = JSON.parse(init.body) as { calledMethod: string; methodProperties: Record<string, string> };
    calls.push(body.calledMethod);
    const data = body.calledMethod === "searchSettlements"
      ? [{ Addresses: [{ Present: "м. Одеса, Одеська обл.", DeliveryCity: CITY, Warehouses: 2 }] }]
      : [
          { Ref: POINT, Number: "2", Description: "Відділення №2: вул. Базова, 16", DescriptionRu: "Отделение №2: ул. Базовая, 16", CategoryOfWarehouse: "Branch", WarehouseStatus: "Working" },
          { Ref: "11111111-1111-1111-1111-111111111111", Number: "25736", Description: "Поштомат №25736: вул. Богдана Хмельницького, 74", CategoryOfWarehouse: "Postomat" },
        ];
    return { json: async () => ({ success: true, data }) };
  });
  try {
    assert.deepEqual((await np.npCities("Оде"))?.map((c) => c.name), ["м. Одеса, Одеська обл."]);
    assert.equal((await np.npPoints(CITY, "warehouse", "2"))?.[0].ref, POINT);
    assert.equal((await np.npPoints(CITY, "postomat", "Богдана"))?.length, 1);
    assert.equal((await np.npPoints(CITY, "warehouse", "Богдана"))?.length, 0, "поштомат не попадает в список відділень");
    const r = await orders.placeOrder(form({ city: "м. Одеса, Одеська обл.", npPoint: "2", npCityRef: CITY, npPointRef: POINT }), { lang: "uk" });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no } });
    assert.equal(o.npPointRef, POINT);
    assert.equal(o.npCityRef, CITY);
    assert.equal(o.npWarehouseRef, "Відділення №2: вул. Базова, 16");
    assert.equal(calls.filter((c) => c === "getWarehouses").length, 1, "список отделений города — один запрос, дальше из кэша");
    const bad = await orders.placeOrder(form({ npCityRef: CITY, npPointRef: "22222222-2222-2222-2222-222222222222", npPoint: "12" }), { lang: "uk" });
    assert.ok(bad.ok);
    if (bad.ok) {
      const b = await prisma.order.findUniqueOrThrow({ where: { no: bad.no } });
      assert.equal(b.npPointRef, null, "неизвестный код — не сохраняем, остаётся то, что написал покупатель");
      assert.equal(b.npWarehouseRef, "12");
    }
    // НП не отвечает — поиск возвращает null, заказ всё равно оформляется
    np.setNovaPoshtaFetch(async () => { throw new Error("offline"); });
    assert.equal(await np.npCities("Київ"), null);
    const off = await orders.placeOrder(form({ npCityRef: CITY, npPointRef: POINT }), { lang: "uk" });
    assert.ok(off.ok);
  } finally {
    np.setNovaPoshtaFetch(null);
  }
});

test("самовывоз: одна точка выбирается сама, при нескольких — нужна выбранная; остатки по точкам складываются", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const wh = await import("../src/warehouses");
  const def = await orders.defaultWarehouseId();
  await prisma.warehouse.update({ where: { id: def }, data: { isPickup: true, cityUk: "Одеса", addressUk: "вул. Богданівська, 5" } });
  const r1 = await orders.placeOrder(form({ delivery: "pickup", items: [{ sku: onOrder.sku, qty: 1 }] }), { lang: "uk" });
  assert.ok(r1.ok, JSON.stringify(r1));
  if (r1.ok) {
    const o = await prisma.order.findUniqueOrThrow({ where: { no: r1.no } });
    assert.equal(o.pickupWarehouseId, def);
    assert.equal(o.address, "вул. Богданівська, 5");
  }
  const w2 = await prisma.warehouse.create({ data: { name: "Київ", isPickup: true, cityUk: "Київ", addressUk: "вул. Хрещатик, 1" } });
  const noChoice = await orders.placeOrder(form({ delivery: "pickup", items: [{ sku: onOrder.sku, qty: 1 }] }), { lang: "uk" });
  assert.ok(!noChoice.ok && noChoice.errors.pickup === "err.pickup");
  const r2 = await orders.placeOrder(form({ delivery: "pickup", pickupId: w2.id, items: [{ sku: onOrder.sku, qty: 1 }] }), { lang: "uk" });
  assert.ok(r2.ok);
  if (r2.ok) assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: r2.no } })).pickupWarehouseId, w2.id);
  assert.equal((await wh.pickupPoints("uk")).length, 2);

  // остатки: 1 шт. в Одессе + 2 шт. в Киеве = 3 → «в наличии у нас»
  await wh.setStockLevels(onOrder.id, [{ warehouseId: def, qty: 1 }, { warehouseId: w2.id, qty: 2 }], "test");
  assert.equal((await orders.ownStockOf([onOrder.id])).get(onOrder.id), 3);
  assert.deepEqual((await wh.stockByWarehouse(onOrder.id)).map((w) => w.onHand).sort(), [1, 2]);
  const del = await wh.deleteWarehouse(w2.id, "test");
  assert.ok(!del.ok, "точку с остатком не удалить");
  await wh.setStockLevels(onOrder.id, [{ warehouseId: def, qty: 0 }, { warehouseId: w2.id, qty: 0 }], "test");
  assert.ok(!(await wh.deleteWarehouse(def, "test")).ok, "основной склад не удалить");
  await prisma.warehouse.update({ where: { id: w2.id }, data: { isPickup: false } });
});
