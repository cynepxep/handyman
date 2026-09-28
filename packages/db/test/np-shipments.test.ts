// Нова Пошта (шаг 3.4) на базе handyman_test: тестовые ТТН без ключа и тестовые статусы → «Отправлен» / «Выполнен», сообщение «в отделении»,
// отказ → чёрный список → только полная оплата; бесплатная доставка от суммы; ТТН вручную; НП с подменённой сетью — отправитель, ТТН
// (контрагент + накладная с наложенным платежом), опрос статусов, сбой сети, удаление, печать; production без ключа.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

process.env.SECRETS_KEY = "test-secrets-key";
process.env.NOVAPOSHTA_KEY = "";
process.env.MONO_TOKEN = "";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let np: typeof import("../src/np-shipments");
let base: typeof import("../src/novaposhta");
let jobs: typeof import("../src/jobs");
let sku = "";
let productId = "";

const R = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const CITY = R(10); // Київ
const POINT = R(11); // Відділення №12
const ODESA = R(20);
const SENDER_WH = R(21);
let phoneSeq = 0;
const nextPhone = () => `093 366 ${String(10 + (++phoneSeq % 80)).padStart(2, "0")} 07`;
const form = (over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: nextPhone(), delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items: [{ sku, qty: 1 }], ...over,
});

// ---------- подменённая Нова Пошта ----------
type Call = { model: string; method: string; props: Record<string, unknown>; key: string };
const calls: Call[] = [];
let down = false;
/** ttn → код статуса, который отдаёт трекинг */
const tracking = new Map<string, { code: string; text: string }>();
let ttnSeq = 0;
const ok = (data: unknown[]) => ({ success: true, data, errors: [] });

function fakeNp(_url: string, init: { body: string }) {
  if (down) return Promise.reject(new Error("fetch failed"));
  const b = JSON.parse(init.body) as { apiKey: string; modelName: string; calledMethod: string; methodProperties: Record<string, unknown> };
  calls.push({ model: b.modelName, method: b.calledMethod, props: b.methodProperties, key: b.apiKey });
  const reply = (v: unknown) => Promise.resolve({ json: () => Promise.resolve(v) });
  switch (`${b.modelName}.${b.calledMethod}`) {
    case "Address.searchSettlements": {
      const q = String(b.methodProperties.CityName).toLowerCase();
      const all = [
        { Present: "м. Київ, Київська обл.", DeliveryCity: CITY, Warehouses: 900 },
        { Present: "м. Одеса, Одеська обл.", DeliveryCity: ODESA, Warehouses: 500 },
        { Present: "с. Одесське, Хмельницька обл.", DeliveryCity: R(22), Warehouses: 1 },
      ];
      return reply(ok([{ Addresses: all.filter((a) => a.Present.toLowerCase().includes(q)) }]));
    }
    case "Address.getWarehouses": {
      const city = b.methodProperties.CityRef;
      const list = city === CITY
        ? [{ Ref: POINT, Number: "12", Description: "Відділення №12: вул. Хрещатик, 1", CategoryOfWarehouse: "Branch" }]
        : city === ODESA ? [{ Ref: SENDER_WH, Number: "5", Description: "Відділення №5: вул. Дерибасівська, 5", CategoryOfWarehouse: "Branch" }] : [];
      return reply(ok(list));
    }
    case "Counterparty.getCounterparties":
      return reply(ok([{ Ref: R(30), Description: "ФОП Петренко Д. (тест)" }]));
    case "Counterparty.getCounterpartyContactPersons":
      return reply(ok([{ Ref: R(31), Description: "Петренко Дмитро", Phones: "380501112233" }, { Ref: R(32), Description: "Без телефона", Phones: "" }]));
    case "Counterparty.save":
      if (!/^[А-ЯІЇЄҐа-яіїєґ'’ -]+$/.test(String(b.methodProperties.FirstName))) return reply({ success: false, data: [], errors: ["FirstName is invalid"] });
      return reply(ok([{ Ref: R(40), ContactPerson: { success: true, data: [{ Ref: R(41) }] } }]));
    case "InternetDocument.save": {
      const ttn = `2045000000${String(++ttnSeq).padStart(4, "0")}`;
      tracking.set(ttn, { code: "1", text: "Відправник самостійно створив цю накладну" });
      return reply(ok([{ Ref: R(100 + ttnSeq), IntDocNumber: ttn, CostOnSite: 85, EstimatedDeliveryDate: "30.09.2026" }]));
    }
    case "InternetDocument.delete":
      return reply(ok([{ Ref: b.methodProperties.DocumentRefs }]));
    case "TrackingDocument.getStatusDocuments": {
      const docs = b.methodProperties.Documents as Array<{ DocumentNumber: string }>;
      return reply(ok(docs.filter((d) => tracking.has(d.DocumentNumber)).map((d) => ({ Number: d.DocumentNumber, StatusCode: tracking.get(d.DocumentNumber)!.code, Status: tracking.get(d.DocumentNumber)!.text }))));
    }
  }
  return reply({ success: false, data: [], errors: ["unknown method"] });
}

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  np = await import("../src/np-shipments");
  base = await import("../src/novaposhta");
  jobs = await import("../src/jobs");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const p = await prisma.product.findFirstOrThrow({ where: { supplierAvailable: true, visible: true, price: { gt: 500 } }, orderBy: { sku: "asc" } });
  sku = p.sku;
  productId = p.id;
  await prisma.productAttribute.deleteMany({ where: { productId, key: { startsWith: "Вага" } } });
  await prisma.productAttribute.create({ data: { productId, key: "Вага", value: "2,4 кг" } });
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret", "NpShipment", "Task"');
  base.setNovaPoshtaFetch(fakeNp);
  ready = true;
});

