// Оплата mono (шаг 3.2): сколько просить с сайта, тело счёта, разбор ответа и уведомления, зачтённая сумма после возвратов, формы админки.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creditedOf, invoiceRequest, isFinal, isStale, monoWebhookUrl, payViewOf, pollDue, readCreateResponse, readMonoInvoice, sitePayTarget, unpaidOf,
  validateInvoiceAmount, validateRefund,
} from "../src/shop";

const order = (o: Partial<{ payMode: string; status: string; total: number; dueNow: number; paidAmount: number }> = {}) =>
  ({ payMode: "PREPAY", status: "NEW", total: 1500, dueNow: 200, paidAmount: 0, ...o });

test("кнопка «Сплатити»: предоплата до суммы предоплаты, полная — остаток, реквизиты и закрытые заказы — нет", () => {
  assert.deepEqual(sitePayTarget(order()), { kind: "prepay", amount: 200 });
  assert.deepEqual(sitePayTarget(order({ paidAmount: 150 })), { kind: "rest", amount: 50 });
  assert.equal(sitePayTarget(order({ paidAmount: 200 })), null, "предоплата внесена — остаток при получении");
  assert.deepEqual(sitePayTarget(order({ payMode: "FULL", dueNow: 1500 })), { kind: "full", amount: 1500 });
  assert.deepEqual(sitePayTarget(order({ payMode: "FULL", dueNow: 1500, paidAmount: 1000 })), { kind: "rest", amount: 500 });
  assert.equal(sitePayTarget(order({ payMode: "FULL", dueNow: 1500, paidAmount: 1499.5 })), null, "меньше 1 ₴ не просим");
  assert.equal(sitePayTarget(order({ payMode: "CARD" })), null);
  assert.equal(sitePayTarget(order({ payMode: "LATER" })), null);
  assert.equal(sitePayTarget(order({ status: "CANCELLED" })), null);
  assert.equal(sitePayTarget(order({ status: "DONE" })), null);
  assert.equal(unpaidOf(order({ paidAmount: 200 })), 1300);
});

test("счёт: суммы в копейках, корзина построчно только на всю сумму, адрес уведомлений только https", () => {
  const items = [{ name: "Круг 125", sku: "000123", qty: 3, unitPrice: 33.33 }, { name: "Болгарка", sku: "000777", qty: 1, unitPrice: 1400.01 }];
  const full = invoiceRequest({ no: "HM-1001", amount: 1500, destination: "Оплата замовлення HM-1001", items, redirectUrl: "http://localhost:3100/order/HM-1001?k=x", webHookUrl: null });
  assert.equal(full.amount, 150000);
  assert.equal(full.ccy, 980);
  assert.equal(full.paymentType, "debit");
  assert.equal(full.merchantPaymInfo.reference, "HM-1001");
  assert.deepEqual(full.merchantPaymInfo.basketOrder.map((l) => [l.code, l.qty, l.sum]), [["000123", 3, 3333], ["000777", 1, 140001]]);
  assert.equal("webHookUrl" in full, false);
  const pre = invoiceRequest({ no: "HM-1001", amount: 200, destination: "Передплата за замовлення HM-1001", items, redirectUrl: "x", webHookUrl: "https://shop.ua/api/pay/mono" });
  assert.deepEqual(pre.merchantPaymInfo.basketOrder, [{ name: "Передплата за замовлення HM-1001", qty: 1, sum: 20000, code: "HM-1001" }]);
  assert.equal(pre.webHookUrl, "https://shop.ua/api/pay/mono");
  assert.equal(monoWebhookUrl("https://handyman.od.ua/"), "https://handyman.od.ua/api/pay/mono");
  assert.equal(monoWebhookUrl("http://localhost:3100"), null);
  assert.equal(monoWebhookUrl(""), null);
});

