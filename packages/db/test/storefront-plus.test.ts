// Витрина+ (шаг 5.6) на базе handyman_test: опт и упаковка в корзине и заказе, совместимость (поиск, «мой инструмент»),
// отзывы с фото и модерацией, подписки «повідомити» (фоновая проверка, бот), «Передзвоніть мені», слияние клиента.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "hm-media-"));
process.env.MEDIA_DIR = mediaDir;

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let plus: typeof import("../src/storefront-plus");
let search: typeof import("../src/catalog-search");
let a: { id: string; sku: string; price: number };
let b: { id: string; sku: string; price: number };

const form = (items: Array<{ sku: string; qty: number }>, phone = "0671112233") => ({
  firstName: "Іван", lastName: "Опт", phone, delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay", items,
});

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  await prisma.compatibilityGroup.deleteMany();
  await prisma.task.deleteMany({ where: { who: "сайт" } });
  orders = await import("../src/orders");
  plus = await import("../src/storefront-plus");
  search = await import("../src/catalog-search");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const rows = await prisma.product.findMany({ where: { visible: true, supplierAvailable: true }, orderBy: { sku: "asc" }, take: 2 });
  [a, b] = rows.map((p) => ({ id: p.id, sku: p.sku, price: p.price.toNumber() }));
  try {
    await search.reindexAll();
  } catch {
    /* без Meilisearch — поисковые проверки пропустятся */
  }
  ready = true;
});

after(async () => {
  if (ready) {
    await prisma.compatibilityGroup.deleteMany();
    await prisma.task.deleteMany({ where: { who: "сайт" } });
    await prisma.$disconnect();
  }
  fs.rmSync(mediaDir, { recursive: true, force: true });
  cleanup();
});

test("опт и упаковка: цена за штуку от количества в корзине и в заказе; цена уровня «Опт» — только оптовику; дороже обычной — отказ", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const half = Math.round(a.price * 50) / 100;
  await plus.addPriceBreak(a.id, { minQty: 5, price: a.price * 0.9, tier: "" }, "test");
  await plus.addPackaging(a.id, { label: "уп.", units: 10, price: a.price * 8 }, "test"); // 0,8 за штуку
  await plus.addPriceBreak(a.id, { minQty: 3, price: half, tier: "WHOLESALE" }, "test");
  await assert.rejects(plus.addPriceBreak(a.id, { minQty: 2, price: a.price + 1, tier: "" }, "test"), /ниже обычной/);
  await assert.rejects(plus.addPackaging(a.id, { label: "", units: 1, price: 10 }, "test"), /от 2/);

  const q1 = await orders.quoteCart([{ sku: a.sku, qty: 1 }, { sku: a.sku, qty: 0 }]);
  assert.equal(q1.lines[0].price, a.price);
  assert.equal((await orders.quoteCart([{ sku: a.sku, qty: 6 }])).lines[0].price, Math.round(a.price * 0.9 * 100) / 100);
  const q10 = await orders.quoteCart([{ sku: a.sku, qty: 10 }]);
  assert.equal(q10.lines[0].price, Math.round(a.price * 0.8 * 100) / 100);
  assert.equal(q10.lines[0].basePrice, a.price);
  assert.equal(q10.lines[0].tiers.length, 2, "гостю — без цены уровня «Опт»");

  // заказ: сумма по оптовой цене, в строке — цена за штуку со скидкой от количества
  const r = await orders.placeOrder(form([{ sku: a.sku, qty: 10 }]), { lang: "uk" });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no }, include: { items: true } });
  assert.equal(o.items[0].unitPrice.toNumber(), Math.round(a.price * 0.8 * 100) / 100);
  assert.equal(o.total.toNumber(), Math.round(a.price * 0.8 * 100) / 100 * 10);

  // оптовик (уровень WHOLESALE) — цена уровня от 3 шт.; в заказе по звонку уровень находится по телефону
  const wholesale = await prisma.client.update({ where: { phone: "+380671112233" }, data: { tier: "WHOLESALE" } });
  assert.equal((await orders.quoteCart([{ sku: a.sku, qty: 3 }], { clientId: wholesale.id })).lines[0].price, half);
  assert.equal((await orders.quoteCart([{ sku: a.sku, qty: 3 }], { phone: "+380671112233" })).lines[0].price, half);
  const rules = await plus.qtyRulesOf(a.id);
  assert.equal(rules.breaks.length, 2);
  await plus.deleteQtyRule("break", rules.breaks[0].id, "test");
  assert.equal((await plus.qtyRulesOf(a.id)).breaks.length, 1);
});

