// Резервные копии (шаг 8.1): копия handyman_test (база + ключ + фото) → проверка восстановления во временную базу → строки сходятся,
// ключи «Интеграций» открываются; испорченная копия — тревога; вторая копия в «облако» (сеть подменена); хранение 14/8;
// ночной запуск из runJobs; восстановление в рабочую базу с копией «перед восстановлением».
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hm-backup-"));
process.env.BACKUP_DIR = path.join(tmpRoot, "backups");
process.env.MEDIA_DIR = path.join(tmpRoot, "media");
process.env.SECRETS_KEY = "test-secrets-key-backups";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let bk: typeof import("../src/backups");
let integ: typeof import("../src/integrations");
let offsite: typeof import("../src/offsite");

type Put = { method: string; url: string; size: number; auth: string };
const calls: Put[] = [];

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  bk = await import("../src/backups");
  integ = await import("../src/integrations");
  offsite = await import("../src/offsite");
  try {
    bk.pgRunner();
  } catch (e) {
    console.warn("Тест копий пропущен:", e instanceof Error ? e.message : e);
    return;
  }
  ready = true;
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret"');
  integ.resetSecretsKey();
  offsite.setOffsiteFetch(async (url, init) => {
    calls.push({ method: init.method, url, size: init.body?.byteLength ?? 0, auth: init.headers.authorization ?? "" });
    return { status: 200, text: async () => "<ListBucketResult/>" };
  });
  fs.mkdirSync(path.join(process.env.MEDIA_DIR!, "ab"), { recursive: true });
  fs.writeFileSync(path.join(process.env.MEDIA_DIR!, "ab", "ab01.webp"), "фото-1");
  fs.writeFileSync(path.join(process.env.MEDIA_DIR!, "ab", "ab02.webp"), "фото-2");
  await prisma.client.create({ data: { phone: "+380500000001", name: "Копия Тест" } });
  await integ.saveIntegration("telegram", { botToken: "123456789:AAtestTOKENtestTOKENtest9876" }, "тест");
});

after(async () => {
  if (ready) {
    await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret"');
    await prisma.setting.deleteMany({ where: { key: { startsWith: "backup." } } });
    offsite.setOffsiteFetch(null);
  }
  if (prisma) await prisma.$disconnect();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  cleanup();
});

test("копия: файл базы, ключ шифрования, фото; повторная копия фото не копирует заново", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const r = await bk.createBackup({ kind: "manual", who: "тест" });
  assert.equal(r.ok, true, r.error);
  const dir = path.join(process.env.BACKUP_DIR!, r.name);
  assert.ok(fs.statSync(path.join(dir, "db.dump")).size > 1024);
  assert.equal(fs.readFileSync(path.join(dir, "secrets.key"), "utf8").trim(), "test-secrets-key-backups");
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.equal(m.ok, true);
  assert.equal(m.counts.before.Client, 1);
  assert.equal(m.counts.after.IntegrationSecret, 1);
  assert.deepEqual([m.media.files, m.media.copied], [2, 2]);
  assert.equal(m.offsite ?? null, null, "второе хранилище не задано");
  assert.equal(fs.readFileSync(path.join(process.env.BACKUP_DIR!, "media", "ab", "ab01.webp"), "utf8"), "фото-1");
  assert.equal(await bk.currentLock(), null, "отметка «идёт копия» снята");

  await new Promise((res) => setTimeout(res, 1100)); // имя копии — с точностью до секунды
  const r2 = await bk.createBackup({ kind: "manual", who: "тест" });
  assert.deepEqual([r2.manifest.media?.files, r2.manifest.media?.copied], [2, 0]);
  const list = await bk.listBackups();
  assert.deepEqual(list.slice(0, 2).map((b) => b.name), [r2.name, r.name], "новые сверху");
  assert.ok(list.every((b) => b.state === "ok"));
});

test("проверка восстановления: временная база, строки сходятся, ключи открываются; временная база удалена", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.client.create({ data: { phone: "+380500000002", name: "После копии" } }); // в копии его нет — это нормально
  const v = await bk.verifyBackup({ who: "тест" });
  assert.equal(v.ok, true, v.problems.join("; "));
  assert.equal(v.counts?.Client, 1);
  assert.deepEqual(v.secrets, { total: 1, opened: 1 });
  const dbs = await prisma.$queryRawUnsafe<Array<{ datname: string }>>(`SELECT datname FROM pg_database WHERE datname LIKE '%restore_check%'`);
  assert.deepEqual(dbs, []);
  const newest = (await bk.listBackups())[0];
  assert.equal(newest.manifest?.check?.ok, true, "результат записан в копию");
  assert.equal((await bk.lastCheck())?.name, newest.name);
});

