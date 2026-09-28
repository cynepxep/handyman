// KeyCRM (шаг 3.5) на базе handyman_test, сеть KeyCRM подменена: заглушка без ключа, переключатель (по умолчанию выключен),
// тестовый заказ — только кнопкой с подтверждением, тело заказа, «1 клік» и «по звонку», повтор без дубля (ответ потерялся),
// 8 неудач → тревога и кнопка, две кнопки одновременно, статусы: вебхук (секрет), таблица соответствия, авто-шаблон или PendingNotif, опрос.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

process.env.SECRETS_KEY = "test-secrets-key";
process.env.KEYCRM_API_KEY = "";
process.env.KEYCRM_SOURCE_ID = "";
process.env.KEYCRM_WEBHOOK_SECRET = "";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let orders: typeof import("../src/orders");
let kc: typeof import("../src/keycrm");
let sku = "";

const form = (over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: "093 366 24 07", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items: [{ sku, qty: 2 }], comment: "Після 18:00", ...over,
});

// ---------- подменённый KeyCRM ----------
type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };
const calls: Call[] = [];
const crm = new Map<number, { id: number; source_uuid: string; source_id: number; status_id: number }>();
let nextId = 500;
/** что делает POST /order: ok — создать; lost — создать, но ответ «не дошёл»; fail — 500 без создания */
let postMode: "ok" | "lost" | "fail" = "ok";
const reply = (status: number, body: unknown) => Promise.resolve({ status, json: () => Promise.resolve(body) });
const posts = () => calls.filter((c) => c.method === "POST");

async function fakeKeycrm(url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
  const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  calls.push({ url, method: init.method, headers: init.headers, body });
  if (init.headers.Authorization !== "Bearer test-keycrm-key-1234") return reply(401, { message: "Unauthenticated." });
  const u = new URL(url);
  const path = u.pathname.replace(/^\/v1/, "");
  if (init.method === "POST" && path === "/order") {
    if (postMode === "fail") return reply(500, { message: "Server Error" });
    const o = { id: nextId++, source_uuid: String(body!.source_uuid), source_id: Number(body!.source_id), status_id: 1 };
    crm.set(o.id, o);
    if (postMode === "lost") {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }
    return reply(201, { ...o, grand_total: 100 });
  }
  if (path === "/order" && init.method === "GET") {
    const want = u.searchParams.get("filter[source_uuid]");
    return reply(200, { data: [...crm.values()].filter((o) => !want || o.source_uuid === want), total: crm.size });
  }
  if (path === "/order/status") return reply(200, { data: [{ id: 1, name: "Новий", alias: "new" }, { id: 4, name: "Відправлено", alias: "shipped" }, { id: 5, name: "Узгодження" }, { id: 6, name: "Виконано", alias: "completed" }] });
  const m = path.match(/^\/order\/(\d+)$/);
  if (m) return crm.has(Number(m[1])) ? reply(200, crm.get(Number(m[1]))) : reply(404, { message: "Not found" });
  return reply(404, null);
}

const live = () => {
  process.env.KEYCRM_API_KEY = "test-keycrm-key-1234";
  process.env.KEYCRM_SOURCE_ID = "5";
};

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  orders = await import("../src/orders");
  kc = await import("../src/keycrm");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  sku = (await prisma.product.findFirstOrThrow({ where: { supplierAvailable: true, visible: true, price: { gt: 150 } }, orderBy: { sku: "asc" } })).sku;
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret", "WebhookLog", "OrderStatusTemplate"');
  kc.setKeycrmFetch(fakeKeycrm);
  ready = true;
});

after(async () => {
  if (ready) {
    kc.setKeycrmFetch(null);
    await prisma.$disconnect();
  }
  process.env.KEYCRM_API_KEY = "";
  cleanup();
});

const place = async (over: Record<string, unknown> = {}, isTest = false) => {
  const r = await orders.placeOrder(form(over), { lang: "uk", isTest });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) throw new Error("заказ не создан");
  await kc.keycrmSettled();
  return prisma.order.findUniqueOrThrow({ where: { no: r.no }, include: { items: true, history: true } });
};