test("ответы mono: создание счёта, статус и уведомление, возвраты", () => {
  assert.deepEqual(readCreateResponse(200, { invoiceId: "inv1", pageUrl: "https://pay.mbnk.biz/inv1" }), { ok: true, invoiceId: "inv1", pageUrl: "https://pay.mbnk.biz/inv1" });
  assert.deepEqual(readCreateResponse(400, { errCode: "BAD_REQUEST", errText: "invalid amount" }), { ok: false, error: "monobank ответил ошибкой 400: invalid amount." });
  assert.match((readCreateResponse(403, {}) as { error: string }).error, /не принял токен/);

  assert.equal(readMonoInvoice({ status: "success" }), null);
  assert.equal(readMonoInvoice({ invoiceId: "x", status: "strange", amount: 1 }), null);
  const paid = readMonoInvoice({ invoiceId: "inv1", status: "success", amount: 20000, finalAmount: 20000, ccy: 980, reference: "HM-1001", modifiedDate: "2026-09-28T10:00:00Z" })!;
  assert.equal(paid.amount, 200);
  assert.equal(creditedOf(paid), 200);
  assert.equal(paid.modifiedAt?.toISOString(), "2026-09-28T10:00:00.000Z");
  assert.equal(isFinal(paid), true);
  // частичный возврат: статус остаётся success, finalAmount меньше
  const part = readMonoInvoice({
    invoiceId: "inv1", status: "success", amount: 20000, finalAmount: 15000,
    cancelList: [{ status: "success", amount: 5000 }, { status: "processing", amount: 1000 }],
  })!;
  assert.equal(part.refunded, 50);
  assert.equal(part.refundPending, true);
  assert.equal(creditedOf(part), 150);
  assert.equal(isFinal(part), false, "возврат в обработке — ещё спрашиваем");
  assert.equal(creditedOf(readMonoInvoice({ invoiceId: "i", status: "reversed", amount: 20000, finalAmount: 0 })!), 0);
  assert.equal(creditedOf(readMonoInvoice({ invoiceId: "i", status: "success", amount: 20000, cancelList: [{ status: "success", amount: 2000 }] })!), 180, "без finalAmount — сумма минус возвраты");
  for (const s of ["created", "processing", "failure", "expired"]) assert.equal(creditedOf(readMonoInvoice({ invoiceId: "i", status: s, amount: 100 })!), 0, s);
  assert.equal(isFinal(readMonoInvoice({ invoiceId: "i", status: "processing", amount: 100 })!), false);
  assert.equal(isStale(new Date("2026-09-28T10:00:00Z"), new Date("2026-09-28T09:59:00Z")), true, "старое уведомление после нового");
  assert.equal(isStale(new Date("2026-09-28T10:00:00Z"), new Date("2026-09-28T10:00:00Z")), false);
  assert.equal(isStale(null, new Date()), false);
});

test("опрос mono: первые полчаса — раз в минуту, потом — раз в 10 минут", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  assert.equal(pollDue({ createdAt: ago(5), checkedAt: null }, now), true);
  assert.equal(pollDue({ createdAt: ago(5), checkedAt: ago(0.5) }, now), false);
  assert.equal(pollDue({ createdAt: ago(5), checkedAt: ago(1) }, now), true);
  assert.equal(pollDue({ createdAt: ago(120), checkedAt: ago(5) }, now), false);
  assert.equal(pollDue({ createdAt: ago(120), checkedAt: ago(11) }, now), true);
});

test("страница заказа: сплатити / чекаємо / не пройшла / отримано", () => {
  assert.equal(payViewOf(order(), null), "due");
  assert.equal(payViewOf(order(), { status: "created" }), "pending");
  assert.equal(payViewOf(order(), { status: "expired" }), "failed");
  assert.equal(payViewOf(order(), { status: "failure" }), "failed");
  assert.equal(payViewOf(order({ paidAmount: 200 }), { status: "success" }), "paid");
  assert.equal(payViewOf(order({ payMode: "CARD" }), null), "none");
  assert.equal(payViewOf(order({ status: "CANCELLED" }), null), "none");
});

test("формы админки: сумма счёта и возврата", () => {
  assert.deepEqual(validateInvoiceAmount("1 300,50", 1300.5), { ok: true, amount: 1300.5 });
  assert.equal(validateInvoiceAmount("0.5", 100).ok, false);
  assert.equal(validateInvoiceAmount("101", 100).ok, false);
  assert.equal(validateInvoiceAmount("абв", 100).ok, false);
  assert.deepEqual(validateRefund("50", 200), { ok: true, amount: 50 });
  assert.equal(validateRefund("0", 200).ok, false);
  assert.match((validateRefund("250", 200) as { error: string }).error, /не больше оплаченного/);
});