test("испорченная копия: проверка не проходит, тревога в Telegram (в тестах — заглушка в Outbox)", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const newest = (await bk.listBackups())[0];
  const dump = path.join(process.env.BACKUP_DIR!, newest.name, "db.dump");
  const good = fs.readFileSync(dump);
  fs.writeFileSync(dump, Buffer.concat([good.subarray(0, good.length - 100), Buffer.alloc(100, 7)]));
  const v = await bk.verifyBackup({ who: "тест" });
  assert.equal(v.ok, false);
  assert.match(v.problems.join(" "), /испорчен/);
  const alert = await prisma.outbox.findFirst({ where: { text: { contains: "Проверка резервной копии не прошла" } } });
  assert.ok(alert, "тревога записана");
  fs.writeFileSync(dump, good);
});

test("вторая копия в облаке: файл базы, ключ, описание и фото; старые копии удаляются и там; проверка подключения", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await integ.saveIntegration("backup", { endpoint: "https://acc.r2.cloudflarestorage.com", bucket: "hm-backups", accessKey: "AKTESTACCESSKEY123", secretKey: "sk-test-secret-key-000" }, "тест");
  calls.length = 0;
  const check = await integ.checkIntegration("backup", "тест");
  assert.equal(check.ok, true, check.message);
  assert.match(calls[0].url, /^https:\/\/acc\.r2\.cloudflarestorage\.com\/hm-backups\/\?list-type=2/);
  assert.match(calls[0].auth, /^AWS4-HMAC-SHA256 Credential=AKTESTACCESSKEY123\/\d{8}\/auto\/s3\/aws4_request/);

  // 16 старых копий раз в неделю (2025 год) + копии сегодня: 14 «ежедневных» = сегодня + 13 новых из старых, остальные 3 удаляются
  // (недельные — 8 последних недель — уже среди них) — и локально, и в облаке
  const olds = Array.from({ length: 16 }, (_, i) => `${new Date(Date.parse("2025-03-02T12:00:00Z") + i * 7 * 86400_000).toISOString().slice(0, 10)}_033000-auto`);
  for (const old of olds) {
    fs.mkdirSync(path.join(process.env.BACKUP_DIR!, old), { recursive: true });
    fs.writeFileSync(path.join(process.env.BACKUP_DIR!, old, "manifest.json"), JSON.stringify({ version: 1, name: old, kind: "auto", ok: true }));
  }
  const old = olds[0];
  calls.length = 0;
  const r = await bk.createBackup({ kind: "manual", who: "тест" });
  assert.equal(r.manifest.offsite?.ok, true, r.manifest.offsite?.error);
  const puts = calls.filter((c) => c.method === "PUT").map((c) => c.url.replace("https://acc.r2.cloudflarestorage.com/hm-backups/handyman/", ""));
  assert.deepEqual(puts.slice(0, 3), [`db/${r.name}/db.dump`, `db/${r.name}/secrets.key`, `db/${r.name}/manifest.json`]);
  assert.deepEqual(puts.slice(3).sort(), ["media/ab/ab01.webp", "media/ab/ab02.webp"]);
  assert.equal(r.manifest.offsite?.mediaUploaded, 2);
  assert.deepEqual(olds.filter((o) => !fs.existsSync(path.join(process.env.BACKUP_DIR!, o))), olds.slice(0, 3), "3 самые старые удалены");
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith(`handyman/db/${old}/db.dump`)), "и в облаке");

  // следующая копия: уже выгруженные фото не выгружаются
  await new Promise((res) => setTimeout(res, 1100));
  calls.length = 0;
  const r2 = await bk.createBackup({ kind: "manual", who: "тест" });
  assert.equal(r2.manifest.offsite?.mediaUploaded, 0);
  assert.equal(calls.filter((c) => c.method === "PUT").length, 3);

  // облако недоступно — копия всё равно готова, в ней пометка об ошибке
  offsite.setOffsiteFetch(async () => ({ status: 403, text: async () => "<Error><Code>AccessDenied</Code></Error>" }));
  await new Promise((res) => setTimeout(res, 1100));
  const r3 = await bk.createBackup({ kind: "manual", who: "тест" });
  assert.equal(r3.ok, true);
  assert.equal(r3.manifest.offsite?.ok, false);
  assert.match(r3.manifest.offsite?.error ?? "", /403 \(AccessDenied\)/);
  offsite.setOffsiteFetch(async (url, init) => {
    calls.push({ method: init.method, url, size: init.body?.byteLength ?? 0, auth: "" });
    return { status: 200, text: async () => "" };
  });
  for (const f of ["endpoint", "bucket", "accessKey", "secretKey"]) await integ.clearIntegrationField("backup", f, "тест");
});

