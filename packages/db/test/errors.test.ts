// Журнал ошибок и «здоровье» (шаг 8.2) на базе handyman_test: группировка одинаковых ошибок, маскирование при записи, окно «всплеска»,
// «Закрыть» и повторное открытие, тревога не чаще раза в час, чистка старше 30 дней, отметка фоновых задач и отчёт «здоровья».
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hm-health-"));
process.env.BACKUP_DIR = path.join(tmp, "backups");

let ready = false;
let prisma: typeof import("../src/client").prisma;
let errors: typeof import("../src/errors");
let health: typeof import("../src/health");

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  errors = await import("../src/errors");
  health = await import("../src/health");
  ready = true;
});

after(async () => {
  if (ready) {
    health.setHealthFetch(null);
    await prisma.$disconnect();
  }
  cleanup();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const T0 = new Date("2026-09-28T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

test("одинаковые ошибки — одна группа со счётчиком; телефон и токен в базу не попадают", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.errorLog.deleteMany();
  errors.recordError({ source: "service", where: "payments", message: "счёт для HM-0001 не создан: клиент +380671234567, token=abcdef123456" }, at(0));
  errors.recordError({ source: "service", where: "payments", message: "счёт для HM-0002 не создан: клиент +380501112233, token=zzzzzz999999" }, at(1));
  errors.recordError({ source: "service", where: "receipts", message: "чек не принят" }, at(1));
  await errors.errorsSettled();
  const rows = await prisma.errorLog.findMany({ orderBy: { where: "asc" } });
  assert.equal(rows.length, 2);
  const pay = rows.find((r) => r.where === "payments")!;
  assert.equal(pay.count, 2);
  assert.equal(pay.windowCount, 2);
  assert.ok(!/671234567|501112233|abcdef123456|zzzzzz999999/.test(pay.message), pay.message);
  assert.match(pay.message, /HM-0002/, "последний текст — в группе");
  assert.equal(pay.firstAt.toISOString(), at(0).toISOString(), "время в базе — как передано (UTC)");
  assert.equal(pay.lastAt.toISOString(), at(1).toISOString());
});

test("logError: пишет и в консоль, и в журнал; метка — «где», jobs — фоновые задачи", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.errorLog.deleteMany();
  const orig = console.error;
  const printed: unknown[][] = [];
  console.error = (...a: unknown[]) => void printed.push(a);
  try {
    errors.logError("[keycrm] заказ не отправлен:", new Error("503 Service Unavailable"));
    errors.logError("[jobs:daily]", new Error("boom"));
  } finally {
    console.error = orig;
  }
  await errors.errorsSettled();
  assert.equal(printed.length, 2);
  const rows = await prisma.errorLog.findMany({ orderBy: { where: "asc" } });
  assert.deepEqual(rows.map((r) => [r.source, r.where, r.message]), [["jobs", "jobs:daily", "boom"], ["service", "keycrm", "заказ не отправлен: 503 Service Unavailable"]]);
  assert.match(rows[0].stack, /errors\.test\.ts/);
});

test("всплеск: окно 10 минут; «Закрыть» и повтор — группа снова открыта; тревога — не чаще раза в час", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.errorLog.deleteMany();
  const sent: string[] = [];
  const send = async (s: string) => void sent.push(s);
  const e = { source: "service" as const, where: "novaposhta", message: "не отвечает" };
  errors.recordError(e, at(0));
  await errors.errorsSettled();
  assert.equal(await errors.alertErrors(send, at(1)), 1, "новая группа — тревога");
  assert.match(sent[0], /Новая ошибка \(сервис · novaposhta\): не отвечает/);
  assert.equal(await errors.alertErrors(send, at(2)), 0, "второй раз сразу — нет");

  // 25 раз за 5 минут через 2 часа — всплеск (запись по одной: разные секунды)
  for (let i = 0; i < 25; i++) errors.recordError(e, new Date(at(120).getTime() + i * 12_000));
  await errors.errorsSettled();
  let row = await prisma.errorLog.findFirstOrThrow();
  assert.equal(row.count, 26);
  assert.equal(row.windowCount, 25, "старое окно (2 часа назад) сброшено");
  assert.equal(await errors.alertErrors(send, at(126)), 1);
  assert.match(sent[1], /Всплеск: 25 раз за 10 мин/);
  assert.equal(await errors.alertErrors(send, at(130)), 0, "в течение часа — молчим");

  // «Закрыть» → повтор → снова открыта и тревога «новая» (прошёл час)
  assert.equal(await errors.closeErrors("all", "test", at(140)), 1);
  assert.equal((await errors.listErrors({ tab: "open" })).total, 0);
  errors.recordError(e, at(200));
  await errors.errorsSettled();
  row = await prisma.errorLog.findFirstOrThrow();
  assert.equal(row.closedAt, null);
  assert.equal(row.reopenedAt?.toISOString(), at(200).toISOString());
  assert.equal(await errors.alertErrors(send, at(201)), 1);
  assert.match(sent[2], /Новая ошибка/);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "errors.close" } }));
});

test("ошибки браузера: единичная — без тревоги; чистка старше 30 дней", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.errorLog.deleteMany();
  const sent: string[] = [];
  errors.recordError({ source: "browser", where: "витрина", message: "Script error.", url: "/order/HM-0001?k=secret" }, at(0));
  errors.recordError({ source: "jobs", where: "jobs:daily", message: "старая" }, new Date(T0.getTime() - 31 * 86400_000));
  await errors.errorsSettled();
  const b = await prisma.errorLog.findFirstOrThrow({ where: { source: "browser" } });
  assert.equal(b.url, "/order/HM-0001?k=…");
  assert.equal(await errors.alertErrors(async (s) => void sent.push(s), at(1)), 0);
  assert.equal(await errors.pruneErrors(at(1)), 1);
  assert.equal(await prisma.errorLog.count(), 1);
});

test("здоровье: база, поиск (подменённая сеть), фоновые задачи, диск, копий нет; итог для сторожа", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const now = new Date();
  health.setHealthFetch(async () => new Response(JSON.stringify({ status: "available" }), { status: 200 }));
  await health.markJobsRun(new Date(now.getTime() - 2 * 60_000));
  let r = await health.healthReport(now);
  const by = Object.fromEntries(r.checks.map((c) => [c.key, c]));
  assert.equal(r.status, "ok");
  assert.equal(by.db.level, "ok");
  assert.equal(by.search.level, "ok");
  assert.equal(by.jobs.level, "ok");
  assert.match(by.jobs.text, /2 мин назад/);
  assert.equal(by.backup.level, "warn");
  assert.match(by.backup.text, /копий ещё нет/);
  assert.ok(by.disk.text.startsWith("свободно"));
  assert.ok(by.errors);

  health.setHealthFetch(async () => {
    throw new Error("ECONNREFUSED");
  });
  r = await health.healthReport(now);
  assert.equal(r.status, "error", "поиск не отвечает — сторож должен узнать");
  assert.equal(r.checks.find((c) => c.key === "search")!.level, "bad");
});
