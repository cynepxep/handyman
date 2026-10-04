// Запуск, шаг Л2 — сверка цен и остатков на базе handyman_test: одна и та же цена товара в поиске, корзине, оформлении, заказе,
// счёте mono, кассовом чеке и KeyCRM (опт от количества + личная скидка + скидка за полную оплату); наличие строки корзины от количества;
// «последний на складе: двое одновременно»; заказ по звонку и «1 клік» — со скидкой покупателя. Сеть mono и KeyCRM подменена.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";
import { availableQty, computeTotals, sitePayTarget } from "@handyman/core/shop";

process.env.SECRETS_KEY = "test-secrets-key";
process.env.MONO_TOKEN = "";
process.env.PUBLIC_URL = "";
process.env.KEYCRM_API_KEY = "";
process.env.KEYCRM_SOURCE_ID = "";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let stock: typeof import("../src/stock");
let pay: typeof import("../src/payments");
let kc: typeof import("../src/keycrm");
let search: typeof import("../src/catalog-search");
let plus: typeof import("../src/storefront-plus");
/** товар с оптом «от 3 шт. — 90 %» */
let A: { id: string; sku: string; price: number };
/** товары для склада */
let B: { id: string; sku: string };
let C: { id: string; sku: string };
let buyerId = "";
const BUYER_PHONE = "+380671230011";
const ORIGIN = "http://localhost:3100";
const r2 = (n: number) => Math.round(n * 100) / 100;
const kop = (n: number) => Math.round(n * 100);

const form = (items: Array<{ sku: string; qty: number }>, over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: "093 366 24 07", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items, ...over,
});

// ---------- подменённые mono и KeyCRM: запоминаем, что ушло ----------
const reply = (status: number, body: unknown) => Promise.resolve({ status, json: () => Promise.resolve(body) });
const monoBodies: Array<Record<string, unknown>> = [];
function fakeMono(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
  const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  if (url.endsWith("/api/merchant/invoice/create")) {
    monoBodies.push(body!);
    return reply(200, { invoiceId: `inv-l2-${monoBodies.length}`, pageUrl: `https://pay.mbnk.biz/inv-l2-${monoBodies.length}` });
  }
  return reply(404, null);
}
const crmBodies: Array<Record<string, unknown>> = [];
function fakeKeycrm(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
  const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  if (init.method === "POST" && new URL(url).pathname.endsWith("/order")) {
    crmBodies.push(body!);
    return reply(201, { id: 7000 + crmBodies.length, source_uuid: String(body!.source_uuid), source_id: 5, status_id: 1 });
  }
  return reply(404, null);
}

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  stock = await import("../src/stock");
  pay = await import("../src/payments");
  kc = await import("../src/keycrm");
  search = await import("../src/catalog-search");
  plus = await import("../src/storefront-plus");
  await prisma.stockDoc.deleteMany();
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret", "WebhookLog", "PriceBreak", "ProductPackaging"');
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const list = await prisma.product.findMany({ where: { visible: true, supplierAvailable: true, price: { gt: 150 } }, orderBy: { sku: "asc" }, take: 3 });
  A = { id: list[0].id, sku: list[0].sku, price: list[0].price.toNumber() };
  B = { id: list[1].id, sku: list[1].sku };
  C = { id: list[2].id, sku: list[2].sku };
  await plus.addPriceBreak(A.id, { minQty: 3, price: r2(A.price * 0.9), tier: "" }, "test");
  // покупатель с личной скидкой 3 % (вошёл в кабинет); скидка за полную оплату — 5 %
  buyerId = (await prisma.client.create({ data: { phone: BUYER_PHONE, name: "Оптовий Покупець", manualDiscountPct: 3 } })).id;
  await orders.saveCheckoutSettings({ ...(await orders.loadCheckoutSettings()), fullPayDiscountPct: 5, pay: { prepay: true, full: true, card: true }, onlinePay: true }, "test");
  await search.reindexAll(); // тестовый индекс products_test с настройками
  pay.setPaymentsFetch(fakeMono);
  kc.setKeycrmFetch(fakeKeycrm);
  ready = true;
});

