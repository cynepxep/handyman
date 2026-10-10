import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertReason, alertText, backupLevel, diskLevel, errorFingerprint, healthStatus, isClientDisconnect, isNextControlFlow, isStaleServerAction, telegramHealth, jobsLevel, makeErrorEntry, maskSensitive, maskUrl,
  normalizeMessage, parseLogArgs, stackTop, type ErrorGroupState,
} from "../src/errors";

test("маска: токены, пароли в адресах, телефоны, почта, имя и адрес покупателя не попадают в журнал", () => {
  const cases: Array<[string, string[]]> = [
    ["fetch https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage failed", ["AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"]],
    ["connect postgresql://handyman:SuperPass1@db:5432/handyman", ["SuperPass1"]],
    ["Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def", ["eyJhbGciOiJIUzI1NiJ9"]],
    ["X-Token=uAbCdEfGh12345 rejected", ["uAbCdEfGh12345"]],
    ["клиент +380 67 123 45 67 не найден", ["123 45 67"]],
    ["phone 0671234567, запасной (050) 765-43-21", ["0671234567", "765-43-21"]],
    ["380931112233 уже есть", ["380931112233"]],
    ["письмо ivan.petrenko@gmail.com не ушло", ["ivan.petrenko@gmail.com"]],
    ['{"recipientName":"Іван Петренко","address":"вул. Шевченка 5","phone":"+380671234567"}', ["Іван", "Шевченка", "671234567"]],
    ["password=qwerty123 wrong", ["qwerty123"]],
  ];
  for (const [src, leaks] of cases) {
    const out = maskSensitive(src);
    for (const l of leaks) assert.ok(!out.includes(l), `${src} → ${out}`);
  }
  // полезное для разбора — остаётся
  assert.equal(maskSensitive("Заказ HM-0042: оплата не прошла (код 1005)"), "Заказ HM-0042: оплата не прошла (код 1005)");
  assert.match(maskSensitive("connect ECONNREFUSED 127.0.0.1:7700"), /ECONNREFUSED 127\.0\.0\.1:7700/);
});

test("маска: ошибка Prisma — без аргументов запроса (там имя и телефон)", () => {
  const msg = [
    "",
    "Invalid `prisma.order.create()` invocation in",
    "/app/packages/db/src/orders.ts:120:5",
    "",
    "  117 const order = await tx.order.create({",
    "  data: {",
    '    recipientName: "Іван Петренко",',
    '    phone: "+380671234567",',
    "  }",
    "Argument `total` is missing.",
  ].join("\n");
  const out = maskSensitive(msg);
  assert.ok(!out.includes("Петренко") && !out.includes("671234567"), out);
  assert.match(out, /Invalid `prisma\.order\.create\(\)` invocation … Argument `total` is missing\./);
});

test("адрес страницы: путь остаётся, ключи и поиск — нет", () => {
  assert.equal(maskUrl("/order/HM-0042?k=secretKey123"), "/order/HM-0042?k=…");
  assert.equal(maskUrl("/catalog/drills?page=2&q=0671234567"), "/catalog/drills?page=2&q=…");
  assert.equal(maskUrl("https://shop.ua/api/keycrm/webhook?secret=abc"), "/api/keycrm/webhook?secret=…");
  assert.equal(maskUrl(null), "");
});

