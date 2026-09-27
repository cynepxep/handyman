// Кассовые чеки Checkbox (шаг 3.3) на базе handyman_test: тестовые чеки без ключей, чек продажи после оплаты mono (сеть Checkbox подменена):
// вход кассира, открытие смены, построчный чек, ссылка покупателю; чек возврата; повторы после сбоя и тревога; «Повторить»;
// одновременная отправка; истёкший вход; закрытие смены в 23:00; production без ключей.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

process.env.SECRETS_KEY = "test-secrets-key";
process.env.MONO_TOKEN = "";
process.env.PUBLIC_URL = "";
const CB_ENV = ["CHECKBOX_LICENSE_KEY", "CHECKBOX_LOGIN", "CHECKBOX_PASSWORD"] as const;
const checkboxOn = () => Object.assign(process.env, { CHECKBOX_LICENSE_KEY: "lic-1234567890", CHECKBOX_LOGIN: "cashier", CHECKBOX_PASSWORD: "secret-pass" });
const checkboxOff = () => CB_ENV.forEach((k) => (process.env[k] = ""));
checkboxOff();

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let pay: typeof import("../src/payments");
let rc: typeof import("../src/receipts");
let jobs: typeof import("../src/jobs");
let sku = "";
let price = 0;

const form = (over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: "093 366 24 07", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "full",
  items: [{ sku, qty: 3 }], ...over,
});

// ---------- подменённый Checkbox ----------
type Call = { path: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };
const calls: Call[] = [];
let token = "tok-1";
let shift: { id: string; status: string } | null = null;
const store = new Map<string, Record<string, unknown>>();
const fail = { sell: 0, network: 0, error: false };
let fiscalNo = 1;
const reply = (status: number, body: unknown) => Promise.resolve({ status, json: () => Promise.resolve(body) });

function fakeCheckbox(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
  const path = url.replace(/^https:\/\/api\.checkbox\.in\.ua\/api\/v1/, "");
  const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  calls.push({ path, method: init.method, headers: init.headers, body });
  if (fail.network > 0) {
    fail.network--;
    return Promise.reject(new TypeError("fetch failed"));
  }
  if (init.headers["X-License-Key"] !== "lic-1234567890") return reply(403, { message: "Invalid license key" });
  if (path === "/cashier/signin") {
    return body?.login === "cashier" && body?.password === "secret-pass" ? reply(200, { access_token: token, token_type: "bearer" }) : reply(403, { message: "Невірний логін або пароль" });
  }
  if (init.headers.Authorization !== `Bearer ${token}`) return reply(401, { message: "Not authenticated" });
  if (path === "/cashier/shift") {
    // смена «открывается» к следующему запросу
    if (shift?.status === "CREATED") shift = { ...shift, status: "OPENED" };
    return reply(200, shift);
  }
  if (path === "/shifts" && init.method === "POST") {
    shift = { id: `shift-${calls.length}`, status: "CREATED" };
    return reply(202, shift);
  }
  if (path === "/shifts/close") {
    shift = shift && { ...shift, status: "CLOSED" };
    return reply(202, shift);
  }
  if (path === "/receipts/sell") {
    if (shift?.status !== "OPENED") return reply(400, { message: "Зміну не відкрито" });
    if (fail.sell > 0) {
      fail.sell--;
      return reply(500, { message: "Internal error" });
    }
    const rec = { id: body!.id, status: fail.error ? "ERROR" : "CREATED", fiscal_code: null, transaction: fail.error ? { status: "ERROR", response_error_message: "ДПС не прийняла чек" } : {} };
    store.set(String(body!.id), rec);
    return reply(201, rec);
  }
  const m = path.match(/^\/receipts\/([\w-]+)$/);
  if (m && init.method === "GET") {
    const rec = store.get(m[1]);
    if (!rec) return reply(404, { message: "Receipt not found" });
    if (rec.status === "CREATED") store.set(m[1], { ...rec, status: "DONE", fiscal_code: `FC-${fiscalNo++}` });
    return reply(200, store.get(m[1]));
  }
  return reply(500, null);
}
const sells = () => calls.filter((c) => c.path === "/receipts/sell");

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  pay = await import("../src/payments");
  rc = await import("../src/receipts");
  jobs = await import("../src/jobs");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const p = await prisma.product.findFirstOrThrow({ where: { supplierAvailable: true, visible: true, price: { gt: 150 } }, orderBy: { sku: "asc" } });
  sku = p.sku;
  price = p.price.toNumber();
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret", "FiscalReceipt"');
  rc.setReceiptsFetch(fakeCheckbox, 1);
  ready = true;
});