after(async () => {
  if (ready) {
    pay.setPaymentsFetch(null);
    kc.setKeycrmFetch(null);
    await prisma.$disconnect();
  }
  process.env.MONO_TOKEN = "";
  process.env.KEYCRM_API_KEY = "";
  process.env.KEYCRM_SOURCE_ID = "";
  cleanup();
});

test("одна цена везде: поиск → корзина → оформление → заказ → счёт mono → чек → KeyCRM (опт + личная скидка + полная оплата)", async (t) => {
  if (!ready) return t.skip(skipMsg);
  // поиск (списки, карточки, подсказки) — та же цена, что в базе и в корзине
  await search.reindexProducts([A.id]);
  const hit = (await search.searchProducts({ q: A.sku })).items.find((i) => i.sku === A.sku);
  assert.ok(hit, "товар найден поиском");
  const q1 = await orders.quoteCart([{ sku: A.sku, qty: 1 }], { clientId: buyerId });
  assert.equal(hit!.price, A.price);
  assert.equal(q1.lines[0].price, A.price);
  assert.equal(hit!.stock, q1.lines[0].stock);

  // 4 шт. — цена от количества; оформление с полной оплатой: 5 % + личные 3 % = 8 %
  const items = [{ sku: A.sku, qty: 4 }];
  const q4 = await orders.quoteCart(items, { clientId: buyerId });
  assert.equal(q4.lines[0].price, r2(A.price * 0.9));
  assert.equal(await orders.clientDiscountFor(buyerId), 3);
  const settings = await orders.loadCheckoutSettings();
  const shown = computeTotals(q4.lines, "full", settings, await orders.clientDiscountFor(buyerId)); // как checkoutQuoteAction
  assert.equal(shown.discountPct, 8);

  const r = await orders.placeOrder(form(items, { pay: "full" }), { lang: "uk", clientId: buyerId });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no }, include: { items: true } });
  assert.equal(o.total.toNumber(), shown.total, "заказ = сумма в оформлении");
  assert.equal(o.dueNow.toNumber(), shown.total, "полная оплата — вся сумма сейчас");
  assert.equal(o.items[0].unitPrice.toNumber(), shown.unitPrices[0]);
  assert.equal(o.items[0].unitPrice.toNumber(), r2(r2(A.price * 0.9) * 0.92));
  assert.equal(kop(o.total.toNumber()), o.items.reduce((a, i) => a + kop(i.unitPrice.toNumber()) * i.qty, 0), "сумма = строки до копейки");

  // счёт mono: сумма = sitePayTarget = заказ, корзина построчно с ценой строки заказа
  process.env.MONO_TOKEN = "test-mono-token-1234";
  const target = sitePayTarget({ payMode: o.payMode, status: o.status, total: o.total.toNumber(), dueNow: o.dueNow.toNumber(), paidAmount: 0 });
  assert.deepEqual(target, { kind: "full", amount: o.total.toNumber() });
  const inv = await pay.payFromSite(o.no, o.accessKey!, ORIGIN);
  assert.ok(inv.ok && !inv.stub, JSON.stringify(inv));
  const mb = monoBodies.at(-1)!;
  const basket = (mb.merchantPaymInfo as { basketOrder: Array<{ qty: number; sum: number; code: string }> }).basketOrder;
  assert.equal(mb.amount, kop(o.total.toNumber()));
  assert.deepEqual(basket.map((b) => [b.code, b.qty, b.sum]), o.items.map((i) => [i.sku, i.qty, kop(i.unitPrice.toNumber())]));

  // оплачено → кассовый чек (Checkbox без ключей — тестовый): построчно, те же цены, сумма = оплате
  const invoice = await prisma.payInvoice.findFirstOrThrow({ where: { orderId: o.id } });
  await pay.applyInvoiceState({
    invoiceId: invoice.id, status: "success", amount: invoice.amount.toNumber(), finalAmount: invoice.amount.toNumber(), modifiedAt: new Date(),
    failureReason: null, reference: o.no, refunded: 0, refundPending: false,
  }, "test");
  process.env.MONO_TOKEN = "";
  const paid = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
  assert.equal(paid.paidAmount.toNumber(), o.total.toNumber());
  const receipt = await prisma.fiscalReceipt.findFirstOrThrow({ where: { orderId: o.id, kind: "sell" } });
  const goods = receipt.goods as unknown as Array<{ code: string; price: number; qty: number }>;
  assert.equal(receipt.amount.toNumber(), o.total.toNumber());
  assert.deepEqual(goods.map((g) => [g.code, g.qty, g.price]), o.items.map((i) => [i.sku, i.qty, i.unitPrice.toNumber()]));

  // KeyCRM: те же цены строк; сумма строк = сумме заказа
  process.env.KEYCRM_API_KEY = "test-keycrm-key-1234";
  process.env.KEYCRM_SOURCE_ID = "5";
  try {
    const sent = await kc.sendOrderToKeycrm(o.id, "test");
    assert.ok(sent.ok, JSON.stringify(sent));
  } finally {
    process.env.KEYCRM_API_KEY = "";
    process.env.KEYCRM_SOURCE_ID = "";
  }
  const products = crmBodies.at(-1)!.products as Array<{ sku: string; quantity: number; price: number }>;
  assert.deepEqual(products.map((p) => [p.sku, p.quantity, p.price]), o.items.map((i) => [i.sku, i.qty, i.unitPrice.toNumber()]));
  assert.equal(kop(products.reduce((a, p) => a + p.price * p.quantity, 0)), kop(o.total.toNumber()));
  assert.match(String(crmBodies.at(-1)!.manager_comment), /Скидка 8% .*уже учтена/);
});

