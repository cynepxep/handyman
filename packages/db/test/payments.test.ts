// Оплата monobank (шаг 3.2) на базе handyman_test: тестовая оплата без токена, счёт mono (сеть подменена), «Оплачен» автоматически,
// уведомление с подписью (и подделка, и устаревшее), одновременные уведомление и опрос, возврат, счёт менеджера, отмена ссылки, опрос.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signData } from "node:crypto";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

process.env.SECRETS_KEY = "test-secrets-key";
process.env.MONO_TOKEN = "";
process.env.PUBLIC_URL = "";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let pay: typeof import("../src/payments");
let sku = "";
let price = 0;

const ORIGIN = "http://localhost:3100";
const form = (over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: "093 366 24 07", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items: [{ sku, qty: 3 }], ...over,
});

// ---------- подменённый monobank ----------
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const signed = (body: unknown) => {
  const raw = JSON.stringify(body);
  return { raw, sign: signData("sha256", Buffer.from(raw), keys.privateKey).toString("base64") };
};
type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };
const calls: Call[] = [];
/** invoiceId → что отвечает invoice/status */
const state = new Map<string, Record<string, unknown>>();
let nextId = 1;
const reply = (status: number, body: unknown) => Promise.resolve({ status, json: () => Promise.resolve(body) });

function fakeMono(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
  const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  calls.push({ url, method: init.method, headers: init.headers, body });
  if (init.headers["X-Token"] !== "test-mono-token-1234") return reply(403, { errCode: "FORBIDDEN", errText: "forbidden" });
  const path = url.replace(/^https:\/\/api\.monobank\.ua/, "");
  if (path === "/api/merchant/pubkey") return reply(200, { key: Buffer.from(pem).toString("base64") });
  if (path === "/api/merchant/invoice/create") {
    const id = `inv-${nextId++}`;
    state.set(id, { invoiceId: id, status: "created", amount: body!.amount, ccy: 980, reference: (body!.merchantPaymInfo as { reference: string }).reference, modifiedDate: "2026-09-28T10:00:00Z" });
    return reply(200, { invoiceId: id, pageUrl: `https://pay.mbnk.biz/${id}` });
  }
  if (path.startsWith("/api/merchant/invoice/status")) {
    const id = new URL(url).searchParams.get("invoiceId")!;
    return state.has(id) ? reply(200, state.get(id)) : reply(404, { errCode: "NOT_FOUND", errText: "invoice not found" });
  }
  if (path === "/api/merchant/invoice/cancel") {
    const s = state.get(String(body!.invoiceId))!;
    const cancel = Number(body!.amount);
    const fin = Number(s.finalAmount ?? s.amount) - cancel;
    state.set(String(body!.invoiceId), { ...s, status: fin > 0 ? "success" : "reversed", finalAmount: fin, modifiedDate: "2026-09-28T12:00:00Z", cancelList: [{ status: "success", amount: cancel }] });
    return reply(200, { status: "success", createdDate: "2026-09-28T12:00:00Z", modifiedDate: "2026-09-28T12:00:00Z" });
  }
  if (path === "/api/merchant/invoice/remove") {
    const s = state.get(String(body!.invoiceId))!;
    state.set(String(body!.invoiceId), { ...s, status: "expired", modifiedDate: "2026-09-28T13:00:00Z" });
    return reply(200, {});
  }
  return reply(500, null);
}
const paidNow = (id: string, over: Record<string, unknown> = {}) => {
  const s = state.get(id)!;
  state.set(id, { ...s, status: "success", finalAmount: s.amount, modifiedDate: "2026-09-28T10:05:00Z", ...over });
};

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  pay = await import("../src/payments");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const p = await prisma.product.findFirstOrThrow({ where: { supplierAvailable: true, visible: true, price: { gt: 150 } }, orderBy: { sku: "asc" } });
  sku = p.sku;
  price = p.price.toNumber();
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret", "WebhookLog"');
  pay.setPaymentsFetch(fakeMono);
  ready = true;
});