test("совместимость: группа, инструмент и расходник, поиск «подходит к», «мой инструмент» из заказов", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const gid = await plus.createCompatGroup("Диск 125 мм", "Диск 125 мм", "test");
  const g2 = await plus.createCompatGroup("Диск 125 мм", "", "test");
  const keys = (await plus.listCompatGroups()).map((g) => g.key).sort();
  assert.deepEqual(keys, ["dysk-125-mm", "dysk-125-mm-2"], "одинаковое название — свой код");
  await plus.deleteCompatGroup(g2, "test");
  const add = await plus.addToCompatGroup(gid, "HOST", `${a.sku}, nope-1`, "test");
  assert.deepEqual(add, { added: 1, notFound: ["nope-1"] });
  await plus.addToCompatGroup(gid, "ACCESSORY", b.sku, "test");
  assert.deepEqual((await plus.compatOfProduct(b.id)).map((c) => [c.key, c.role]), [["dysk-125-mm", "ACCESSORY"]]);
  const detail = await plus.compatGroupDetail(gid);
  assert.deepEqual([detail?.hosts.length, detail?.accessories.length], [1, 1]);

  // «мой инструмент»: покупатель заказывал инструмент группы (заказ из прошлого теста — товар a)
  const buyer = await prisma.client.findUniqueOrThrow({ where: { phone: "+380671112233" } });
  assert.deepEqual((await plus.myToolGroups(buyer.id)).keys, ["dysk-125-mm"]);
  assert.deepEqual((await plus.myToolGroups(null)).keys, []);
  const other = await prisma.client.create({ data: { phone: "+380500000001" } });
  assert.deepEqual((await plus.myToolGroups(other.id)).keys, []);
  // Х1: отмечен в кабинете «Мій інструмент» (шаг 5.5) — тоже мой; «Прибрати» — не мой, даже если заказан
  await prisma.clientTool.create({ data: { clientId: other.id, productId: a.id, source: "manual" } });
  assert.deepEqual((await plus.myToolGroups(other.id)).keys, ["dysk-125-mm"]);
  await prisma.clientTool.update({ where: { clientId_productId: { clientId: other.id, productId: a.id } }, data: { hidden: true } });
  assert.deepEqual((await plus.myToolGroups(other.id)).keys, []);
  await prisma.clientTool.create({ data: { clientId: buyer.id, productId: a.id, source: "order", hidden: true } });
  assert.deepEqual((await plus.myToolGroups(buyer.id)).keys, [], "убранный из кабинета заказанный инструмент не считается");
  await prisma.clientTool.deleteMany({ where: { productId: a.id } });
  assert.deepEqual((await plus.myToolGroups(buyer.id)).keys, ["dysk-125-mm"]);

  try {
    const fits = await search.searchProducts({ fits: ["dysk-125-mm"] });
    assert.deepEqual(fits.items.map((i) => i.sku), [b.sku]);
    const tools = await search.searchProducts({ tools: ["dysk-125-mm"] });
    assert.deepEqual(tools.items.map((i) => i.sku), [a.sku]);
    assert.equal((await search.searchProducts({ fits: [] })).total, 0, "нет инструмента — пусто");
  } catch (e) {
    if (e instanceof search.SearchUnavailableError) return t.diagnostic("Meilisearch недоступен — поиск не проверен");
    throw e;
  }
  await plus.removeFromCompatGroup(gid, b.id, "ACCESSORY", "test");
  assert.equal((await plus.compatOfProduct(b.id)).length, 0);
});