test("группировка: одинаковые по смыслу ошибки — один отпечаток, разные — разные", () => {
  const a = errorFingerprint({ source: "service", where: "payments", message: "счёт для HM-0042 не создан: 502 Bad Gateway (id 3fa85f64-5717-4562-b3fc-2c963f66afa6)" });
  const b = errorFingerprint({ source: "service", where: "payments", message: "счёт для HM-0107 не создан: 503 Bad Gateway (id 0e8b3c1a-1111-4222-8333-444455556666)" });
  const c = errorFingerprint({ source: "service", where: "receipts", message: "счёт для HM-0042 не создан: 502 Bad Gateway" });
  const d = errorFingerprint({ source: "page", where: "payments", message: "счёт для HM-0042 не создан: 502 Bad Gateway (id 3fa85f64-5717-4562-b3fc-2c963f66afa6)" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.equal(normalizeMessage('Cannot read "x" of 12 items'), "Cannot read <s> of <n> items");
  // номер строки в стеке не меняет группу, другое место в коде — меняет
  const st = (line: number, file = "orders.ts") => `Error: x\n    at fn (/home/u/node_modules/next/x.js:1:1)\n    at createOrder (/home/u/handyman/packages/db/src/${file}:${line}:7)`;
  assert.equal(stackTop(st(10)), "createOrder (packages/db/src/orders.ts");
  assert.equal(errorFingerprint({ source: "action", where: "", message: "x", stack: st(10) }), errorFingerprint({ source: "action", where: "", message: "x", stack: st(99) }));
  assert.notEqual(errorFingerprint({ source: "action", where: "", message: "x", stack: st(10) }), errorFingerprint({ source: "action", where: "", message: "x", stack: st(10, "stock.ts") }));
});

test("запись «как console.error»: метка в скобках — «где», ошибка — текст и стек", () => {
  const e = new Error("timeout");
  const r = parseLogArgs(["[payments] счёт для HM-0001 не создан:", e]);
  assert.equal(r.where, "payments");
  assert.equal(r.message, "счёт для HM-0001 не создан: timeout");
  assert.equal(r.stack, e.stack);
  assert.deepEqual(parseLogArgs(["просто текст"]), { where: "", message: "просто текст", stack: "" });
  const entry = makeErrorEntry({ source: "service", where: r.where, message: r.message, stack: r.stack, url: "/pay?token=1" });
  assert.equal(entry.url, "/pay?token=…");
  assert.equal(entry.fingerprint.length, 24);
  assert.equal(makeErrorEntry({ source: "jobs", message: "x".repeat(2000) }).message.length, 500);
});

test("служебные redirect/notFound Next.js — не ошибки", () => {
  assert.ok(isNextControlFlow({ digest: "NEXT_REDIRECT;replace;/admin;307;" }));
  assert.ok(isNextControlFlow({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }));
  assert.ok(!isNextControlFlow(new Error("boom")));
  assert.ok(!isNextControlFlow({ digest: "12345" }));
});

test("форма со страницы до обновления сайта («Failed to find Server Action») — не ошибка", () => {
  const stale = new Error("Failed to find Server Action. This request might be from an older or newer deployment.\nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action");
  assert.ok(isStaleServerAction(stale));
  assert.ok(isStaleServerAction(Object.assign(new Error("other text"), { __NEXT_ERROR_CODE: "E975" })));
  assert.ok(!isStaleServerAction(new Error("Failed to load order")));
  assert.ok(!isStaleServerAction("Failed to find Server Action"));
  assert.ok(!isStaleServerAction(null));
});

test("покупатель ушёл, не дождавшись страницы («The destination stream closed early») — не ошибка", () => {
  assert.ok(isClientDisconnect(new Error("The destination stream closed early.")));
  assert.ok(!isClientDisconnect(new Error("The destination stream closed early. Also something else")));
  assert.ok(!isClientDisconnect(new Error("Failed to load product")));
  assert.ok(!isClientDisconnect("The destination stream closed early."));
  assert.ok(!isClientDisconnect(null));
});

test("тревоги: новая группа, всплеск ≥ 20 за 10 минут, не чаще раза в час; браузер — только всплеск", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const min = (m: number) => new Date(now.getTime() - m * 60_000);
  const g = (x: Partial<ErrorGroupState>): ErrorGroupState => ({
    source: "service", lastAt: min(0), windowAt: min(1), windowCount: 1, alertedAt: null, reopenedAt: null, closedAt: null, ...x,
  });
  assert.equal(alertReason(g({}), now), "new");
  assert.equal(alertReason(g({ alertedAt: min(5) }), now), null, "только что тревожили");
  assert.equal(alertReason(g({ alertedAt: min(90) }), now), null, "старая группа, без всплеска — молчим");
  assert.equal(alertReason(g({ alertedAt: min(90), windowCount: 25, windowAt: min(8) }), now), "spike");
  assert.equal(alertReason(g({ alertedAt: min(30), windowCount: 25, windowAt: min(8) }), now), null, "всплеск, но тревога была < часа назад");
  assert.equal(alertReason(g({ alertedAt: min(90), windowCount: 25, windowAt: min(300) }), now), null, "всплеск давно прошёл");
  assert.equal(alertReason(g({ alertedAt: min(90), reopenedAt: min(1) }), now), "new", "вернулась после «Закрыть»");
  assert.equal(alertReason(g({ closedAt: min(1) }), now), null);
  assert.equal(alertReason(g({ source: "browser" }), now), null);
  assert.equal(alertReason(g({ source: "browser", windowCount: 20 }), now), "spike");
  const t = alertText([{ reason: "new", source: "service", where: "payments", message: "ошибка", count: 1, windowCount: 1 }], 2);
  assert.match(t, /Новая ошибка \(сервис · payments\): ошибка/);
  assert.match(t, /ещё 2/);
});

test("здоровье: уровни и итог для внешнего сторожа", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  assert.equal(jobsLevel(new Date(now.getTime() - 2 * 60_000), now), "ok");
  assert.equal(jobsLevel(new Date(now.getTime() - 30 * 60_000), now), "warn");
  assert.equal(jobsLevel(new Date(now.getTime() - 3 * 3600_000), now), "bad");
  assert.equal(jobsLevel(null, now), "warn");
  const GB = 1024 ** 3;
  assert.equal(diskLevel(50 * GB, 100 * GB), "ok");
  assert.equal(diskLevel(10 * GB, 100 * GB), "warn");
  assert.equal(diskLevel(0.5 * GB, 100 * GB), "bad");
  assert.equal(backupLevel(new Date(now.getTime() - 5 * 3600_000), now), "ok");
  assert.equal(backupLevel(new Date(now.getTime() - 50 * 3600_000), now), "warn");
  assert.equal(backupLevel(null, now), "warn");
  assert.equal(healthStatus([{ key: "db", level: "ok", text: "" }, { key: "backup", level: "bad", text: "" }]), "ok");
  assert.equal(healthStatus([{ key: "db", level: "bad", text: "" }]), "error");
  assert.equal(healthStatus([{ key: "search", level: "bad", text: "" }]), "error");
  assert.equal(healthStatus([{ key: "telegram", level: "bad", text: "" }]), "ok", "сторож не будят из-за Telegram");
});

test("здоровье: сообщения в Telegram — нет ID чата / последнее не ушло / всё хорошо", () => {
  const noChat = telegramHealth({ token: true, chat: false, last: null, sentDay: 0 });
  assert.equal(noChat.level, "bad");
  assert.match(noChat.text, /не указан ID чата для уведомлений.*\/chatid/);
  assert.match(telegramHealth({ token: false, chat: false, last: null, sentDay: 0 }).text, /токен бота и ID чата/);
  const failed = telegramHealth({ token: true, chat: true, last: { state: "FAILED", error: "Telegram 400: chat not found" }, sentDay: 3 });
  assert.equal(failed.level, "bad");
  assert.match(failed.text, /chat not found/);
  assert.deepEqual(telegramHealth({ token: true, chat: true, last: { state: "SENT", error: null }, sentDay: 3 }), { level: "ok", text: "настроены; за сутки отправлено: 3" });
});