test("наличие от количества: «в Одессе» — только если хватает; не хватает — у поставщика/під замовлення, резерв частичный, менеджеру — сколько со склада", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await orders.setOwnStock(B.id, 2, "test");
  const level = async (qty: number) => (await orders.quoteCart([{ sku: B.sku, qty }])).lines[0].stock;
  assert.equal(await level(2), "local");
  assert.equal(await level(3), "supplier");
  await prisma.product.update({ where: { id: B.id }, data: { supplierAvailable: false } });
  assert.equal(await level(3), "order", "остального нет нигде — уточнить звонком");
  // «не телефонуйте» при «під замовлення» снимается (validateCheckout); менеджеру — сколько со склада, остальное под заказ
  let since = new Date();
  const ord = await orders.placeOrder(form([{ sku: B.sku, qty: 3 }], { noCallback: true }), { lang: "uk" });
  assert.ok(ord.ok);
  if (!ord.ok) return;
  const o1 = await prisma.order.findUniqueOrThrow({ where: { no: ord.no } });
  assert.equal(o1.noCallback, false);
  const msg1 = (await prisma.outbox.findMany({ where: { audience: "manager", createdAt: { gte: since } } })).map((m) => m.text).join("\n");
  assert.match(msg1, /со склада 2 из 3, остальное ПОД ЗАКАЗ/);
  await orders.setOrderStatus(o1.id, "CANCELLED", "test", undefined, "test");
  await prisma.product.update({ where: { id: B.id }, data: { supplierAvailable: true } });

  since = new Date();
  const r = await orders.placeOrder(form([{ sku: B.sku, qty: 3 }]), { lang: "uk" });
  assert.ok(r.ok);
  if (!r.ok) return;
  const items = await prisma.stockItem.findMany({ where: { productId: B.id } });
  assert.equal(items.reduce((s, i) => s + i.reserved, 0), 2, "отложили всё, что было");
  assert.equal(availableQty(items), 0);
  const msg = (await prisma.outbox.findMany({ where: { audience: "manager", createdAt: { gte: since } }, orderBy: { createdAt: "asc" } })).map((m) => m.text).join("\n");
  assert.match(msg, /со склада 2 из 3, остальное у поставщика/);
  // в списках и поиске товар больше не «в Одессе»
  await search.reindexProducts([B.id]);
  const hit = (await search.searchProducts({ q: B.sku })).items.find((i) => i.sku === B.sku);
  assert.equal(hit?.stock, "supplier");
  assert.equal(await level(1), "supplier");
  const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no } });
  await orders.setOrderStatus(o.id, "CANCELLED", "test", undefined, "test");
  assert.equal(await level(2), "local", "отмена вернула товар покупателям");
});