after(async () => {
  if (ready) {
    pay.setPaymentsFetch(null);
    await prisma.$disconnect();
  }
  process.env.MONO_TOKEN = "";
  cleanup();
});

const place = async (over: Record<string, unknown> = {}) => {
  const r = await orders.placeOrder(form(over), { lang: "uk" });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) throw new Error("заказ не создан");
  return { ...r, id: (await prisma.order.findUniqueOrThrow({ where: { no: r.no } })).id };
};

test("без токена (не production): тестовая оплата — счёт, та же ссылка повторно, «Оплачен», сообщения, тестовый возврат", async (t) => {
  if (!ready) return t.skip(skipMsg);
  assert.equal(await pay.monoMode(), "stub");
  const o = await place();
  assert.equal(await pay.orderPayState(o.no, "чужой-ключ"), null);
  const st = await pay.orderPayState(o.no, o.accessKey);
  assert.deepEqual([st?.mode, st?.target], ["stub", { kind: "prepay", amount: 200 }]);
  assert.deepEqual(await pay.payFromSite(o.no, "чужой-ключ", ORIGIN), { ok: false, reason: "notFound" });
  const a = await pay.payFromSite(o.no, o.accessKey, ORIGIN);
  assert.ok(a.ok && a.stub);
  if (!a.ok) return;
  assert.equal(a.pageUrl, `${ORIGIN}/order/${o.no}?k=${o.accessKey}`, "тестовая «оплата» — на странице заказа");
  const b = await pay.payFromSite(o.no, o.accessKey, ORIGIN);
  assert.equal(await prisma.payInvoice.count({ where: { orderId: o.id } }), 1, "вернулся, не заплатив, — та же ссылка");
  assert.ok(b.ok);
  assert.equal(calls.length, 0, "в mono ничего не уходило");
  assert.equal(await pay.stubPay(o.no, o.accessKey), true);
  const paid = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { history: true, outboxEntries: true } });
  assert.equal(paid.paidAmount.toNumber(), 200);
  assert.equal(paid.status, "PAID");
  assert.ok(paid.history.some((h) => /Оплата картой: \+200 ₴ \(предоплата.*ТЕСТОВАЯ/.test(h.text)), paid.history.map((h) => h.text).join("\n"));
  assert.ok(paid.outboxEntries.some((m) => m.audience === "manager" && /💳 Оплачено .*200 ₴/.test(m.text)));
  assert.deepEqual(await pay.payFromSite(o.no, o.accessKey, ORIGIN), { ok: false, reason: "nothing" }, "предоплата внесена — больше не просим");
  assert.equal(await pay.stubPay(o.no, o.accessKey), false, "нечего оплачивать");
  const inv = await prisma.payInvoice.findFirstOrThrow({ where: { orderId: o.id } });
  await assert.rejects(pay.refundInvoice(inv.id, 300, "Владелец"), /не больше оплаченного/);
  await pay.refundInvoice(inv.id, 50, "Владелец");
  const after1 = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
  assert.equal(after1.paidAmount.toNumber(), 150);
  assert.equal(after1.status, "PAID", "статус после возврата менеджер меняет сам");
  assert.equal((await prisma.payInvoice.findUniqueOrThrow({ where: { id: inv.id } })).refunded.toNumber(), 50);
  assert.equal(await prisma.auditLog.count({ where: { action: "payment.refund", target: o.id } }), 1);
  // после частичного возврата — можно доплатить до предоплаты
  assert.deepEqual((await pay.orderPayState(o.no, o.accessKey))?.target, { kind: "rest", amount: 50 });
});

test("в production без токена онлайн-оплаты нет", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const o = await place();
    assert.equal(await pay.monoMode(), "off");
    assert.deepEqual(await pay.payFromSite(o.no, o.accessKey, ORIGIN), { ok: false, reason: "off" });
    await assert.rejects(pay.createManagerInvoice(o.id, 100, "Менеджер", ORIGIN, false), /не подключена/);
  } finally {
    process.env.NODE_ENV = env;
  }
});