test("отзывы: фото пережимается в WebP, «ждёт проверки», публикация, ответ, «купував у нас», лимит 5 в час, удаление с фото", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#c43b33" } }).png().toBuffer();
  const url = await plus.saveReviewPhoto(png);
  assert.match(url, /^\/media\/rv\/[0-9a-f]{2}\/[0-9a-f]{40}\.webp$/);
  const meta = await sharp(path.join(mediaDir, url.replace("/media/", ""))).metadata();
  assert.deepEqual([meta.format, meta.width], ["webp", 1600]);
  await assert.rejects(plus.saveReviewPhoto(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), plus.PlusUserError);

  const buyer = await prisma.client.findUniqueOrThrow({ where: { phone: "+380671112233" } });
  const r = await plus.createReview({ productId: a.id, raw: { name: "Іван", text: "Відмінний диск, ріже рівно", rating: 5 }, photos: [url], clientId: buyer.id, lang: "uk", ip: "1.1.1.1" });
  assert.deepEqual(r, { ok: true, kind: "review" });
  assert.deepEqual(await plus.createReview({ productId: a.id, raw: { name: "Іван", text: "ок", rating: 5 }, photos: [], clientId: null, lang: "uk", ip: "1.1.1.1" }), { ok: false, error: "review.err.text" });
  const q = await plus.createReview({ productId: a.id, raw: { kind: "question", name: "Олег", text: "Чи підійде до Bosch?" }, photos: [], clientId: null, lang: "ru", ip: "2.2.2.2" });
  assert.ok(q.ok);
  assert.equal((await plus.publishedReviews(a.id)).items.length, 0, "до проверки на сайте не видно");
  assert.equal(await plus.pendingReviewsCount(), 2);
  assert.ok((await prisma.outbox.findMany({ where: { text: { contains: "Новый отзыв (5/5)" } } })).length >= 1, "менеджерам — сообщение");

  const [rev, qst] = await Promise.all([
    prisma.review.findFirstOrThrow({ where: { kind: "REVIEW" } }), prisma.review.findFirstOrThrow({ where: { kind: "QUESTION" } }),
  ]);
  await plus.moderateReview(rev.id, "publish", "test");
  await plus.answerReview(qst.id, "Так, підійде.", "test");
  const pub = await plus.publishedReviews(a.id);
  assert.equal(pub.items.length, 2, "ответ публикует вопрос");
  assert.equal(pub.items.find((x) => x.kind === "review")?.verified, true, "автор заказывал этот товар");
  assert.equal(pub.items.find((x) => x.kind === "question")?.answer, "Так, підійде.");
  assert.deepEqual([pub.summary.avg, pub.summary.count], [5, 1]);

  // ответ автору в Telegram (бот не настроен — сохраняется заглушкой)
  await prisma.client.update({ where: { id: buyer.id }, data: { tgId: 7001n, tgStartedAt: new Date() } });
  assert.deepEqual(await plus.answerReview(rev.id, "Дякуємо!", "test"), { notified: true });
  assert.ok(await prisma.outbox.findFirst({ where: { audience: "client", chatId: "7001", text: { contains: "Дякуємо!" } } }));

  for (let i = 0; i < 4; i++) await plus.createReview({ productId: b.id, raw: { name: "Спам", text: `Повідомлення ${i}`, rating: 1 }, photos: [], clientId: null, lang: "uk", ip: "3.3.3.3" });
  assert.deepEqual(await plus.createReview({ productId: b.id, raw: { name: "Спам", text: "Ще одне", rating: 1 }, photos: [], clientId: null, lang: "uk", ip: "3.3.3.3" }), { ok: true, kind: "review" });
  assert.deepEqual(await plus.createReview({ productId: b.id, raw: { name: "Спам", text: "Шосте", rating: 1 }, photos: [], clientId: null, lang: "uk", ip: "3.3.3.3" }), { ok: false, error: "err.tooMany" });

  await plus.deleteReview(rev.id, "test");
  assert.equal(fs.existsSync(path.join(mediaDir, url.replace("/media/", ""))), false, "фото удалено вместе с отзывом");
});

