// Защита (шаг 8.3) на базе handyman_test: лимиты в базе, повторный заказ, чёрный список («подозрительный», без KeyCRM),
// перебор пароля админки с одного адреса + тревога, «Проверка перед запуском».
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let rl: typeof import("../src/rate-limit");
let orders: typeof import("../src/orders");
let clients: typeof import("../src/clients");
let staff: typeof import("../src/staff");
let kc: typeof import("../src/keycrm");
let core: typeof import("@handyman/core");
let sku: string;
let sku2: string;

const form = (over: Record<string, unknown> = {}) => ({
  firstName: "Іван", lastName: "Петренко", phone: "093 111 22 33", delivery: "np", npType: "warehouse", city: "Київ", npPoint: "12", pay: "prepay",
  items: [{ sku, qty: 1 }], ...over,
});

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  rl = await import("../src/rate-limit");
  orders = await import("../src/orders");
  clients = await import("../src/clients");
  staff = await import("../src/staff");
  kc = await import("../src/keycrm");
  core = await import("@handyman/core");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const two = await prisma.product.findMany({ where: { supplierAvailable: true, visible: true }, orderBy: { sku: "asc" }, take: 2 });
  [sku, sku2] = [two[0].sku, two[1].sku];
  await prisma.staffSession.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.role.upsert({ where: { key: "owner" }, update: {}, create: { key: "owner", title: "Владелец", builtin: true } });
  const { salt, hash } = core.hashPassword("Owner-pass-123");
  await prisma.staff.create({ data: { username: "owner", name: "Владелец", roleKey: "owner", passwordSalt: salt, passwordHash: hash } });
  ready = true;
});

after(async () => {
  if (ready) {
    process.env.HM_ORDER_DEDUPE = "off";
    await kc.keycrmSettled();
    await prisma.$disconnect();
  }
  cleanup();
});

test("лимит в базе: N раз можно, дальше нет; у каждого свой счётчик; окно кончилось — снова можно; одновременные попытки не проскакивают", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const at = new Date("2026-09-30T10:00:10Z");
  for (let i = 1; i <= 3; i++) assert.equal((await rl.rateHit("callback", "1.1.1.1", at)).ok, true, `попытка ${i}`);
  const over = await rl.rateHit("callback", "1.1.1.1", at);
  assert.equal(over.ok, false);
  assert.equal(over.count, 4);
  assert.equal(over.retryAfterSec, 590);
  assert.equal((await rl.rateBlocked("callback", "1.1.1.1", at)).ok, false);
  assert.equal((await rl.rateHit("callback", "2.2.2.2", at)).ok, true, "другой адрес — свой счётчик");
  assert.equal((await rl.rateHit("order", "1.1.1.1", at)).ok, true, "другое правило — свой счётчик");
  assert.equal((await rl.rateHit("callback", "1.1.1.1", new Date("2026-09-30T10:10:01Z"))).ok, true, "новое окно");
  // адрес в базе — только хешем
  assert.equal(await prisma.rateLimit.count({ where: { key: { contains: "1.1.1.1" } } }), 0);
  // 12 одновременных попыток при лимите 10 → ровно 10 прошли
  const burst = await Promise.all(Array.from({ length: 12 }, () => rl.rateHit("clientError", "3.3.3.3", at)));
  assert.equal(burst.filter((r) => r.ok).length, 10);
  await rl.rateReset("callback", "1.1.1.1", at);
  assert.equal((await rl.rateBlocked("callback", "1.1.1.1", at)).ok, true, "после сброса — снова можно");
  // чистка отработавших окон
  const removed = await rl.pruneRateLimits(new Date("2026-10-01T00:00:00Z"));
  assert.ok(removed >= 4);
  assert.equal(await prisma.rateLimit.count({ where: { expiresAt: { lt: new Date("2026-10-01T00:00:00Z") } } }), 0);
});