test("mono: счёт на всю сумму построчно, проверка покупателем, «Оплачен», одновременные уведомление и опрос не зачтут дважды", async (t) => {
  if (!ready) return t.skip(skipMsg);
  process.env.MONO_TOKEN = "test-mono-token-1234";
  process.env.PUBLIC_URL = "https://shop.example.ua";
  calls.length = 0;
  try {
    assert.equal(await pay.monoMode(), "live");
    const o = await place({ pay: "full" });
    const a = await pay.payFromSite(o.no, o.accessKey, ORIGIN);
    assert.ok(a.ok && !a.stub && a.pageUrl.startsWith("https://pay.mbnk.biz/"));
    const create = calls.find((c) => c.url.endsWith("/invoice/create"))!;
    assert.equal(create.body!.amount, Math.round(price * 3 * 100));
    assert.equal(create.body!.redirectUrl, `https://shop.example.ua/order/${o.no}?k=${o.accessKey}`);
    assert.equal(create.body!.webHookUrl, "https://shop.example.ua/api/pay/mono");
    const info = create.body!.merchantPaymInfo as { reference: string; destination: string; basketOrder: Array<{ code: string; qty: number; sum: number }> };
    assert.equal(info.reference, o.no);
    assert.equal(info.destination, `Оплата замовлення ${o.no}`);
    assert.deepEqual(info.basketOrder.map((l) => [l.code, l.qty, l.sum]), [[sku, 3, Math.round(price * 100)]]);
    const inv = await prisma.payInvoice.findFirstOrThrow({ where: { orderId: o.id } });
    assert.ok(inv.checkUntil && inv.checkUntil > new Date(), "будем спрашивать mono");

    await pay.refreshOrderPayments(o.no, o.accessKey);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status, "NEW", "ещё не оплачено");

    paidNow(inv.id);
    const hook = signed(state.get(inv.id));
    const [code] = await Promise.all([pay.handleMonoWebhook(hook.raw, hook.sign), pay.refreshOrderPayments(o.no, o.accessKey), pay.refreshInvoice(inv.id, "опрос")]);
    assert.equal(code, 200);
    const done = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { history: true, outboxEntries: true } });
    assert.equal(done.status, "PAID");
    assert.equal(done.paidAmount.toNumber(), Math.round(price * 3 * 100) / 100);
    assert.equal(done.history.filter((h) => h.text.startsWith("Оплата картой")).length, 1, "зачтено один раз");
    assert.equal(done.outboxEntries.filter((m) => m.text.includes("💳 Оплачено")).length, 1);
    assert.equal((await prisma.payInvoice.findUniqueOrThrow({ where: { id: inv.id } })).checkUntil, null, "счёт закрыт — больше не спрашиваем");
    assert.equal(await prisma.webhookLog.count({ where: { source: "MONO" } }), 1);

    // старое уведомление «в обработке» пришло после «оплачено» — не применяется
    const old = signed({ ...state.get(inv.id), status: "processing", modifiedDate: "2026-09-28T10:01:00Z" });
    assert.equal(await pay.handleMonoWebhook(old.raw, old.sign), 200);
    assert.equal((await prisma.payInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status, "success");
    // подделка: подпись не от mono
    const fake = signed({ ...state.get(inv.id), status: "reversed", finalAmount: 0, modifiedDate: "2026-09-28T11:00:00Z" });
    assert.equal(await pay.handleMonoWebhook(fake.raw, Buffer.from("подделка").toString("base64")), 403);
    assert.equal(await pay.handleMonoWebhook(fake.raw.replace("reversed", "success"), fake.sign), 403, "тело изменено после подписи");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).paidAmount.toNumber(), done.paidAmount.toNumber());
    // уведомление о чужом счёте — принято, ничего не меняет
    const alien = signed({ invoiceId: "someone-else", status: "success", amount: 100 });
    assert.equal(await pay.handleMonoWebhook(alien.raw, alien.sign), 200);
    assert.equal(await pay.handleMonoWebhook("{}", signed({}).sign), 400);

    // возврат части: mono отвечает, статус подтягивается сразу
    const r = await pay.refundInvoice(inv.id, 100, "Владелец");
    assert.equal(r.pending, false);
    const cancel = calls.find((c) => c.url.endsWith("/invoice/cancel"))!;
    assert.deepEqual([cancel.body!.invoiceId, cancel.body!.amount], [inv.id, 10000]);
    const ref = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { outboxEntries: true } });
    assert.equal(ref.paidAmount.toNumber(), Math.round((price * 3 - 100) * 100) / 100);
    assert.ok(ref.outboxEntries.some((m) => /↩️ Возврат .*100 ₴/.test(m.text)));
  } finally {
    process.env.MONO_TOKEN = "";
    process.env.PUBLIC_URL = "";
  }
});