test("заглушка без ключа: по умолчанию выключено; включили — новый заказ «передан» с тестовым номером, в сеть не ходим; тестовый — только кнопкой", async (t) => {
  if (!ready) return t.skip(skipMsg);
  assert.equal(await kc.keycrmMode(), "stub");
  assert.equal((await kc.loadKeycrmSettings()).enabled, false, "по умолчанию выключено");
  const off = await place();
  assert.equal(off.keycrmState, null, "передача выключена — заказ не в очереди");

  await kc.setKeycrmEnabled(true, "Владелец");
  const on = await place();
  assert.equal(on.keycrmState, "sent");
  assert.equal(on.keycrmId, String(900000 + on.seq));
  assert.equal(on.keycrmStub, true);
  assert.ok(on.history.some((h) => /Передан в KeyCRM: № \d+ \(заглушка/.test(h.text)));

  const tst = await place({}, true);
  assert.equal(tst.keycrmState, null, "тестовый заказ сам не уходит");
  assert.deepEqual(await kc.sendOrderToKeycrm(tst.id, "Менеджер"), { ok: false, error: "Это тестовый заказ: поставьте галочку «Отправить тестовый заказ с пометкой ТЕСТ»." });
  const r = await kc.sendOrderToKeycrm(tst.id, "Менеджер", { confirmTest: true });
  assert.ok(r.ok);
  const sent = await prisma.order.findUniqueOrThrow({ where: { id: tst.id } });
  assert.equal(sent.keycrmUuid, `TEST-${tst.no}`);
  assert.deepEqual(await kc.sendOrderToKeycrm(tst.id, "Менеджер", { confirmTest: true }), { ok: false, error: `Заказ уже в KeyCRM: № ${sent.keycrmId}.` });
  assert.equal(calls.length, 0, "заглушка в сеть не ходит");
  await kc.setKeycrmEnabled(false, "Владелец");
});

test("с ключом: заказ с сайта уходит сам — источник, номер, покупатель, товары по цене со скидкой, Нова Пошта; «1 клік» и «по звонку» тоже", async (t) => {
  if (!ready) return t.skip(skipMsg);
  live();
  await kc.setKeycrmEnabled(true, "Владелец");
  calls.length = 0;
  const o = await place();
  assert.equal(o.keycrmState, "sent");
  const post = posts()[0];
  assert.equal(post.url, "https://openapi.keycrm.app/v1/order");
  assert.equal(o.keycrmId, String(crm.get(Number(o.keycrmId))!.id));
  assert.equal(o.keycrmStatusId, 1);
  const b = post.body!;
  assert.equal(b.source_id, 5);
  assert.equal(b.source_uuid, o.no);
  assert.deepEqual(b.buyer, { full_name: "Петренко Іван", phone: "+380933662407" });
  assert.deepEqual(b.products, o.items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.qty, price: i.unitPrice.toNumber() })), "цена — из заказа (посчитана сервером)");
  assert.equal((b.shipping as Record<string, string>).shipping_service, "Нова Пошта");
  assert.equal(b.buyer_comment, "Після 18:00");

  const one = await orders.placeOneClick({ sku, qty: 1, phone: "0501112233" }, { lang: "uk" });
  assert.ok(one.ok);
  const man = await orders.placeManualOrder({ phone: "+380501112244", name: "Олег", items: [{ sku, qty: 1 }], delivery: "pickup", pay: "later", isTest: false, city: "", npPoint: "", address: "", comment: "" } as never, "Менеджер");
  assert.ok(man.ok, JSON.stringify(man));
  await kc.keycrmSettled();
  const two = await prisma.order.findMany({ where: { source: { in: ["one_click", "manual"] } }, orderBy: { seq: "asc" } });
  assert.deepEqual(two.map((x) => x.keycrmState), ["sent", "sent"]);
  assert.match(String(posts().at(-2)!.body!.manager_comment), /Купить в 1 клик/);
  assert.equal((posts().at(-1)!.body!.shipping as Record<string, string>).shipping_service, "Самовивіз");
  const test2 = await place({}, true);
  assert.equal(test2.keycrmState, null, "тестовый при включённой передаче тоже не уходит сам");
});