after(async () => {
  if (ready) {
    rc.setReceiptsFetch(null);
    await prisma.$disconnect();
  }
  checkboxOff();
  cleanup();
});

const place = async (over: Record<string, unknown> = {}) => {
  const r = await orders.placeOrder(form(over), { lang: "uk" });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) throw new Error("заказ не создан");
  return { ...r, id: (await prisma.order.findUniqueOrThrow({ where: { no: r.no } })).id };
};

// «настоящий» счёт mono (без сети: состояние подаём как из уведомления/опроса)
let invNo = 1;
const liveInvoice = (orderId: string, amount: number, kind = "full") =>
  prisma.payInvoice.create({ data: { id: `inv-${invNo++}`, orderId, kind, amount, pageUrl: "https://pay.mbnk.biz/x", stub: false, createdBy: "сайт" } });
let tick = Date.parse("2026-09-28T10:00:00Z");
const monoState = (id: string, amount: number, over: Record<string, unknown> = {}) =>
  pay.applyInvoiceState(
    { invoiceId: id, status: "success", amount, finalAmount: amount, modifiedAt: new Date((tick += 60_000)), failureReason: null, reference: "", refunded: 0, refundPending: false, ...over } as never,
    "опрос monobank",
  );

test("без ключей (не production): тестовые чеки после тестовой оплаты и возврата, ручной чек, ссылок покупателю нет", async (t) => {
  if (!ready) return t.skip(skipMsg);
  assert.equal(await rc.receiptMode(), "stub");
  const o = await place({ pay: "prepay" });
  const a = await pay.payFromSite(o.no, o.accessKey, "http://localhost:3100");
  assert.ok(a.ok);
  assert.equal(await pay.stubPay(o.no, o.accessKey), true);
  const [sell] = await rc.orderReceipts(o.id);
  assert.deepEqual([sell.kind, sell.status, sell.stub, sell.amount.toNumber(), sell.url], ["sell", "done", true, 200, null]);
  assert.match(sell.fiscalCode ?? "", /^ТЕСТ-/);
  assert.deepEqual(sell.goods, [{ code: o.no, name: `Передплата за замовлення ${o.no}`, price: 200, qty: 1 }]);
  assert.equal(calls.length, 0, "в Checkbox ничего не уходило");
  const hist = await prisma.orderHistory.findMany({ where: { orderId: o.id } });
  assert.ok(hist.some((h) => /Кассовый чек \(продажа, картой\) на 200 ₴ — ТЕСТОВЫЙ/.test(h.text)), hist.map((h) => h.text).join("\n"));
  assert.equal(await prisma.outbox.count({ where: { orderId: o.id, audience: "client", text: { contains: "чек" } } }), 0, "тестовый чек покупателю не отправляется");
  assert.deepEqual(await rc.orderReceiptLinks(o.no, o.accessKey), []);

  const inv = await prisma.payInvoice.findFirstOrThrow({ where: { orderId: o.id } });
  await pay.refundInvoice(inv.id, 50, "Владелец");
  const ret = (await rc.orderReceipts(o.id)).find((r) => r.kind === "return")!;
  assert.deepEqual([ret.status, ret.amount.toNumber(), ret.relatedId], ["done", 50, sell.id]);
  assert.equal((ret.goods as Array<{ name: string }>)[0].name, `Повернення коштів за замовлення ${o.no}`);

  // ручной чек: не больше непробитой части (сумма − продажи + возвраты)
  const max = await rc.receiptableOf(o.id);
  assert.equal(max, Math.round((price * 3 - 200 + 50) * 100) / 100);
  await assert.rejects(rc.createManualReceipt(o.id, max + 1, "CASH", "Менеджер"), /Не больше суммы заказа/);
  const man = await rc.createManualReceipt(o.id, max, "CASH", "Менеджер");
  assert.equal(man.status, "done");
  const m = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: man.id } });
  assert.deepEqual([m.payType, m.createdBy, m.stub], ["CASH", "Менеджер", true]);
  assert.equal(await rc.receiptableOf(o.id), 0);
  assert.equal(await prisma.auditLog.count({ where: { action: "receipt.manual", target: o.id } }), 1);
});