after(async () => {
  if (ready) {
    base.setNovaPoshtaFetch(null);
    await prisma.$disconnect();
  }
  process.env.NOVAPOSHTA_KEY = "";
  cleanup();
});

const place = async (over: Record<string, unknown> = {}) => {
  const r = await orders.placeOrder(form(over), { lang: "uk" });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) throw new Error("заказ не создан");
  return prisma.order.findUniqueOrThrow({ where: { no: r.no } });
};
const ttnForm = (over: Partial<import("@handyman/core/shop").TtnForm> = {}) => ({ weight: 2.7, seats: 1, dims: null, declared: 1000, payer: "Recipient" as const, cod: 500, description: "Болгарка", ...over });
const live = () => (process.env.NOVAPOSHTA_KEY = "np-test-key-123456");
const stub = () => (process.env.NOVAPOSHTA_KEY = "");

test("без ключа (не production): тестовая ТТН, тестовые статусы → «Отправлен», «в отделении», «Выполнен»", async (t) => {
  if (!ready) return t.skip(skipMsg);
  stub();
  assert.equal(await np.npMode(), "stub");
  const o = await place();
  assert.deepEqual(await np.orderWeight(o.id), { kg: 2.7, knownKg: 2.7, missing: [] }, "вес из характеристики «Вага» × 1,1");
  // у товара нет веса в характеристиках — вес не подставляется, менеджер вписывает сам
  const noWeight = await prisma.product.findFirstOrThrow({ where: { visible: true, supplierAvailable: true, id: { not: productId } } });
  await prisma.productAttribute.deleteMany({ where: { productId: noWeight.id, OR: [{ key: { startsWith: "Вага" } }, { key: { startsWith: "Маса" } }] } });
  const o2 = await place({ items: [{ sku, qty: 1 }, { sku: noWeight.sku, qty: 1 }] });
  const w2 = await np.orderWeight(o2.id);
  assert.equal(w2.kg, null);
  assert.equal(w2.knownKg, 2.7);
  assert.deepEqual(w2.missing, [noWeight.nameUk]);
  const r = await np.createTtn(o.id, ttnForm(), "Менеджер");
  assert.equal(r.stub, true);
  assert.match(r.ttn, /^99\d{12}$/);
  await assert.rejects(np.createTtn(o.id, ttnForm(), "Менеджер"), /уже есть ТТН/);
  assert.equal(calls.length, 0, "в НП ничего не уходило");
  const sh = await prisma.npShipment.findFirstOrThrow({ where: { orderId: o.id, active: true } });
  assert.equal(sh.nextCheckAt, null, "тестовую не опрашиваем");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).ttn, r.ttn);

  assert.equal(await np.stubTrack(sh.id, "transit"), true);
  let cur = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { history: true } });
  assert.equal(cur.status, "SHIPPED");
  assert.ok(cur.history.some((h) => /Нова Пошта: .*прямує.*тест/.test(h.text)));
  assert.ok(cur.history.some((h) => /Статус: Отправлен \(Нова Пошта\)/.test(h.text)));
  assert.equal(await np.stubTrack(sh.id, "transit"), false, "тот же статус второй раз — ничего");

  await np.stubTrack(sh.id, "arrived");
  const msg = await prisma.outbox.findFirstOrThrow({ where: { orderId: o.id, audience: "client", text: { contains: "у відділенні" } } });
  assert.match(msg.text, /Іван, ваше замовлення №HM-\d+ вже у відділенні Нової Пошти: 12\. ТТН 99\d+\. До сплати при отриманні: 500 ₴\./);
  assert.ok((await prisma.orderHistory.findFirst({ where: { orderId: o.id, text: { contains: "«посылка в отделении»" } } })) != null);

  await np.stubTrack(sh.id, "received");
  cur = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { history: true } });
  assert.equal(cur.status, "DONE");
  assert.ok(cur.doneAt);
  const done = await prisma.npShipment.findUniqueOrThrow({ where: { id: sh.id } });
  assert.equal(done.state, "received");
  assert.ok(done.arrivedAt && done.receivedAt);
});

