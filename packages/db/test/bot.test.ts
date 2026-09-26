// Бот (Этап 5, шаг 5.1) на базе handyman_test с подменённым Telegram: /start, номер → единый клиент (слияние с «телеграм-дублем»),
// «Мои заказы», произвольный текст → менеджерам, вход на сайт по коду, приглашение, группы игнорируются, «аренда» чтения.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let bot: typeof import("../src/bot");
let orders: typeof import("../src/orders");
let clients: typeof import("../src/clients");
let sku = "";
const sent: Array<{ method: string; body: Record<string, unknown> }> = [];

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  await prisma.tgLogin.deleteMany(); // коды прошлых прогонов
  process.env.BOT_TOKEN = "123:test";
  const telegram = await import("../src/telegram");
  telegram.setTelegramFetch((async (url: string, init: RequestInit) => {
    sent.push({ method: String(url).split("/").pop()!, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as unknown as typeof fetch);
  bot = await import("../src/bot");
  orders = await import("../src/orders");
  clients = await import("../src/clients");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  sku = (await prisma.product.findFirstOrThrow({ where: { visible: true }, orderBy: { sku: "asc" } })).sku;
  ready = true;
});

after(async () => {
  process.env.BOT_TOKEN = "";
  if (ready) await prisma.$disconnect();
  cleanup();
});

let uid = 1;
const msg = (from: number, extra: Record<string, unknown>, chatType = "private") => ({
  update_id: uid++,
  message: { message_id: uid, from: { id: from, first_name: "Іван", username: "ivan_tg", language_code: "uk" }, chat: { id: from, type: chatType }, ...extra },
});
const lastText = () => String(sent.filter((x) => x.method === "sendMessage").at(-1)?.body.text ?? "");

test("/start — приветствие и кнопка «Поделиться номером»; сообщения в группах игнорируются", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await bot.handleUpdate(msg(1001, { text: "/start" }));
  assert.match(lastText(), /Вітаємо в Handyman/);
  const kb = sent.at(-1)!.body.reply_markup as { keyboard: Array<Array<{ request_contact?: boolean }>> };
  assert.equal(kb.keyboard[0][0].request_contact, true);
  const n = sent.length;
  await bot.handleUpdate(msg(1001, { text: "/start" }, "group"));
  assert.equal(sent.length, n);
});

test("номер: свой контакт привязывает Telegram к клиенту с заказами; «телеграм-дубль» сливается; чужой контакт — отказ", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeManualOrder({ phone: "+380935557700", name: "Петренко Іван", items: [{ sku, qty: 1 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: false }, "test");
  assert.ok(r.ok);
  // дубль: этот же человек раньше заходил через Mini App без номера и сделал заказ
  const dup = await clients.ensureTgClient({ tgId: 1002n, name: "Іван" });
  const dupOrder = await orders.placeManualOrder({ phone: "+380935557799", name: "x", items: [{ sku, qty: 1 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: false }, "test");
  assert.ok(dupOrder.ok);
  await prisma.order.update({ where: { id: dupOrder.id }, data: { clientId: dup.id } });

  await bot.handleUpdate(msg(1002, { contact: { phone_number: "+380935557700", user_id: 9999 } }));
  assert.match(lastText(), /свій номер/);
  await bot.handleUpdate(msg(1002, { contact: { phone_number: "380935557700", user_id: 1002 } }));
  assert.match(lastText(), /Готово, Іван! Номер \+380 \(93\) 555-77-00 підключено/);
  const c = await prisma.client.findUniqueOrThrow({ where: { phone: "+380935557700" }, include: { orders: true } });
  assert.equal(c.tgId, 1002n);
  assert.equal(c.orders.length, 2, "заказ дубля перенесён");
  assert.equal(await prisma.client.count({ where: { id: dup.id } }), 0, "дубль удалён");
  assert.ok(c.refCode, "выдан реферальный код");

  await bot.handleUpdate(msg(1002, { text: "📦 Мої замовлення" }));
  assert.match(lastText(), /Ваші останні замовлення:/);
  assert.match(lastText(), /HM-\d+ від .* — Прийнято/);
});

test("произвольный текст — менеджерам (в Outbox) и ответ покупателю; «Допомога» — с телефоном магазина", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await bot.handleUpdate(msg(1002, { text: "Є круг 230 по бетону?" }));
  assert.match(lastText(), /Передали менеджеру/);
  const out = await prisma.outbox.findFirstOrThrow({ where: { audience: "manager", text: { contains: "Є круг 230" } } });
  assert.match(out.text, /@ivan_tg, \+380 \(93\) 555-77-00/);
  await bot.handleUpdate(msg(1002, { text: "❓ Допомога" }));
  assert.match(lastText(), /менеджер відповість/);
});

test("вход на сайт: /start login_КОД подтверждает код; устаревший — «застаріло»; приглашение засчитывается после номера", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.tgLogin.create({ data: { code: "LOGINCODE1", expiresAt: new Date(Date.now() + 600_000) } });
  await bot.handleUpdate(msg(1002, { text: "/start login_LOGINCODE1" }));
  assert.match(lastText(), /ви увійшли/);
  const row = await prisma.tgLogin.findUniqueOrThrow({ where: { code: "LOGINCODE1" } });
  assert.ok(row.confirmedAt && row.clientId);
  await prisma.tgLogin.create({ data: { code: "OLDCODE123", expiresAt: new Date(Date.now() - 1000) } });
  await bot.handleUpdate(msg(1003, { text: "/start login_OLDCODE123" }));
  assert.match(lastText(), /застаріло/);

  const inviter = await prisma.client.findUniqueOrThrow({ where: { phone: "+380935557700" } });
  await bot.handleUpdate(msg(1004, { text: `/start ref_${inviter.refCode}` }));
  assert.match(lastText(), /Вас запросив друг/);
  await bot.handleUpdate(msg(1004, { contact: { phone_number: "0935557711", user_id: 1004 } }));
  const friend = await prisma.client.findUniqueOrThrow({ where: { phone: "+380935557711" } });
  assert.equal(friend.referredById, inviter.id);
});

test("аренда чтения: вторая копия не читает, пока первая держит; после освобождения — может", async (t) => {
  if (!ready) return t.skip(skipMsg);
  assert.equal(await bot.claimBotLease("A"), true);
  assert.equal(await bot.claimBotLease("B"), false);
  assert.equal(await bot.claimBotLease("A"), true, "продление своей");
  await bot.releaseBotLease("A");
  assert.equal(await bot.claimBotLease("B"), true);
  assert.equal(await bot.pollOnce("A", 0), -1, "A не читает, пока держит B");
  assert.equal(await bot.pollOnce("B", 0), 0);
  await bot.releaseBotLease("B");
});