test("mono: счёт менеджера со ссылкой покупателю, отмена ссылки, опрос по расписанию, неверный токен", async (t) => {
  if (!ready) return t.skip(skipMsg);
  process.env.MONO_TOKEN = "test-mono-token-1234";
  calls.length = 0;
  try {
    const o = await place({ pay: "card" });
    assert.deepEqual(await pay.payFromSite(o.no, o.accessKey, ORIGIN), { ok: false, reason: "nothing" }, "«по реквизитам» — без кнопки на сайте");
    await assert.rejects(pay.createManagerInvoice(o.id, price * 3 + 1, "Менеджер", ORIGIN, false), /Не больше неоплаченной/);
    const inv = await pay.createManagerInvoice(o.id, 120, "Менеджер", ORIGIN, true);
    assert.match(inv.sent ?? "", /без бота/);
    const create = calls.find((c) => c.url.endsWith("/invoice/create"))!;
    assert.equal((create.body!.merchantPaymInfo as { basketOrder: unknown[] }).basketOrder.length, 1, "часть суммы — одной строкой");
    assert.equal("webHookUrl" in create.body!, false, "нет https-адреса — без уведомлений, только опрос");
    const msg = await prisma.outbox.findFirstOrThrow({ where: { orderId: o.id, audience: "client" } });
    assert.equal(msg.text, `Посилання для оплати замовлення ${o.no} (120 ₴): ${inv.pageUrl}`);
    assert.equal(msg.state, "NO_CHANNEL");

    // опрос: только «пора» и только живые счета
    calls.length = 0;
    const now = new Date();
    assert.equal(await pay.pollInvoices(now), 1);
    assert.equal(await pay.pollInvoices(new Date(now.getTime() + 10_000)), 0, "только что спрашивали");
    paidNow(inv.id);
    assert.equal(await pay.pollInvoices(new Date(now.getTime() + 61_000)), 1);
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    assert.equal(paid.paidAmount.toNumber(), 120);
    assert.equal(paid.status, "PAID");

    // вторая ссылка — отменяем
    const second = await pay.createManagerInvoice(o.id, 30, "Менеджер", ORIGIN, false);
    await pay.cancelInvoiceLink(second.id, "Менеджер");
    assert.ok(calls.some((c) => c.url.endsWith("/invoice/remove") && c.body!.invoiceId === second.id));
    const s2 = await prisma.payInvoice.findUniqueOrThrow({ where: { id: second.id } });
    assert.deepEqual([s2.status, s2.checkUntil], ["expired", null]);
    await assert.rejects(pay.cancelInvoiceLink(inv.id, "Менеджер"), /уже не ждёт оплаты/);

    process.env.MONO_TOKEN = "wrong-token-000000";
    await assert.rejects(pay.createManagerInvoice(o.id, 10, "Менеджер", ORIGIN, false), /не принял токен/);
  } finally {
    process.env.MONO_TOKEN = "";
  }
});
