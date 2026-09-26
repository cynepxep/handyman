// Фоновые задачи (шаг 4.8) на базе handyman_test: сводка один раз в день после 21:00, отчёт по понедельникам, напоминания по задачам,
// тревога о неудачной загрузке каталога. Telegram не настроен — сообщения остаются в Outbox (режим-заглушка).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let jobs: typeof import("../src/jobs");
let orders: typeof import("../src/orders");
let svc: typeof import("../src/service");
let sku = "";

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  await prisma.task.deleteMany();
  jobs = await import("../src/jobs");
  orders = await import("../src/orders");
  svc = await import("../src/service");
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  sku = (await prisma.product.findFirstOrThrow({ where: { visible: true }, orderBy: { sku: "asc" } })).sku;
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

const managerMsgs = () => prisma.outbox.findMany({ where: { audience: "manager" }, orderBy: { createdAt: "asc" } });

test("сводка: до 21:00 — нет, после — одна (повторный запуск не шлёт); суммы можно скрыть", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await orders.placeManualOrder({ phone: "+380935556600", name: "Сводка", items: [{ sku, qty: 1 }], delivery: "to_confirm", pay: "later", city: "", npPoint: "", address: "", comment: "", isTest: false }, "test");
  assert.ok(r.ok);
  const now = new Date();
  const ymd = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  // «сегодня 20:30» и «сегодня 21:05» по Киеву: берём сегодняшнюю дату и подставляем часы
  const { kyivDayStart } = await import("@handyman/core/shop");
  const at = (h: number, m: number) => new Date(kyivDayStart(ymd).getTime() + (h * 60 + m) * 60_000); // верно и летом, и зимой
  const before1 = (await managerMsgs()).length;
  assert.equal((await jobs.runJobs(at(20, 30))).daily, false);
  const first = await jobs.runJobs(at(21, 5));
  assert.equal(first.daily, true);
  assert.equal((await jobs.runJobs(at(21, 6))).daily, false, "второй раз не шлём");
  const msgs = await managerMsgs();
  const summary = msgs.slice(before1).find((m) => m.text.startsWith("📊 Сводка"));
  assert.ok(summary);
  assert.match(summary!.text, /Заказов: 1/);
  assert.match(summary!.text, /Продажи: /);
  assert.match(summary!.text, /Ждут действия: 1/);
  await jobs.saveNotify({ showMoney: false }, "test");
  assert.doesNotMatch(await jobs.dailySummaryText(await jobs.loadNotify(), ymd), /Продажи:/);
  await jobs.saveNotify({}, "test");
});

test("отчёт недели — только в понедельник после 9:00 и один раз за неделю", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const mon = new Date("2030-01-07T07:30:00Z"); // понедельник 9:30 по Киеву
  assert.equal((await jobs.runJobs(new Date("2030-01-08T07:30:00Z"))).weekly, false, "вторник");
  assert.equal((await jobs.runJobs(mon)).weekly, true);
  assert.equal((await jobs.runJobs(new Date("2030-01-07T12:00:00Z"))).weekly, false);
  const w = (await managerMsgs()).find((m) => m.text.startsWith("🗓 Неделя 31.12–06.01"));
  assert.ok(w);
});

test("напоминания: задача в срок — одно сообщение менеджерам; выполненные и будущие — нет; тревога о загрузке каталога — одна", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const now = new Date();
  await svc.createTask({ title: "перезвонить Петру", dueAt: new Date(now.getTime() - 60_000), assignee: "olya" }, "test");
  await svc.createTask({ title: "потом", dueAt: new Date(now.getTime() + 3600_000), assignee: null }, "test");
  const doneT = await svc.createTask({ title: "уже сделано", dueAt: new Date(now.getTime() - 60_000), assignee: null }, "test");
  await svc.setTaskDone(doneT.id, true, "test");
  const r1 = await jobs.runJobs(now);
  assert.equal(r1.reminders, 1);
  assert.equal((await jobs.runJobs(now)).reminders, 0);
  assert.ok((await managerMsgs()).some((m) => m.text === "⏰ Напоминание для olya: перезвонить Петру"));

  const sup = await prisma.supplier.findFirstOrThrow();
  await prisma.importRun.create({ data: { supplierId: sup.id, sourceKind: "url", status: "FAILED", error: "сайт поставщика не отвечает", finishedAt: now } });
  assert.equal((await jobs.runJobs(now)).alerts, 1);
  assert.equal((await jobs.runJobs(now)).alerts, 0);
  assert.ok((await managerMsgs()).some((m) => m.text.includes("Загрузка каталога не прошла: сайт поставщика не отвечает")));
});
