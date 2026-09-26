// Вход покупателя (Этап 5, шаг 5.3) на базе handyman_test: через Telegram (код → бот → сайт), SMS-код с ограничениями, Mini App по подписи.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let auth: typeof import("../src/client-auth");
let bot: typeof import("../src/bot");
const sms: Array<{ phone: string; text: string }> = [];

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  await prisma.tgLogin.deleteMany();
  await prisma.smsCode.deleteMany();
  await prisma.clientSession.deleteMany();
  process.env.BOT_TOKEN = "123:test";
  const telegram = await import("../src/telegram");
  telegram.setTelegramFetch((async (url: string) =>
    new Response(JSON.stringify(String(url).endsWith("/getMe") ? { ok: true, result: { username: "HandyTestBot" } } : { ok: true, result: {} }), { status: 200 })) as unknown as typeof fetch);
  auth = await import("../src/client-auth");
  bot = await import("../src/bot");
  auth.setSmsSender(async (phone, text) => void sms.push({ phone, text }));
  ready = true;
});

after(async () => {
  process.env.BOT_TOKEN = "";
  if (ready) await prisma.$disconnect();
  cleanup();
});

test("Telegram: ссылка на бота с кодом → пока не подтвердил «ждём» → бот подтвердил → сессия, второй раз нельзя", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const st = await auth.startTgLogin();
  assert.ok(st);
  assert.match(st!.link, /^https:\/\/t\.me\/HandyTestBot\?start=login_[A-Za-z0-9_-]{16}$/);
  assert.deepEqual(await auth.finishTgLogin(st!.code), { status: "wait" });
  await bot.handleUpdate({ update_id: 1, message: { message_id: 1, from: { id: 5551, first_name: "Оля" }, chat: { id: 5551, type: "private" }, text: `/start login_${st!.code}` } });
  const fin = await auth.finishTgLogin(st!.code);
  assert.equal(fin.status, "ok");
  const client = await auth.clientBySession((fin as { token: string }).token);
  assert.equal(client?.tgId, 5551n);
  assert.deepEqual(await auth.finishTgLogin(st!.code), { status: "expired" });
  await auth.endClientSession((fin as { token: string }).token);
  assert.equal(await auth.clientBySession((fin as { token: string }).token), null);
});

test("SMS: код приходит, повтор не раньше минуты, неверный код — попытка, верный — вход и клиент по телефону; приглашение", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const inviter = await prisma.client.create({ data: { phone: "+380935558800", refCode: "INVITE88" } });
  assert.deepEqual(await auth.sendSmsCode("123", (c) => c), { ok: false, error: "phone" });
  const r = await auth.sendSmsCode("093 555 88 01", (c) => `kod ${c}`);
  assert.deepEqual(r, { ok: true, phone: "+380935558801" });
  const code = sms.at(-1)!.text.replace("kod ", "");
  assert.match(code, /^\d{6}$/);
  const again = await auth.sendSmsCode("0935558801", (c) => c);
  assert.ok(!again.ok && again.error === "wait" && (again.sec ?? 0) > 50);
  assert.deepEqual(await auth.verifySmsCode("0935558801", "000000"), { ok: false, error: "code" });
  const ok = await auth.verifySmsCode("+380935558801", code, "invite88");
  assert.ok(ok.ok);
  const c = await prisma.client.findUniqueOrThrow({ where: { phone: "+380935558801" } });
  assert.equal(c.referredById, inviter.id);
  assert.deepEqual(await auth.verifySmsCode("0935558801", code), { ok: false, error: "expired" }, "код одноразовый");
});

test("SMS: не больше 5 кодов в час на номер", async (t) => {
  if (!ready) return t.skip(skipMsg);
  for (let i = 0; i < 5; i++) await prisma.smsCode.create({ data: { phone: "+380935558802", codeHash: "x", expiresAt: new Date(), createdAt: new Date(Date.now() - (i + 2) * 60_000) } });
  const r = await auth.sendSmsCode("0935558802", (c) => c);
  assert.ok(!r.ok && r.error === "limit");
});

test("Mini App: верная подпись Telegram — сессия «телеграм-клиента»; подделка — отказ", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const { signInitData } = await import("@handyman/core/telegram");
  const user = JSON.stringify({ id: 7771, first_name: "Петро", username: "petro", language_code: "ru" });
  const init = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user }, "123:test");
  const r = await auth.miniAppLogin(init);
  assert.ok(r.ok);
  const c = await prisma.client.findUniqueOrThrow({ where: { tgId: 7771n } });
  assert.equal(c.lang, "RU");
  assert.equal((await auth.miniAppLogin(init.replace("7771", "7772"))).ok, false);
});