test("повторный заказ: тот же телефон и та же корзина за 10 минут — открывается первый, менеджеру одно сообщение; другое количество — новый", async (t) => {
  if (!ready) return t.skip(skipMsg);
  process.env.HM_ORDER_DEDUPE = "on";
  try {
    const a = await orders.placeOrder(form({ items: [{ sku, qty: 1 }, { sku: sku2, qty: 2 }] }), { lang: "uk" });
    assert.ok(a.ok && !a.duplicate);
    // тот же номер в другом виде, товары в другом порядке, другая доставка — всё равно повтор
    const b = await orders.placeOrder(form({ phone: "+380931112233", items: [{ sku: sku2, qty: 2 }, { sku, qty: 1 }], city: "Одеса" }), { lang: "uk" });
    assert.ok(b.ok && b.duplicate);
    if (!a.ok || !b.ok) return;
    assert.equal(b.no, a.no);
    assert.equal(b.accessKey, a.accessKey, "ссылка на тот же заказ «Дякуємо»");
    const first = await prisma.order.findUniqueOrThrow({ where: { no: a.no } });
    assert.equal(await prisma.order.count({ where: { recipientPhone: "+380931112233" } }), 1);
    assert.equal(await prisma.outbox.count({ where: { orderId: first.id } }), 1, "менеджеру — одно сообщение");
    // другое количество — это уже другой заказ
    const c = await orders.placeOrder(form({ items: [{ sku, qty: 2 }, { sku: sku2, qty: 2 }] }), { lang: "uk" });
    assert.ok(c.ok && !c.duplicate && c.no !== a.no);
    // отменённый не считается: тот же заказ после отмены можно оформить снова
    await prisma.order.update({ where: { id: first.id }, data: { status: "CANCELLED" } });
    const d = await orders.placeOrder(form({ items: [{ sku, qty: 1 }, { sku: sku2, qty: 2 }] }), { lang: "uk" });
    assert.ok(d.ok && !d.duplicate && d.no !== a.no);
    // заказ сотрудника (тестовый) не склеивается
    const t1 = await orders.placeOrder(form({ phone: "093 111 22 44" }), { lang: "uk", isTest: true });
    const t2 = await orders.placeOrder(form({ phone: "093 111 22 44" }), { lang: "uk", isTest: true });
    assert.ok(t1.ok && t2.ok && t1.no !== t2.no);
    // двойное нажатие: два одновременных заказа — создаётся один
    const [x, y] = await Promise.all([orders.placeOrder(form({ phone: "093 111 22 55" }), { lang: "uk" }), orders.placeOrder(form({ phone: "093 111 22 55" }), { lang: "uk" })]);
    assert.ok(x.ok && y.ok && x.no === y.no);
    assert.equal(await prisma.order.count({ where: { recipientPhone: "+380931112255" } }), 1);
    // «1 клік»: повтор того же товара — тот же номер
    const o1 = await orders.placeOneClick({ sku, phone: "093 111 22 66" }, { lang: "uk" });
    const o2 = await orders.placeOneClick({ sku, phone: "0931112266" }, { lang: "uk" });
    assert.ok(o1.ok && o2.ok && o2.duplicate && o1.no === o2.no);
  } finally {
    process.env.HM_ORDER_DEDUPE = "off";
  }
});