test("удаление тестовой ТТН, ТТН вручную (проверка номера), автостатусы можно выключить", async (t) => {
  if (!ready) return t.skip(skipMsg);
  stub();
  const o = await place();
  await np.createTtn(o.id, ttnForm(), "М");
  const sh = await prisma.npShipment.findFirstOrThrow({ where: { orderId: o.id, active: true } });
  await np.deleteTtn(sh.id, "М");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).ttn, null);
  assert.equal((await prisma.npShipment.findUniqueOrThrow({ where: { id: sh.id } })).state, "deleted");
  assert.deepEqual(await np.setManualTtn(o.id, "12ab", "М"), { ok: false, error: "Номер ТТН — только цифры (обычно 14, например 20450000000000)." });
  assert.deepEqual(await np.setManualTtn(o.id, "2045 0000 1111 22", "М"), { ok: true });
  const m = await prisma.npShipment.findFirstOrThrow({ where: { orderId: o.id, active: true } });
  assert.deepEqual([m.ttn, m.manual, m.stub], ["20450000111122", true, true]);
  // выключили автостатусы — заказ не меняется
  const s = await np.loadNpSettings();
  await np.saveNpParcel({ ...s, autoStatuses: false }, "Владелец");
  await np.stubTrack(m.id, "transit");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status, "NEW");
  await np.saveNpParcel({ ...s, autoStatuses: true }, "Владелец");
  await np.setManualTtn(o.id, "", "М");
  assert.equal(await prisma.npShipment.count({ where: { orderId: o.id, active: true } }), 0);
});

test("отказ → счётчик, чёрный список, задача и тревога; дальше только полная оплата; снять вручную", async (t) => {
  if (!ready) return t.skip(skipMsg);
  stub();
  const phone = "067 111 22 33";
  const o = await place({ phone });
  await np.createTtn(o.id, ttnForm(), "М");
  const sh = await prisma.npShipment.findFirstOrThrow({ where: { orderId: o.id, active: true } });
  await np.stubTrack(sh.id, "transit");
  await np.stubTrack(sh.id, "refused");
  const c = await prisma.client.findUniqueOrThrow({ where: { phone: "+380671112233" } });
  assert.equal(c.npRefusals, 1);
  assert.equal(c.blacklisted, true);
  assert.match(c.blacklistNote ?? "", /отказов от посылок — 1/);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status, "SHIPPED", "статус заказа при отказе не меняем");
  assert.equal(await prisma.task.count({ where: { orderId: o.id, title: { contains: "Отказ от посылки" } } }), 1);
  assert.ok(await prisma.outbox.findFirst({ where: { orderId: o.id, audience: "manager", text: { contains: "чёрный список" } } }));
  assert.equal(await np.stubTrack(sh.id, "refused"), false, "повтор не считается второй раз");
  assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: c.id } })).npRefusals, 1);

  const bad = await orders.placeOrder(form({ phone }), { lang: "uk" });
  assert.deepEqual(bad, { ok: false, errors: { pay: "err.payBlacklist" } });
  const full = await orders.placeOrder(form({ phone, pay: "full" }), { lang: "uk" });
  assert.ok(full.ok, "полная оплата — можно");
  const oneClick = await orders.placeOneClick({ sku, phone }, { lang: "uk" });
  assert.ok(oneClick.ok);
  assert.ok(await prisma.outbox.findFirst({ where: { text: { contains: "в чёрном списке" }, order: { no: oneClick.ok ? oneClick.no : "" } } }));

  await np.setBlacklist(c.id, false, "", "Владелец");
  assert.ok((await orders.placeOrder(form({ phone }), { lang: "uk" })).ok);
  assert.ok(await prisma.clientAudit.findFirst({ where: { clientId: c.id, field: "Чёрный список", newValue: "нет" } }));
  assert.deepEqual((await np.blacklistedClients()).map((x) => x.id).includes(c.id), false);

  const rep = await np.refusalReport(new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000));
  assert.ok(rep.stats.refused >= 1);
  assert.ok(rep.refused.some((r) => r.orderId === o.id));
});