test("подписки: снижение цены и поступление → одно сообщение в Telegram; без Telegram ждём; бот подписывает по /start wp_", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const withTg = await prisma.client.create({ data: { phone: "+380500000002", tgId: 7002n, tgStartedAt: new Date(), lang: "RU" } });
  const noTg = await prisma.client.create({ data: { phone: "+380500000003" } });
  assert.ok((await plus.subscribeWatch(withTg.id, b.id, "PRICE")).ok);
  assert.ok((await plus.subscribeWatch(noTg.id, b.id, "PRICE")).ok);
  await prisma.product.update({ where: { id: b.id }, data: { supplierAvailable: false } });
  assert.ok((await plus.subscribeWatch(withTg.id, b.id, "STOCK")).ok);
  assert.deepEqual((await plus.watchesFor(withTg.id, b.id)).sort(), ["PRICE", "STOCK"]);

  assert.equal(await plus.runWatches(), 0, "ничего не изменилось");
  await prisma.product.update({ where: { id: b.id }, data: { price: b.price - 10, supplierAvailable: true } });
  assert.equal(await plus.runWatches(), 2, "цена и наличие — клиенту с Telegram");
  assert.equal(await plus.runWatches(), 0, "второй раз не пишем");
  const msgs = await prisma.outbox.findMany({ where: { chatId: "7002" }, orderBy: { createdAt: "asc" } });
  assert.equal(msgs.length, 2);
  assert.ok(msgs.some((m) => m.text.startsWith("💸 Цена снизилась")), "по-русски, как у покупателя");
  assert.equal((await plus.watchesOfClient(noTg.id)).length, 1, "без Telegram подписка ждёт");

  // бот: /start wp_<товар> от нового человека — создаёт покупателя и подписку
  const bot = await import("../src/bot");
  process.env.BOT_TOKEN = "123:test";
  const telegram = await import("../src/telegram");
  const sent: string[] = [];
  telegram.setTelegramFetch((async (_url: string, init: RequestInit) => {
    sent.push(String(JSON.parse(String(init.body)).text ?? ""));
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  }) as unknown as typeof fetch);
  try {
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, from: { id: 7003, first_name: "Ганна", language_code: "uk" }, chat: { id: 7003, type: "private" }, text: `/start wp_${a.id}` } });
    assert.match(sent.at(-1) ?? "", /Добре! Напишу, щойно/);
    const c = await prisma.client.findUniqueOrThrow({ where: { tgId: 7003n } });
    assert.deepEqual(await plus.watchesFor(c.id, a.id), ["PRICE"]);
    await bot.handleUpdate({ update_id: 2, message: { message_id: 2, from: { id: 7003, first_name: "Ганна", language_code: "uk" }, chat: { id: 7003, type: "private" }, text: "/start ws_nosuchproduct1" } });
    assert.match(sent.at(-1) ?? "", /вже немає в продажу/);
  } finally {
    process.env.BOT_TOKEN = "";
  }
  await plus.unsubscribeWatch(noTg.id, b.id, "PRICE");
  assert.equal((await plus.watchesOfClient(noTg.id)).length, 0);
});

test("«Передзвоніть мені»: задача менеджерам со сроком «сейчас», повтор с того же номера не дублирует; слияние клиента переносит подписки", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await plus.requestCallback({ phone: "093 000 11 22", name: "Петро" }, { productId: a.id, lang: "uk" });
  assert.deepEqual(r, { ok: true, phone: "+380 (93) 000-11-22" });
  assert.deepEqual(await plus.requestCallback({ phone: "0930001122" }, { lang: "uk" }), { ok: true, phone: "+380 (93) 000-11-22" });
  const tasks = await prisma.task.findMany({ where: { who: "сайт" } });
  assert.equal(tasks.length, 1);
  assert.match(tasks[0].title, /Перезвонить: Петро, \+380 \(93\) 000-11-22 — .+\(/);
  assert.ok(tasks[0].notifiedAt && tasks[0].dueAt, "напоминание уже отправлено — фоновые задачи не повторят");
  assert.deepEqual(await plus.requestCallback({ phone: "12" }, { lang: "uk" }), { ok: false, error: "errPhone" });

  // слияние «телеграм-дубля» с клиентом по телефону: подписки и отзывы переходят, одинаковые не дублируются
  const clients = await import("../src/clients");
  const byPhone = await prisma.client.create({ data: { phone: "+380500000009" } });
  const byTg = await prisma.client.create({ data: { tgId: 7009n } });
  await plus.subscribeWatch(byPhone.id, a.id, "PRICE");
  await plus.subscribeWatch(byTg.id, a.id, "PRICE");
  await plus.subscribeWatch(byTg.id, a.id, "STOCK");
  const m = await clients.linkTelegramPhone({ tgId: 7009n, phone: "+380500000009", name: null, username: null });
  assert.equal(m.merged, true);
  assert.deepEqual((await plus.watchesFor(byPhone.id, a.id)).sort(), ["PRICE", "STOCK"]);
});