test("ответ KeyCRM потерялся: повтор находит созданный заказ по номеру — без дубля", async (t) => {
  if (!ready) return t.skip(skipMsg);
  live();
  postMode = "lost";
  const o = await place();
  assert.equal(o.keycrmState, "error");
  assert.equal(o.keycrmAttempts, 1);
  assert.match(o.keycrmError ?? "", /не ответил за 15 секунд/);
  assert.ok(o.keycrmNextTryAt && o.keycrmNextTryAt.getTime() - Date.now() > 50_000, "повтор через минуту");
  postMode = "ok";
  const before1 = posts().length;
  assert.equal(await kc.processKeycrm(new Date(Date.now() + 30_000)), 0, "время повтора ещё не пришло");
  await kc.processKeycrm(new Date(Date.now() + 2 * 60_000));
  const again = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
  assert.equal(again.keycrmState, "sent");
  assert.equal(posts().length, before1, "второй раз заказ не создавали");
  assert.equal([...crm.values()].filter((x) => x.source_uuid === o.no).length, 1);
});

test("KeyCRM недоступен: повторы, после 8 попыток — тревога менеджерам и только кнопка; две кнопки одновременно — один заказ", async (t) => {
  if (!ready) return t.skip(skipMsg);
  live();
  postMode = "fail";
  const o = await place();
  let now = Date.now();
  for (let i = 0; i < 10; i++) {
    now += 5 * 3600_000;
    await kc.processKeycrm(new Date(now));
  }
  const dead = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { outboxEntries: true } });
  assert.equal(dead.keycrmAttempts, 8);
  assert.equal(dead.keycrmNextTryAt, null, "дальше — только кнопкой");
  assert.match(dead.keycrmError ?? "", /временно недоступен \(код 500\)/);
  assert.equal(dead.outboxEntries.filter((m) => /не передан в KeyCRM \(8 попыток\)/.test(m.text)).length, 1);
  postMode = "ok";
  const before1 = posts().length;
  const [a, b] = await Promise.all([kc.sendOrderToKeycrm(o.id, "Менеджер"), kc.sendOrderToKeycrm(o.id, "Менеджер")]);
  assert.equal([a, b].filter((x) => x.ok).length, 1, JSON.stringify([a, b]));
  assert.equal(posts().length - before1, 1, "в KeyCRM ушёл один заказ");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).keycrmState, "sent");
});