test("ночью из runJobs: копия с 03:30 по Киеву один раз в день, в фоне; занято — вторая не начинается", async (t) => {
  if (!ready) return t.skip(skipMsg);
  process.env.HM_BACKUPS = "";
  try {
    const jobs = await import("../src/jobs");
    // сегодня (по Киеву) 03:40 — имя копии получит сегодняшнюю дату
    const ymd = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
    const offsetH = Number(new Date(`${ymd}T12:00:00Z`).toLocaleString("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" })) - 12;
    const due = new Date(Date.parse(`${ymd}T03:40:00Z`) - offsetH * 3600_000);
    assert.equal(await bk.runBackupJobs(new Date(due.getTime() - 20 * 60_000)), null, "03:20 — рано");
    const rep = await jobs.runJobs(due);
    assert.equal(rep.backup, "backup");
    assert.equal(await bk.runBackupJobs(due), null, "идёт — вторую не начинаем");
    await bk.backupSettled();
    const auto = (await bk.listBackups()).find((b) => b.kind === "auto" && b.name.startsWith(ymd));
    assert.equal(auto?.state, "ok");
    assert.equal(await bk.runBackupJobs(new Date(due.getTime() + 2 * 3600_000)), null, "сегодня уже есть — и проверка была недавно");
    assert.equal(await bk.startInBackground("check", "тест"), true, "кнопка «Проверить»");
    assert.equal(await bk.startInBackground("backup", "тест"), false, "пока идёт проверка — копия не начинается");
    await bk.backupSettled();
    assert.equal((await bk.lastCheck())?.ok, true);
  } finally {
    process.env.HM_BACKUPS = "off";
  }
});

test("восстановление в рабочую базу: данные копии, перед этим — копия текущей базы; ключ тот же", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const src = (await bk.listBackups()).find((b) => b.state === "ok")!;
  const clientsInCopy = src.manifest!.counts!.after.Client;
  await prisma.client.create({ data: { phone: "+380500000009", name: "Лишний" } });
  const before = await prisma.client.count();
  assert.equal(before, clientsInCopy + 1);
  const logs: string[] = [];
  const r = await bk.restoreBackup(path.join(process.env.BACKUP_DIR!, src.name), { log: (s) => logs.push(s) });
  assert.equal(await prisma.client.count(), clientsInCopy);
  assert.ok(r.safety && r.safety.endsWith("-pre-restore"));
  assert.equal(r.key, "same");
  assert.equal(await bk.currentLock(), null, "отметка «идёт копирование» из копии не мешает новым копиям");
  assert.deepEqual(r.media, { files: 2, copied: 0 });
  assert.equal(await integ.secret("telegram.botToken"), "123456789:AAtestTOKENtestTOKENtest9876", "ключи «Интеграций» читаются");
  // копия «перед восстановлением» содержит «лишнего» клиента — можно вернуться
  const safety = (await bk.listBackups()).find((b) => b.name === r.safety)!;
  assert.equal(safety.manifest?.counts?.after.Client, before);
});

test("восстановление самой старой копии: чистка после копии «перед восстановлением» её не удаляет", async (t) => {
  if (!ready) return t.skip(skipMsg);
  // как при переезде (шаг 8.5/8.4): копия с ПК старше всех, а новых «ручных» уже 5 — после 6-й самая старая ушла бы под чистку
  const dir = process.env.BACKUP_DIR!;
  const oldest = "2020-01-01_120000-manual";
  const src = (await bk.listBackups()).find((b) => b.state === "ok" && b.name.endsWith("-manual"))!;
  const copyAs = (name: string) => {
    fs.cpSync(path.join(dir, src.name), path.join(dir, name), { recursive: true });
    const mf = path.join(dir, name, "manifest.json");
    fs.writeFileSync(mf, JSON.stringify({ ...JSON.parse(fs.readFileSync(mf, "utf8")), name }));
  };
  copyAs(oldest);
  const extra = [1, 2, 3, 4, 5].map((i) => `2099-01-0${i}_120000-manual`);
  extra.forEach(copyAs);
  const r = await bk.restoreBackup(path.join(dir, oldest));
  assert.ok(r.safety, "копия текущей базы сделана");
  assert.ok(fs.existsSync(path.join(dir, oldest, "db.dump")), "копия, из которой восстанавливали, на месте");
  for (const n of [oldest, ...extra, r.safety!]) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
});

test("имена и скачивание: только файлы копий, «../» не проходит", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const name = (await bk.listBackups())[0].name;
  assert.ok(bk.backupFileFor(name, "db")?.endsWith(path.join(name, "db.dump")));
  assert.equal(bk.backupFileFor("../../etc", "db"), null);
  assert.equal(bk.backupFileFor("2020-01-01_000000-auto", "db"), null, "нет такой копии");
  const o = await bk.backupOverview();
  assert.equal(o.offsite.configured, false);
  assert.equal(o.lastOk?.state, "ok");
  assert.equal(o.keySource, "SECRETS_KEY");
});
