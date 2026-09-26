// Вход и сотрудники (шаг 4.7) на базе handyman_test: пароль → код из приложения, блокировка после 5 ошибок, коды восстановления,
// сотрудники (создать, сменить роль, отключить — сессии закрываются), выход со всех устройств, журнал.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let staff: typeof import("../src/staff");
let core: typeof import("@handyman/core");

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  staff = await import("../src/staff");
  core = await import("@handyman/core");
  await prisma.staffSession.deleteMany();
  await prisma.staff.deleteMany();
  for (const [key, title] of [["owner", "Владелец"], ["manager", "Менеджер"]]) await prisma.role.upsert({ where: { key }, update: {}, create: { key, title, builtin: true } });
  const { salt, hash } = core.hashPassword("Owner-pass-123");
  await prisma.staff.create({ data: { username: "boss", name: "Владелец", roleKey: "owner", passwordSalt: salt, passwordHash: hash } });
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

test("пароль без кода — сразу сессия; 5 неверных паролей — вход закрыт, даже верным паролем", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const ok = await staff.passwordStep("boss", "Owner-pass-123", "test-browser");
  assert.ok(ok.ok && "session" in ok);
  assert.equal((await prisma.staffSession.findFirstOrThrow({ where: { token: (ok as { session: string }).session } })).userAgent, "test-browser");
  for (let i = 0; i < 4; i++) assert.equal((await staff.passwordStep("boss", "wrong", null)).ok, false);
  const locked = await staff.passwordStep("boss", "wrong", null);
  assert.ok(!locked.ok && locked.error.includes("закрыт"));
  const still = await staff.passwordStep("boss", "Owner-pass-123", null);
  assert.ok(!still.ok && still.error.includes("Попробуйте через"));
  await prisma.staff.update({ where: { username: "boss" }, data: { lockedUntil: null } });
  assert.ok((await prisma.auditLog.count({ where: { action: "login.locked" } })) >= 1);
});

test("код из приложения: включить, вход в 2 шага, неверный код, код восстановления одноразовый, выключить", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const boss = await prisma.staff.findUniqueOrThrow({ where: { username: "boss" } });
  const secret = core.generateTotpSecret();
  assert.equal((await staff.enableTwoFactor(boss.id, secret, "000000")).ok, false);
  const en = await staff.enableTwoFactor(boss.id, secret, core.totp(secret));
  assert.ok(en.ok && en.recoveryCodes.length === 10);
  const codes = (en as { recoveryCodes: string[] }).recoveryCodes;

  const step1 = await staff.passwordStep("boss", "Owner-pass-123", null);
  assert.ok(step1.ok && "challenge" in step1);
  const ch = (step1 as { challenge: string }).challenge;
  const bad = await staff.codeStep(ch, "123456", null);
  assert.ok(!bad.ok && !bad.restart);
  const good = await staff.codeStep(ch, core.totp(secret), null);
  assert.ok(good.ok);
  assert.equal((await staff.codeStep(ch, core.totp(secret), null)).ok, false, "вызов одноразовый");

  const ch2 = ((await staff.passwordStep("boss", "Owner-pass-123", null)) as { challenge: string }).challenge;
  assert.ok((await staff.codeStep(ch2, codes[0], null)).ok, "код восстановления");
  const ch3 = ((await staff.passwordStep("boss", "Owner-pass-123", null)) as { challenge: string }).challenge;
  assert.equal((await staff.codeStep(ch3, codes[0], null)).ok, false, "второй раз не годится");

  assert.equal((await staff.disableTwoFactor(boss.id, "000000")).ok, false);
  assert.ok((await staff.disableTwoFactor(boss.id, core.totp(secret))).ok);
  assert.ok("session" in (await staff.passwordStep("boss", "Owner-pass-123", null)));
});

test("сотрудники: создать с временным паролем, сменить роль, отключить — сессии закрыты; владельца отключить нельзя; выйти со всех устройств", async (t) => {
  if (!ready) return t.skip(skipMsg);
  assert.equal((await staff.createStaff({ name: "Оля", username: "Оля!", roleKey: "manager" }, "boss")).ok, false);
  assert.equal((await staff.createStaff({ name: "Оля", username: "olya", roleKey: "owner" }, "boss")).ok, false);
  const c = await staff.createStaff({ name: "Оля", username: "Olya", roleKey: "manager" }, "boss");
  assert.ok(c.ok);
  const { id, tempPassword } = c as { id: string; tempPassword: string };
  assert.equal((await staff.createStaff({ name: "Оля 2", username: "olya", roleKey: "manager" }, "boss")).ok, false, "логин занят");
  const s1 = await staff.passwordStep("olya", tempPassword, "phone");
  const s2 = await staff.passwordStep("olya", tempPassword, "pc");
  assert.ok("session" in s1 && "session" in s2);
  assert.equal((await staff.listSessions(id)).length, 2);
  assert.equal(await staff.killSessions(id, "olya", (s1 as { session: string }).session), 1, "кроме текущей");
  assert.equal((await staff.changeOwnPassword(id, "не тот", "Новый-пароль-1")).ok, false);
  assert.equal((await staff.changeOwnPassword(id, tempPassword, "123")).ok, false);
  assert.ok((await staff.changeOwnPassword(id, tempPassword, "Новый-пароль-1")).ok);
  assert.ok((await staff.updateStaff(id, { active: false }, "boss")).ok);
  assert.equal((await staff.listSessions(id)).length, 0);
  assert.equal((await staff.passwordStep("olya", "Новый-пароль-1", null)).ok, false, "отключённый не входит");
  const boss = await prisma.staff.findUniqueOrThrow({ where: { username: "boss" } });
  assert.equal((await staff.updateStaff(boss.id, { active: false }, "boss")).ok, false);
  const reset = await staff.resetStaffPassword(id, "boss");
  assert.ok(reset.ok);
  const log = await staff.listAudit({ action: "staff." });
  assert.ok(log.rows.some((r) => r.action === "staff.create") && log.rows.some((r) => r.action === "staff.password.reset"));
  assert.ok((await staff.listStaff()).some((x) => x.username === "olya" && !x.active));
});