test("последний на складе: двое одновременно — резерв у одного, второму не обещаем «со склада», остаток не уходит в минус", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await orders.setOwnStock(C.id, 1, "test");
  const since = new Date();
  const [a, b] = await Promise.all([
    orders.placeOrder(form([{ sku: C.sku, qty: 1 }], { phone: "093 111 11 01" }), { lang: "uk" }),
    orders.placeOrder(form([{ sku: C.sku, qty: 1 }], { phone: "093 111 11 02" }), { lang: "uk" }),
  ]);
  assert.ok(a.ok && b.ok, "оба заказа приняты");
  if (!a.ok || !b.ok) return;
  const cells = await prisma.stockItem.findMany({ where: { productId: C.id } });
  assert.deepEqual([cells.reduce((s, i) => s + i.onHand, 0), cells.reduce((s, i) => s + i.reserved, 0)], [1, 1]);
  const both = await prisma.order.findMany({ where: { no: { in: [a.no, b.no] } }, include: { history: true } });
  const reserved = await Promise.all(both.map(async (o) => (await stock.orderReservations(o.id)).get(C.id)?.reserved ?? 0));
  assert.deepEqual([...reserved].sort(), [0, 1], "резерв — только у одного заказа");
  const loser = both[reserved.indexOf(0)];
  const msgs = (await prisma.outbox.findMany({ where: { audience: "manager", createdAt: { gte: since } }, orderBy: { createdAt: "asc" } })).map((m) => m.text);
  assert.equal(msgs.filter((m) => m.includes("— со склада")).length, 1, "«со склада» — только у получившего товар");
  const loserMsg = msgs.find((m) => m.includes(loser.no))!;
  assert.doesNotMatch(loserMsg, /— со склада/);
  // если оба успели увидеть «в Одессе» — второму в историю и менеджеру пометка «не хватило»
  const raced = loser.history.some((h) => h.text.includes("На складе не хватило"));
  t.diagnostic(raced ? "оба увидели «в Одессе» — второму пометка «не хватило»" : "второй уже видел «у поставщика»");
  if (raced) assert.match(loserMsg, /не хватило.*отложено 0 из 1, остальное у поставщика/);
  for (const o of both) await orders.setOrderStatus(o.id, "CANCELLED", "test", undefined, "test");
  assert.equal(availableQty(await prisma.stockItem.findMany({ where: { productId: C.id } })), 1);
});

test("последний на складе: резерв проверяет остаток в момент записи — второй одновременный резерв не проходит (без гонки)", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await orders.setOwnStock(C.id, 1, "test");
  // два «заказа» без своего товара — нужны только их номера для журнала движения
  const ids: string[] = [];
  for (const phone of ["+380931110003", "+380931110004"]) {
    const m = await orders.placeManualOrder({ phone, name: "Т", items: [{ sku: A.sku, qty: 1 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: true }, "test");
    assert.ok(m.ok);
    if (m.ok) ids.push(m.id);
  }
  let firstReserved!: () => void;
  const reservedSignal = new Promise<void>((res) => (firstReserved = res));
  // первый резервирует и держит транзакцию открытой; второй начинает, пока первый не записал, — его UPDATE ждёт и проверяет заново
  const first = prisma.$transaction(async (tx) => {
    const r = await stock.reserveForOrder(tx, ids[0], [{ productId: C.id, qty: 1 }]);
    firstReserved();
    await new Promise((res) => setTimeout(res, 300));
    return r.took.get(C.id) ?? 0;
  });
  await reservedSignal;
  const second = prisma.$transaction((tx) => stock.reserveForOrder(tx, ids[1], [{ productId: C.id, qty: 1 }]).then((r) => r.took.get(C.id) ?? 0));
  assert.deepEqual(await Promise.all([first, second]), [1, 0]);
  const cells = await prisma.stockItem.findMany({ where: { productId: C.id } });
  assert.deepEqual([cells.reduce((s, i) => s + i.onHand, 0), cells.reduce((s, i) => s + i.reserved, 0)], [1, 1]);
  for (const id of ids) await orders.setOrderStatus(id, "CANCELLED", "test", undefined, "test");
  assert.equal(availableQty(await prisma.stockItem.findMany({ where: { productId: C.id } })), 1);
});

test("заказ по звонку: скидка покупателя находится по телефону (как опт его уровня); незнакомый телефон — без скидки", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const base = { name: "Т", items: [{ sku: A.sku, qty: 1 }], delivery: "to_confirm" as const, pay: "prepay" as const, city: "", npPoint: "", address: "", comment: "", isTest: true };
  const known = await orders.placeManualOrder({ ...base, phone: BUYER_PHONE }, "test");
  const stranger = await orders.placeManualOrder({ ...base, phone: "+380931110099" }, "test");
  assert.ok(known.ok && stranger.ok);
  if (!known.ok || !stranger.ok) return;
  const [k, s] = await Promise.all([known.id, stranger.id].map((id) => prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } })));
  assert.equal(k.discountPct, 3);
  assert.equal(k.items[0].unitPrice.toNumber(), r2(A.price * 0.97));
  assert.equal(k.clientId, buyerId);
  assert.equal(s.discountPct, 0);
  assert.equal(s.total.toNumber(), A.price);
});