test("чёрный список: заказ принимается, но «подозрительный», в KeyCRM сам не уходит; менеджер снимает отметку; разблокировка — в истории", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await kc.setKeycrmEnabled(true, "Владелец");
  try {
    assert.deepEqual(await clients.blockPhone("12", "", "Менеджер"), { ok: false, error: "Телефон не распознан. Пример: 067 123 45 67." });
    const bl = await clients.blockPhone("067 777 00 11", "  не забирает   посылки ", "Менеджер");
    assert.ok(bl.ok);
    if (!bl.ok) return;
    const c = await prisma.client.findUniqueOrThrow({ where: { id: bl.id }, include: { auditEntries: true } });
    assert.ok(c.blockedAt && c.blockedNote === "не забирает посылки" && c.blockedBy === "Менеджер");
    assert.equal(c.auditEntries[0].field, "чёрный список");
    assert.equal(await clients.isPhoneBlocked("+380677770011"), true);

    const r = await orders.placeOrder(form({ phone: "067 777 00 11" }), { lang: "uk" });
    assert.ok(r.ok, "покупателю — обычное «Дякуємо»");
    if (!r.ok) return;
    await kc.keycrmSettled();
    const o = await prisma.order.findUniqueOrThrow({ where: { no: r.no }, include: { history: true, outboxEntries: true } });
    assert.equal(o.suspicious, "blocked");
    assert.equal(o.keycrmState, null, "в KeyCRM сам не ушёл");
    assert.match(o.history[0].text, /Подозрительный/);
    assert.match(o.outboxEntries[0].text, /ПОДОЗРИТЕЛЬНЫЙ/);
    // обычный покупатель при включённой передаче — уходит
    const ok = await orders.placeOrder(form({ phone: "067 777 00 22" }), { lang: "uk" });
    assert.ok(ok.ok);
    await kc.keycrmSettled();
    if (ok.ok) assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: ok.no } })).suspicious, null);
    if (ok.ok) assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: ok.no } })).keycrmState, "sent");
    // «1 клік» — тоже помечается
    const oc = await orders.placeOneClick({ sku, phone: "+380677770011" }, { lang: "uk" });
    assert.ok(oc.ok);
    if (oc.ok) assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: oc.no } })).suspicious, "blocked");
    // «Передзвоніть мені» — с пометкой
    const plus = await import("../src/storefront-plus");
    assert.ok((await plus.requestCallback({ phone: "067 777 00 11" }, { lang: "uk" })).ok);
    assert.match((await prisma.task.findFirstOrThrow({ where: { who: "сайт" }, orderBy: { createdAt: "desc" } })).title, /^⚠️ чёрный список/);
    // менеджер проверил — снимает отметку (один раз), кнопка KeyCRM дальше работает как обычно
    assert.equal(await orders.clearSuspicious(o.id, "Менеджер"), true);
    assert.equal(await orders.clearSuspicious(o.id, "Менеджер"), false);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).suspicious, null);
    assert.ok((await kc.sendOrderToKeycrm(o.id, "Менеджер")).ok);
    // разблокировать: следующий заказ обычный
    assert.deepEqual(await clients.setClientBlocked(bl.id, false, "", "Владелец"), { ok: true });
    const after = await prisma.client.findUniqueOrThrow({ where: { id: bl.id }, include: { auditEntries: { orderBy: { ts: "desc" } } } });
    assert.equal(after.blockedAt, null);
    assert.equal(after.auditEntries[0].newValue, "нет");
    const r2 = await orders.placeOrder(form({ phone: "067 777 00 11", items: [{ sku: sku2, qty: 1 }] }), { lang: "uk" });
    if (r2.ok) assert.equal((await prisma.order.findUniqueOrThrow({ where: { no: r2.no } })).suspicious, null);
    // в списке «чёрный список» — только заблокированные
    await clients.setClientBlocked(bl.id, true, "снова", "Владелец");
    const list = await clients.listClients({ blocked: true });
    assert.deepEqual(list.rows.map((x) => x.id), [bl.id]);
  } finally {
    await kc.setKeycrmEnabled(false, "Владелец");
  }
});