test("Checkbox подключён: тестовая оплата чек не получает; оплата mono → вход, смена, построчный чек, ссылка покупателю; возврат → чек возврата", async (t) => {
  if (!ready) return t.skip(skipMsg);
  checkboxOn();
  calls.length = 0;
  shift = null;
  try {
    assert.equal(await rc.receiptMode(), "live");
    // тестовая (stub) оплата mono — денег не было, чека нет
    const s = await place({ pay: "prepay" });
    await pay.payFromSite(s.no, s.accessKey, "http://localhost:3100");
    assert.equal(await pay.stubPay(s.no, s.accessKey), true);
    assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: s.id } }), 0);
    assert.equal(calls.length, 0);

    const o = await place();
    await prisma.client.update({ where: { id: (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).clientId }, data: { email: "buyer@example.ua" } });
    const total = Math.round(price * 3 * 100) / 100;
    const inv = await liveInvoice(o.id, total);
    await monoState(inv.id, total);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`).slice(0, 5), ["POST /cashier/signin", "GET /cashier/shift", "POST /shifts", "GET /cashier/shift", "POST /receipts/sell"]);
    const [sell] = await rc.orderReceipts(o.id);
    assert.deepEqual([sell.status, sell.fiscalCode, sell.url, sell.invoiceId], ["done", "FC-1", `https://check.checkbox.ua/${sell.id}`, inv.id]);
    const body = sells()[0].body!;
    assert.equal(body.id, sell.id, "наш id = id чека в Checkbox");
    assert.deepEqual(body.goods, [{ good: { code: sku, name: (await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).name, price: Math.round(price * 100) }, quantity: 3000 }]);
    assert.deepEqual(body.payments, [{ type: "CASHLESS", value: Math.round(total * 100), label: "Картка" }]);
    assert.deepEqual(body.delivery, { emails: ["buyer@example.ua"] });
    assert.equal(sells()[0].headers["X-Client-Name"], "Handyman");
    // ссылка покупателю (бота у него нет — «скопируйте» в заказе) и на странице заказа
    const msg = await prisma.outbox.findFirstOrThrow({ where: { orderId: o.id, audience: "client", text: { contains: "check.checkbox.ua" } } });
    assert.equal(msg.text, `Касовий чек за замовлення ${o.no} (${total.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴): ${sell.url}`);
    assert.ok((await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: sell.id } })).sentToClientAt);
    assert.deepEqual(await rc.orderReceiptLinks(o.no, o.accessKey), [{ kind: "sell", amount: total, url: sell.url }]);
    assert.deepEqual(await rc.orderReceiptLinks(o.no, "чужой"), []);
    assert.equal(await rc.processReceipts(), 0, "очередь пуста");

    // повтор того же состояния mono — второго чека нет
    await monoState(inv.id, total);
    assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: o.id } }), 1);

    // возврат 100 ₴ — чек возврата одной строкой со ссылкой на продажу; смена уже открыта
    calls.length = 0;
    await monoState(inv.id, total, { finalAmount: total - 100, refunded: 100 });
    assert.equal(calls.filter((c) => c.path === "/shifts").length, 0);
    const ret = (await rc.orderReceipts(o.id)).find((r) => r.kind === "return")!;
    assert.equal(ret.status, "done");
    assert.deepEqual(sells()[0].body!.goods, [{ good: { code: o.no, name: `Повернення коштів за замовлення ${o.no}`, price: 10000 }, quantity: 1000, is_return: true }]);
    assert.equal(sells()[0].body!.related_receipt_id, sell.id);
    const links = await rc.orderReceiptLinks(o.no, o.accessKey);
    assert.deepEqual(links.map((l) => l.kind), ["sell", "return"]);
  } finally {
    checkboxOff();
  }
});

