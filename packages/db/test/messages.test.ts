// Шаблоны и сообщения покупателю на базе handyman_test: тексты по умолчанию, отправка с подстановками, без Telegram — «скопируйте текст».
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let messages: typeof import("../src/messages");
let notify: typeof import("../src/notify");
let sku = "";

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  await prisma.orderStatusTemplate.deleteMany();
  orders = await import("../src/orders");
  messages = await import("../src/messages");
  notify = await import("../src/notify");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  sku = (await prisma.product.findFirstOrThrow({ where: { supplierAvailable: true, visible: true }, orderBy: { sku: "asc" } })).sku;
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const place = async (lang: "uk" | "ru") => {
  const r = await orders.placeOrder(
    { firstName: "Іван", lastName: "Петренко", phone: "0937770011", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay", items: [{ sku, qty: 1 }] },
    { lang },
  );
  assert.ok(r.ok);
  return prisma.order.findUniqueOrThrow({ where: { no: r.no } });
};

test("шаблоны: в пустой базе появляются тексты по умолчанию; правка и удаление пишутся в журнал", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const list = await messages.listTemplates();
  assert.ok(list.length >= 9);
  const shipped = list.find((x) => x.status === "SHIPPED")!;
  const r = await messages.saveTemplate(shipped.id, { status: "SHIPPED", titleRu: "Отправили", titleUk: "Відправили", textUk: "Їде! ТТН {ttn}", textRu: "Едет! ТТН {ttn}", autoSend: false }, "test");
  assert.ok(r.ok);
  const created = await messages.saveTemplate(null, { status: "NEW", titleRu: "Уточнение", titleUk: "Уточнення", textUk: "{name}, уточніть адресу", textRu: "{name}, уточните адрес", autoSend: false }, "test");
  assert.ok(created.ok);
  await messages.deleteTemplate(created.id, "test");
  assert.equal(await prisma.orderStatusTemplate.count({ where: { id: created.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { action: { startsWith: "template." } } }), 3);
});

test("сообщения по заказу: язык покупателя, имя и ТТН подставлены; без Telegram — «скопируйте текст», в истории заказа", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const o = await place("ru");
  await orders.setOrderTtn(o.id, "20450000000000", "test");
  const forOrder = await messages.templatesForOrder(o.id);
  assert.equal(forOrder.lang, "ru");
  assert.equal(forOrder.hasTelegram, false);
  const shipped = forOrder.items.find((x) => x.status === "SHIPPED" && x.title === "Отправили")!;
  assert.equal(shipped.text, "Едет! ТТН 20450000000000");

  const rep = await messages.sendOrderMessages(o.id, { templateIds: [shipped.id], customText: "  Спасибо!  " }, "Менеджер");
  assert.deepEqual(rep, { sent: 0, noChannel: 2, failed: 0, dev: 0 });
  const msgs = await messages.clientMessagesOf(o.id);
  assert.deepEqual(msgs.map((m) => [m.text, m.state, m.who]), [["Едет! ТТН 20450000000000", "NO_CHANNEL", "Менеджер"], ["Спасибо!", "NO_CHANNEL", "Менеджер"]]);
  const hist = await prisma.orderHistory.findMany({ where: { orderId: o.id, text: { startsWith: "Сообщение покупателю" } } });
  assert.equal(hist.length, 2);
  // сообщения менеджерам не смешиваются с сообщениями покупателю
  assert.ok((await prisma.outbox.findMany({ where: { orderId: o.id, audience: "manager" } })).length >= 1);
});

test("тексты по умолчанию: в базе с шаблонами прототипа добавляются только недостающие статусы и только один раз", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.orderStatusTemplate.deleteMany();
  await prisma.setting.deleteMany({ where: { key: "templates.seeded.v1" } });
  await prisma.orderStatusTemplate.create({ data: { status: "NEW", titleRu: "Мой", titleUk: "Мій", textUk: "a", textRu: "a" } });
  const list = await messages.listTemplates();
  assert.equal(list.filter((x) => x.status === "NEW").length, 1); // свой не задублирован
  assert.ok(list.some((x) => x.status === "NO_ANSWER") && list.some((x) => x.status === "RETURNED"));
  await prisma.orderStatusTemplate.deleteMany({ where: { status: "RETURNED" } });
  assert.equal((await messages.listTemplates()).some((x) => x.status === "RETURNED"), false); // удалённое не возвращается
});

test("покупатель с Telegram: сообщение уходит боту (подменённый fetch), ошибка Telegram видна и повторяется", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const o = await place("uk");
  await prisma.client.update({ where: { id: o.clientId }, data: { tgId: 123456789n } });
  process.env.BOT_TOKEN = "test-token";
  const calls: string[] = [];
  const okFetch = (async (_url: string, init: RequestInit) => { calls.push(String(init.body)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  const badFetch = (async () => new Response("Forbidden: bot was blocked by the user", { status: 403 })) as unknown as typeof fetch;
  try {
    assert.equal(await notify.notifyClient({ orderId: o.id, tgId: 123456789n, text: "Привіт", who: "t" }, okFetch), "SENT");
    assert.ok(calls[0].includes('"chat_id":"123456789"'));
    assert.equal(await notify.notifyClient({ orderId: o.id, tgId: 123456789n, text: "Ще раз", who: "t" }, badFetch), "FAILED");
    const failed = await prisma.outbox.findFirstOrThrow({ where: { orderId: o.id, state: "FAILED" } });
    assert.match(failed.error ?? "", /403/);
    assert.equal(await notify.retryOutbox(failed.id, okFetch), "SENT");
  } finally {
    process.env.BOT_TOKEN = "";
  }
});