test("бесплатная доставка от суммы: отметка в заказе, ТТН за счёт магазина → доставка в прибыли", async (t) => {
  if (!ready) return t.skip(skipMsg);
  stub();
  const s = await orders.loadCheckoutSettings();
  await orders.saveCheckoutSettings({ ...s, npFreeFrom: 300 }, "Владелец");
  try {
    const o = await place();
    assert.equal(o.npFreeShipping, true);
    const cheap = await place({ delivery: "courier", address: "вул. Садова, 1" });
    assert.equal(cheap.npFreeShipping, false, "только для Новой Почты");
    const r = await np.createTtn(o.id, ttnForm({ payer: "Sender" }), "М");
    const after1 = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    assert.equal(after1.shopDeliveryCost.toNumber(), r.cost);
    const sh = await prisma.npShipment.findFirstOrThrow({ where: { orderId: o.id, active: true } });
    await np.deleteTtn(sh.id, "М");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).shopDeliveryCost.toNumber(), 0, "удалили ТТН — доставка магазина обнулена");
  } finally {
    await orders.saveCheckoutSettings({ ...s, npFreeFrom: 0 }, "Владелец");
  }
});

test("с ключом (сеть подменена): отправитель, ТТН, опрос статусов, сбой сети, удаление, печать", async (t) => {
  if (!ready) return t.skip(skipMsg);
  live();
  try {
    assert.equal(await np.npMode(), "live");
    calls.length = 0;
    // отправитель и отделение отправки
    const opts = await np.npSenderOptions();
    assert.ok(opts.ok && opts.senders[0].contacts.length === 2);
    assert.deepEqual(await np.saveNpSender(R(30), R(32), "Владелец"), { ok: false, error: "У контактного лица в кабинете НП нет мобильного телефона — добавьте его там и выберите снова." });
    assert.deepEqual(await np.saveNpSender(R(30), R(31), "Владелец"), { ok: true });
    const bad = await np.saveNpSenderPlace("Одес", "5", "Владелец");
    assert.ok(!bad.ok && /Уточните город/.test(bad.error));
    assert.deepEqual(await np.saveNpSenderPlace("Одеса", "5", "Владелец"), { ok: true });
    const s = await np.loadNpSettings();
    assert.deepEqual([s.senderRef, s.contactRef, s.senderPhone, s.cityRef, s.warehouseRef], [R(30), R(31), "+380501112233", ODESA, SENDER_WH]);

    // заказ без кода отделения → сначала указать отделение
    const typed = await place();
    await assert.rejects(np.createTtn(typed.id, ttnForm(), "М"), /не выбрано из справочника/);
    assert.deepEqual(await np.setOrderNpPoint(typed.id, "Київ", "12", "warehouse", "М"), { ok: true });
    // латиница в имени — понятная ошибка НП
    await prisma.order.update({ where: { id: typed.id }, data: { recipientName: "Petrenko Ivan" } });
    await assert.rejects(np.createTtn(typed.id, ttnForm(), "М"), /кириллицей/);

    const o = await place({ npCityRef: CITY, npPointRef: POINT });
    assert.equal(o.npPointRef, POINT);
    calls.length = 0;
    const r = await np.createTtn(o.id, ttnForm({ dims: { l: 40, w: 30, h: 20 } }), "Менеджер", new Date("2026-09-29T08:00:00Z"));
    assert.deepEqual([r.stub, r.cost], [false, 85]);
    assert.deepEqual(calls.map((c) => `${c.model}.${c.method}`), ["Counterparty.save", "InternetDocument.save"]);
    assert.equal(calls[0].key, "np-test-key-123456");
    assert.deepEqual([calls[0].props.LastName, calls[0].props.FirstName, calls[0].props.Phone], ["Петренко", "Іван", o.recipientPhone!.slice(1)]);
    const p = calls[1].props;
    assert.deepEqual([p.Sender, p.ContactSender, p.SenderAddress, p.CitySender, p.Recipient, p.ContactRecipient, p.RecipientAddress, p.CityRecipient], [R(30), R(31), SENDER_WH, ODESA, R(40), R(41), POINT, CITY]);
    assert.deepEqual(p.BackwardDeliveryData, [{ PayerType: "Recipient", CargoType: "Money", RedeliveryString: "500" }]);
    assert.equal(p.DateTime, "29.09.2026");
    assert.equal(p.InfoRegClientBarcodes, o.no);
    const sh = await prisma.npShipment.findFirstOrThrow({ where: { orderId: o.id, active: true } });
    assert.ok(sh.ref);
    assert.equal(sh.estDate?.toISOString(), "2026-09-30T09:00:00.000Z");
    assert.equal(sh.nextCheckAt?.toISOString(), "2026-09-29T10:00:00.000Z");
    const url = await np.npPrintTarget(sh.id, "label");
    assert.equal(url, `https://my.novaposhta.ua/orders/printMarking100x100/orders[]/${sh.ref}/type/pdf/apiKey/np-test-key-123456`);

    // опрос: пока не пора — не спрашиваем; сдали в НП → «Отправлен»; прибыла; получена → «Выполнен»
    calls.length = 0;
    await np.trackShipments(new Date("2026-09-29T09:00:00Z"));
    assert.equal(calls.filter((c) => c.model === "TrackingDocument").length, 0);
    tracking.set(sh.ttn, { code: "5", text: "Відправлення прямує до міста Київ" });
    const rep = await jobs.runJobs(new Date("2026-09-29T10:01:00Z"));
    assert.equal(rep.np, 1);
    const trackCall = calls.find((c) => c.model === "TrackingDocument")!;
    assert.deepEqual((trackCall.props.Documents as Array<Record<string, string>>).find((d) => d.DocumentNumber === sh.ttn), { DocumentNumber: sh.ttn, Phone: o.recipientPhone!.slice(1) });
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status, "SHIPPED");
    await assert.rejects(np.deleteTtn(sh.id, "М"), /уже передали/);

    // сбой сети — попробуем через 30 минут
    down = true;
    await np.trackShipments(new Date("2026-09-29T11:05:00Z"));
    down = false;
    assert.equal((await prisma.npShipment.findUniqueOrThrow({ where: { id: sh.id } })).nextCheckAt?.toISOString(), "2026-09-29T11:35:00.000Z");

    tracking.set(sh.ttn, { code: "7", text: "Прибув на відділення" });
    await np.trackShipments(new Date("2026-09-29T11:40:00Z"));
    assert.equal((await prisma.npShipment.findUniqueOrThrow({ where: { id: sh.id } })).state, "arrived");
    // лежит 3 дня — одна тревога
    await np.trackShipments(new Date("2026-10-03T12:00:00Z"));
    await np.trackShipments(new Date("2026-10-03T12:05:00Z"));
    assert.equal(await prisma.outbox.count({ where: { orderId: o.id, audience: "manager", text: { contains: "лежит в отделении" } } }), 1);
    tracking.set(sh.ttn, { code: "9", text: "Відправлення отримано" });
    assert.match(await np.refreshShipment(sh.id), /отримано/);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status, "DONE");
    assert.equal((await prisma.npShipment.findUniqueOrThrow({ where: { id: sh.id } })).nextCheckAt, null, "получена — больше не спрашиваем");

    // удаление созданной (ещё не сданной) ТТН — запросом в НП
    const o2 = await place({ npCityRef: CITY, npPointRef: POINT });
    await np.createTtn(o2.id, ttnForm(), "М");
    const sh2 = await prisma.npShipment.findFirstOrThrow({ where: { orderId: o2.id, active: true } });
    calls.length = 0;
    await np.deleteTtn(sh2.id, "М");
    assert.deepEqual(calls.map((c) => `${c.method}:${c.props.DocumentRefs}`), [`delete:${sh2.ref}`]);

  } finally {
    stub();
  }
});

test("production без ключа: ТТН только вручную", async (t) => {
  if (!ready) return t.skip(skipMsg);
  stub();
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(await np.npMode(), "off");
    const o = await place();
    await assert.rejects(np.createTtn(o.id, ttnForm(), "М"), /не подключена/);
    assert.deepEqual(await np.setManualTtn(o.id, "20450000009999", "М"), { ok: true });
    const sh = await prisma.npShipment.findFirstOrThrow({ where: { orderId: o.id, active: true } });
    assert.equal(sh.nextCheckAt, null);
    assert.equal(await np.npPrintTarget(sh.id, "label"), null);
  } finally {
    process.env.NODE_ENV = env;
  }
});