test("вход в админку: 5 неудач с одного адреса — адрес закрыт на 15 минут (даже верный пароль), другой адрес входит; тревога один раз", async (t) => {
  if (!ready) return t.skip(skipMsg);
  // перебор разных логинов с одного адреса: блокировка учётной записи не поможет — работает лимит по адресу
  for (let i = 0; i < 5; i++) assert.equal((await staff.passwordStep(`guess${i}`, "x", null, "6.6.6.6")).ok, false);
  const blocked = await staff.passwordStep("owner", "Owner-pass-123", null, "6.6.6.6");
  assert.ok(!blocked.ok && blocked.error.includes("с этого устройства"));
  const other = await staff.passwordStep("owner", "Owner-pass-123", null, "7.7.7.7");
  assert.ok(other.ok, "с другого адреса владелец входит");
  assert.equal(await prisma.auditLog.count({ where: { action: "login.ip.locked" } }), 1);
  const alerts = await prisma.outbox.findMany({ where: { text: { contains: "Перебор паролей" } } });
  assert.equal(alerts.length, 1, "тревога — одна");
  assert.match(alerts[0].text, /6\.6\.6\.6/);
  // ещё неудачи с того же адреса в этом часу — без новой тревоги
  await staff.passwordStep("owner", "bad", null, "6.6.6.6");
  assert.equal(await prisma.outbox.count({ where: { text: { contains: "Перебор паролей" } } }), 1);

  // 5 неверных паролей к одному логину с разных адресов — учётная запись закрыта, тревога о логине
  for (let i = 0; i < 5; i++) await staff.passwordStep("owner", "wrong", null, `8.8.8.${i}`);
  assert.equal(await prisma.outbox.count({ where: { text: { contains: "Вход «owner» в админку закрыт" } } }), 1);
  await prisma.staff.update({ where: { username: "owner" }, data: { lockedUntil: null, failedLogins: 0 } });

  // удачный вход сбрасывает счётчик адреса: 4 ошибки + вход + 4 ошибки — адрес не закрыт
  for (let i = 0; i < 4; i++) await staff.passwordStep("owner", "wrong", null, "9.9.9.9");
  assert.ok((await staff.passwordStep("owner", "Owner-pass-123", null, "9.9.9.9")).ok);
  await prisma.staff.update({ where: { username: "owner" }, data: { failedLogins: 0 } });
  for (let i = 0; i < 4; i++) await staff.passwordStep("owner", "wrong", null, "9.9.9.9");
  await prisma.staff.update({ where: { username: "owner" }, data: { lockedUntil: null, failedLogins: 0 } });
  assert.ok((await staff.passwordStep("owner", "Owner-pass-123", null, "9.9.9.9")).ok);

  // тревоги выключены в «Уведомлениях» — не пишем
  const { saveNotify, loadNotify } = await import("../src/jobs");
  const s = await loadNotify();
  await saveNotify({ ...s, alerts: false }, "test");
  for (let i = 0; i < 5; i++) await staff.passwordStep(`nobody${i}`, "x", null, "5.5.5.5");
  assert.equal(await prisma.outbox.count({ where: { text: { contains: "5.5.5.5" } } }), 0);
  await saveNotify(s, "test");
});

test("проверка перед запуском: пароль owner «change-me» и временная учётка видны; ключи наружу не отдаются", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const lc = await import("../src/launch-check");
  const { salt, hash } = core.hashPassword("change-me");
  await prisma.staff.update({ where: { username: "owner" }, data: { passwordSalt: salt, passwordHash: hash } });
  const tmp = core.hashPassword("Tmp-pass-12345");
  await prisma.staff.create({ data: { username: "claude-test", name: "tmp", roleKey: "owner", passwordSalt: tmp.salt, passwordHash: tmp.hash } });
  try {
    const facts = await lc.launchFacts();
    assert.equal(facts.owner.defaultPassword, true);
    assert.equal(facts.tmp.account, true);
    const items = await lc.launchCheck();
    const st = Object.fromEntries(items.map((i) => [i.id, i.status]));
    assert.equal(st["owner-password"], "fail");
    assert.equal(st["tmp-login"], "fail");
    assert.equal(st["owner-2fa"], "fail");
    assert.ok(items.some((i) => i.id === "integration-telegram"));
    const text = JSON.stringify(items);
    for (const v of [process.env.DATABASE_URL, process.env.MEILI_MASTER_KEY].filter((x): x is string => Boolean(x && x.length > 8))) assert.ok(!text.includes(v), "значения ключей не показываются");
  } finally {
    await prisma.staff.deleteMany({ where: { username: "claude-test" } });
  }
});
