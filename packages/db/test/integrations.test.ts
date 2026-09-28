// «Интеграции» (шаг 3.1): ключи в базе зашифрованы, чтение «база → .env → нет», маска, проверка подключения (сеть подменена), журнал без ключей.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

process.env.SECRETS_KEY = "test-secrets-key";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let integ: typeof import("../src/integrations");
let notify: typeof import("../src/notify");

const TOKEN = "123456789:AAtestTOKENtestTOKENtest9876";
type Call = { url: string; headers: Record<string, string>; body?: string };
const calls: Call[] = [];
const reply = (status: number, body: unknown) => Promise.resolve({ status, json: () => Promise.resolve(body) });

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  ready = true;
  prisma = s.prisma;
  integ = await import("../src/integrations");
  notify = await import("../src/notify");
  await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret"');
  integ.resetSecretsKey();
  integ.setIntegrationsFetch((url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (url.endsWith("/getMe")) return reply(200, { ok: true, result: { username: "hm_test_bot" } });
    if (url.endsWith("/getChat")) return reply(200, { ok: true, result: { title: "Менеджери" } });
    if (url.includes("novaposhta")) return reply(200, { success: false, errors: ["API key is invalid"] });
    if (url.includes("monobank")) return Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    if (url.includes("keycrm")) return Promise.resolve({ status: 502, json: () => Promise.reject(new SyntaxError("<html>")) });
    return reply(500, null);
  });
});

after(async () => {
  if (ready) {
    await prisma.$executeRawUnsafe('TRUNCATE "IntegrationSecret"');
    await prisma.setting.deleteMany({ where: { key: "integrations.checks" } });
    integ.setIntegrationsFetch(null);
    await prisma.$disconnect();
  }
  delete process.env.NOVAPOSHTA_KEY;
  cleanup();
});

test("ключ из .env работает, пока в базе пусто; в обзоре — «из .env», маской", async (t) => {
  if (!ready) return t.skip(skipMsg);
  process.env.NOVAPOSHTA_KEY = "env-np-key-1234567890";
  assert.equal(await integ.secret("novaposhta.apiKey"), "env-np-key-1234567890");
  assert.equal(await integ.secret("telegram.botToken"), "", "нет ни в базе, ни в .env — заглушка");
  const np = (await integ.integrationsOverview()).find((i) => i.id === "novaposhta")!;
  assert.deepEqual([np.configured, np.fields[0].source, np.fields[0].shown], [true, "env", "••••••7890"]);
  const tgState = (await integ.integrationsOverview()).find((i) => i.id === "telegram")!;
  assert.equal(tgState.configured, false);
});

test("сохранение: в базе шифр (не сам ключ), чтение из базы важнее .env, в журнале нет значений, сразу работает для уведомлений", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await assert.rejects(integ.saveIntegration("telegram", { botToken: "не-токен" }, "owner"), integ.IntegrationError);
  assert.deepEqual(await integ.saveIntegration("telegram", { botToken: TOKEN, adminChatId: "-1001234567" }, "Власник"), ["botToken", "adminChatId"]);
  assert.deepEqual(await integ.saveIntegration("telegram", { botToken: "", adminChatId: "  " }, "Власник"), [], "пустые поля — оставить как есть");

  const rows = await prisma.integrationSecret.findMany();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.sealed.startsWith("v1:") && !r.sealed.includes("AAtest") && r.updatedBy === "Власник"));
  assert.equal(await integ.secret("telegram.botToken"), TOKEN);
  assert.equal(await integ.secret("telegram.adminChatId"), "-1001234567");

  const tgState = (await integ.integrationsOverview()).find((i) => i.id === "telegram")!;
  assert.deepEqual(tgState.fields.map((f) => [f.source, f.shown]), [["db", "••••••9876"], ["db", "-1001234567"]]);
  assert.equal(tgState.configured, true);

  const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: "integration." } } });
  assert.ok(audit.length >= 1);
  assert.ok(!JSON.stringify(audit).includes("AAtest"), "ключ не попадает в журнал");

  // уведомление менеджерам берёт токен и чат из «Интеграций»
  let url = "";
  const r = await notify.notifyManagers("тест", undefined, (async (u: string) => {
    url = u;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch);
  assert.equal(r, "SENT");
  assert.ok(url.includes(TOKEN));
  const out = await prisma.outbox.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  assert.equal(out.chatId, "-1001234567");
});

test("проверка подключения: ответ сервиса по-человечески, сохраняется, «не заполнено» и «не ответил» — без запросов/понятно", async (t) => {
  if (!ready) return t.skip(skipMsg);
  calls.length = 0;
  const ok = await integ.checkIntegration("telegram", "Власник");
  assert.deepEqual([ok.ok, ok.message], [true, "Бот @hm_test_bot на связи. Чат менеджеров: «Менеджери»."]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].body?.includes("-1001234567"));

  const np = await integ.checkIntegration("novaposhta", "Власник");
  assert.deepEqual([np.ok, np.message], [false, "Нова Пошта не приняла ключ: API key is invalid."]);
  assert.ok(calls.at(-1)!.body!.includes("env-np-key-1234567890"), "ключ из .env");

  const mono = await integ.checkIntegration("mono", "Власник");
  assert.deepEqual([mono.ok, mono.message], [false, "Не заполнено: Токен мерчанта (X-Token). Впишите значение в поле выше и нажмите «Сохранить» — пока работает заглушка."]);
  await integ.saveIntegration("mono", { token: "mono-token-abcdefghijklmnop" }, "Власник");
  const slow = await integ.checkIntegration("mono", "Власник");
  assert.match(slow.message, /не ответил за 10 секунд/);
  assert.equal(calls.at(-1)!.headers["X-Token"], "mono-token-abcdefghijklmnop");

  // вместо сервиса ответил кто-то другой (страница ошибки) — «не удалось связаться», а не «ключ неверный»
  await integ.saveIntegration("keycrm", { apiKey: "keycrm-key-abcdefghijkl" }, "Власник");
  assert.match((await integ.checkIntegration("keycrm", "Власник")).message, /^Не удалось связаться с сервисом .*код 502/);

  const tgState = (await integ.integrationsOverview()).find((i) => i.id === "telegram")!;
  assert.equal(tgState.check?.ok, true);
  await assert.rejects(integ.checkIntegration("nope", "x"), integ.IntegrationError);
});

test("удаление из базы — снова .env/заглушка; сменился ключ шифрования — «не читается», магазин берёт .env", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await integ.saveIntegration("novaposhta", { apiKey: "db-np-key-000000000000" }, "Власник");
  assert.equal(await integ.secret("novaposhta.apiKey"), "db-np-key-000000000000");
  await integ.clearIntegrationField("novaposhta", "apiKey", "Власник");
  assert.equal(await integ.secret("novaposhta.apiKey"), "env-np-key-1234567890");
  await assert.rejects(integ.clearIntegrationField("novaposhta", "nope", "x"), integ.IntegrationError);

  process.env.SECRETS_KEY = "other-key";
  integ.resetSecretsKey();
  try {
    assert.equal(await integ.secret("telegram.botToken"), "", "шифр не читается, в .env токена нет");
    const tgState = (await integ.integrationsOverview()).find((i) => i.id === "telegram")!;
    assert.deepEqual(tgState.fields.map((f) => f.source), ["broken", "broken"]);
    assert.equal(tgState.configured, false);
  } finally {
    process.env.SECRETS_KEY = "test-secrets-key";
    integ.resetSecretsKey();
  }
  assert.equal(await integ.secret("telegram.botToken"), TOKEN);
});