test("«1 клік»: менеджеру — сумма заказа со скидкой вошедшего покупателя (как в карточке заказа и KeyCRM)", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeOneClick({ sku: A.sku, qty: 1, phone: "093 222 33 44" }, { lang: "uk", clientId: buyerId });
  assert.ok(r.ok);
  if (!r.ok) return;
  const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no } });
  assert.equal(o.total.toNumber(), r2(A.price * 0.97));
  const msg = await prisma.outbox.findFirstOrThrow({ where: { audience: "manager", orderId: o.id } });
  const money = `${o.total.toNumber().toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;
  assert.ok(msg.text.includes(`= ${money} (скидка 3%)`), msg.text);
});

test("сводка менеджеру «Хиты закончились»: считается по свободному остатку (весь товар в резерве = нет у нас), как видит покупатель", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const jobs = await import("../src/jobs");
  await prisma.product.update({ where: { id: C.id }, data: { isHit: true, supplierAvailable: false } });
  await orders.setOwnStock(C.id, 1, "test");
  const name = (await prisma.product.findUniqueOrThrow({ where: { id: C.id } })).nameUk;
  const out = async () => (await jobs.dailySummaryText(await jobs.loadNotify())).includes(name);
  assert.equal(await out(), false, "1 шт. свободна — не закончился");
  const m = await orders.placeManualOrder({ phone: "+380931110005", name: "Т", items: [{ sku: C.sku, qty: 1 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: true }, "test");
  assert.ok(m.ok);
  assert.equal(await out(), true, "лежит на полке, но отложен под заказ — для покупателей его нет");
  if (m.ok) await orders.setOrderStatus(m.id, "CANCELLED", "test", undefined, "test");
  await prisma.product.update({ where: { id: C.id }, data: { isHit: false, supplierAvailable: true } });
});

test("поиск: индекс без ключа (создан сам до первой пересборки) чинится, товары снова ложатся в индекс — списки показывают цену и наличие", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const host = (process.env.MEILI_HOST ?? "http://localhost:7700").replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MEILI_MASTER_KEY ?? ""}` };
  const uid = process.env.MEILI_INDEX_PRODUCTS!;
  const wait = async (taskUid: number) => {
    for (let i = 0; i < 200; i++) {
      const s = (await (await fetch(`${host}/tasks/${taskUid}`, { headers })).json()) as { status: string };
      if (s.status === "succeeded" || s.status === "failed") return s.status;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("задача поиска не закончилась");
  };
  const call = async (method: string, path: string, body?: unknown) =>
    wait(((await (await fetch(`${host}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })).json()) as { taskUid: number }).taskUid);
  await call("DELETE", `/indexes/${uid}`);
  // нет индекса — товар обновили (заказ, правка): индекс создаётся сразу с ключом id
  await search.reindexProducts([A.id]);
  const info = async () => (await (await fetch(`${host}/indexes/${uid}`, { headers })).json()) as { primaryKey: string | null };
  assert.equal((await info()).primaryKey, "id");
  // индекс без ключа (так было до шага Л2) — ensureIndex/пересборка ставит ключ
  await call("DELETE", `/indexes/${uid}`);
  assert.equal(await call("POST", "/indexes", { uid }), "succeeded");
  assert.equal((await info()).primaryKey, null);
  await search.reindexAll();
  assert.equal((await info()).primaryKey, "id");
  assert.equal((await search.searchProducts({ q: A.sku })).items[0]?.price, A.price);
});