test("статусы: вебхук только с секретом; таблица соответствия; нет авто-шаблона — PendingNotif; есть — сообщение; «не менять»; опрос", async (t) => {
  if (!ready) return t.skip(skipMsg);
  live();
  postMode = "ok";
  const set = await kc.refreshKeycrmStatuses("Владелец");
  assert.deepEqual(set.statuses.map((s) => s.name), ["Новий", "Відправлено", "Узгодження", "Виконано"]);
  await kc.saveKeycrmStatusMap({ "1": "NEW", "4": "SHIPPED", "5": "", "6": "DONE" }, "Владелец");
  await prisma.orderStatusTemplate.create({ data: { status: "DONE", titleUk: "Дякуємо", titleRu: "Спасибо", textUk: "Дякуємо за покупку, {name}!", textRu: "Спасибо!", autoSend: true } });

  const o = await place();
  const hook = (status_id: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ event: "order.change_order_status", context: { id: Number(o.keycrmId), status_id, source_uuid: o.no, source_id: 5, ...extra } });

  assert.equal(await kc.handleKeycrmWebhook(hook(4), "любой"), 403, "секрет вебхука не задан — не принимаем");
  process.env.KEYCRM_WEBHOOK_SECRET = "change-me-too";
  assert.equal(await kc.handleKeycrmWebhook(hook(4), "change-me-too"), 403, "шаблон из .env.example не принимаем");
  process.env.KEYCRM_WEBHOOK_SECRET = "long-webhook-secret-abc";
  assert.equal(await kc.handleKeycrmWebhook(hook(4), "чужой"), 403);
  assert.equal(await kc.handleKeycrmWebhook(hook(4), null), 403);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status, "NEW");

  assert.equal(await kc.handleKeycrmWebhook(hook(4), "long-webhook-secret-abc"), 200);
  let cur = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { history: true, pendingNotifs: true } });
  assert.equal(cur.status, "SHIPPED");
  assert.ok(cur.history.some((h) => /Статус: Отправлен \(KeyCRM\) — в KeyCRM: «Відправлено», вебхук KeyCRM/.test(h.text)), cur.history.map((h) => h.text).join("\n"));
  assert.deepEqual(cur.pendingNotifs.map((p) => [p.status, p.keycrmStatus, p.resolved]), [["SHIPPED", "Відправлено", false]]);
  const log = await prisma.webhookLog.findFirstOrThrow({ where: { source: "KEYCRM" } });
  assert.equal(JSON.stringify(log.body).includes("+380"), false, "в журнал — без телефона");

  assert.equal(await kc.handleKeycrmWebhook(hook(4, { buyer: { phone: "+380933662407" } }), "long-webhook-secret-abc"), 200, "повтор того же статуса");
  assert.equal(await prisma.pendingNotif.count({ where: { orderId: o.id } }), 1, "второй раз не напоминаем");

  assert.equal(await kc.handleKeycrmWebhook(hook(5), "long-webhook-secret-abc"), 200);
  cur = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { history: true, pendingNotifs: true } });
  assert.equal(cur.status, "SHIPPED", "«Узгодження» — не менять");
  assert.ok(cur.history.some((h) => /«Узгодження».*нет в таблице соответствия/.test(h.text)));

  assert.equal(await kc.resolvePendingNotifs(o.id), 1);

  // опрос: KeyCRM сменил статус, вебхук не дошёл
  crm.get(Number(o.keycrmId))!.status_id = 6;
  await prisma.order.update({ where: { id: o.id }, data: { keycrmCheckedAt: new Date(Date.now() - 11 * 60_000) } });
  await kc.processKeycrm();
  const done = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { outboxEntries: true, pendingNotifs: true } });
  assert.equal(done.status, "DONE");
  assert.ok(done.outboxEntries.some((m) => m.audience === "client" && /Дякуємо за покупку/.test(m.text)), "авто-шаблон ушёл покупателю");
  assert.equal(done.pendingNotifs.filter((p) => !p.resolved).length, 0, "есть авто-шаблон — напоминание не нужно");

  // первый раз узнали статус при опросе — только запоминаем (не откатываем заказ)
  const p2 = await place();
  await prisma.order.update({ where: { id: p2.id }, data: { status: "PAID", keycrmStatusId: null, keycrmCheckedAt: null } });
  await kc.processKeycrm();
  const p2n = await prisma.order.findUniqueOrThrow({ where: { id: p2.id } });
  assert.deepEqual([p2n.status, p2n.keycrmStatusId], ["PAID", 1]);
});

test("вебхук о заказе, ответ на создание которого потерялся: узнаём по номеру только из своего источника", async (t) => {
  if (!ready) return t.skip(skipMsg);
  live();
  process.env.KEYCRM_WEBHOOK_SECRET = "long-webhook-secret-abc";
  postMode = "fail";
  const o = await place();
  assert.equal(o.keycrmId, null);
  const hook = (source_id: number) => JSON.stringify({ event: "order.change_order_status", context: { id: 9999, status_id: 4, source_uuid: o.no, source_id } });
  assert.equal(await kc.handleKeycrmWebhook(hook(9), "long-webhook-secret-abc"), 200);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).keycrmId, null, "чужой источник (старый магазин) — не наш заказ");
  await kc.handleKeycrmWebhook(hook(5), "long-webhook-secret-abc");
  const cur = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
  assert.deepEqual([cur.keycrmId, cur.keycrmState, cur.status], ["9999", "sent", "SHIPPED"]);
  postMode = "ok";
});