test("сбои: Checkbox недоступен → повтор по расписанию; ответ-ошибка 8 раз → «не создан», тревога; «Повторить»; ошибка ДПС", async (t) => {
  if (!ready) return t.skip(skipMsg);
  checkboxOn();
  calls.length = 0;
  try {
    const o = await place({ pay: "card" });
    const inv = await liveInvoice(o.id, 120, "manual");
    fail.network = 1;
    await monoState(inv.id, 120);
    let [r] = await rc.orderReceipts(o.id);
    assert.deepEqual([r.status, r.attempts], ["queued", 1]);
    assert.match(r.error ?? "", /Не удалось связаться с Checkbox/);
    const next = r.nextTryAt!.getTime();
    assert.equal(await rc.processReceipts(new Date(next - 1000)), 0, "ещё рано");
    calls.length = 0;
    assert.equal(await rc.processReceipts(new Date(next + 1000)), 1);
    [r] = await rc.orderReceipts(o.id);
    assert.equal(r.status, "done");
    assert.equal(calls.find((c) => c.path.startsWith("/receipts/"))?.method, "GET", "повтор: сначала спросили, не дошёл ли чек");
    assert.deepEqual((r.goods as Array<{ name: string }>).map((g) => g.name), [`Оплата замовлення ${o.no}`]);

    // Checkbox всё время отвечает ошибкой — 8 попыток, потом «не создан» и тревога менеджерам
    const o2 = await place({ pay: "card" });
    const inv2 = await liveInvoice(o2.id, 90, "manual");
    fail.sell = 100;
    await monoState(inv2.id, 90);
    let [bad] = await rc.orderReceipts(o2.id);
    for (let i = 0; i < 10 && bad.status === "queued"; i++) {
      await rc.processReceipts(new Date(bad.nextTryAt!.getTime() + 1000));
      [bad] = await rc.orderReceipts(o2.id);
    }
    assert.deepEqual([bad.status, bad.attempts], ["error", 8]);
    assert.match(bad.error ?? "", /ошибкой 500: Internal error/);
    assert.ok(await prisma.outbox.findFirst({ where: { orderId: o2.id, audience: "manager", text: { contains: "🧾❗ Чек по" } } }));
    assert.ok(await prisma.orderHistory.findFirst({ where: { orderId: o2.id, text: { contains: "не создан" } } }));
    assert.equal(await rc.processReceipts(new Date(Date.now() + 86400_000)), 0, "«не создан» сам больше не пробуется");
    // «Повторить»: Checkbox чек не знает → новый номер чека, отправка
    fail.sell = 0;
    const st = await rc.retryReceipt(bad.id, "Менеджер");
    assert.equal(st, "done");
    const [good] = await rc.orderReceipts(o2.id);
    assert.notEqual(good.id, bad.id);
    assert.equal(good.status, "done");
    await assert.rejects(rc.retryReceipt(good.id, "Менеджер"), /не в статусе/);

    // Checkbox принял, но ДПС отказала — сразу «не создан»
    const o3 = await place({ pay: "card" });
    const inv3 = await liveInvoice(o3.id, 70, "manual");
    fail.error = true;
    await monoState(inv3.id, 70);
    fail.error = false;
    const [e] = await rc.orderReceipts(o3.id);
    assert.deepEqual([e.status, e.error], ["error", "ДПС не прийняла чек"]);
  } finally {
    fail.sell = 0;
    fail.error = false;
    checkboxOff();
  }
});

test("одновременная отправка — один чек; истёкший вход — входим заново; смена закрывается в 23:00 один раз", async (t) => {
  if (!ready) return t.skip(skipMsg);
  checkboxOn();
  try {
    const o = await place({ pay: "card" });
    assert.ok((await rc.receiptableOf(o.id)) > 0);
    // ставим в очередь без отправки: сбой сети на первой попытке
    fail.network = 1;
    const { id } = await rc.createManualReceipt(o.id, 10, "CASH", "Менеджер");
    const row = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, "queued");
    await prisma.fiscalReceipt.update({ where: { id }, data: { nextTryAt: new Date(Date.now() - 1000) } });
    calls.length = 0;
    await Promise.all([rc.sendReceipt(id), rc.sendReceipt(id), rc.processReceipts()]);
    assert.equal(sells().length, 1, "ровно одна отправка");
    assert.equal((await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id } })).status, "done");
    assert.equal((sells()[0].body!.payments as Array<{ type: string }>)[0].type, "CASH");

    // токен кассира истёк — один повторный вход
    token = "tok-2";
    calls.length = 0;
    const m2 = await rc.createManualReceipt(o.id, 5, "CASHLESS", "Менеджер");
    assert.equal(m2.status, "done");
    assert.equal(calls.filter((c) => c.path === "/cashier/signin").length, 1);

    // закрытие смены: в 22:00 по Киеву — нет, в 23:10 — да, повторно в тот же день — нет
    assert.equal(shift?.status, "OPENED");
    calls.length = 0;
    const r22 = await jobs.runJobs(new Date("2026-09-28T19:00:00Z"));
    assert.equal(r22.shiftClosed, false);
    const r23 = await jobs.runJobs(new Date("2026-09-28T20:10:00Z"));
    assert.equal(r23.shiftClosed, true);
    assert.equal(shift?.status, "CLOSED");
    assert.ok(calls.some((c) => c.path === "/shifts/close"));
    const again = await jobs.runJobs(new Date("2026-09-28T20:30:00Z"));
    assert.equal(again.shiftClosed, false);
    assert.equal(await prisma.auditLog.count({ where: { action: "checkbox.shift.close" } }), 1);
  } finally {
    checkboxOff();
  }
});

test("в production без ключей Checkbox чеков нет", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(await rc.receiptMode(), "off");
    const o = await place();
    const inv = await liveInvoice(o.id, 100, "manual");
    await monoState(inv.id, 100);
    assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: o.id } }), 0);
    await assert.rejects(rc.createManualReceipt(o.id, 10, "CASH", "Менеджер"), /не подключён/);
  } finally {
    process.env.NODE_ENV = env;
  }
});
