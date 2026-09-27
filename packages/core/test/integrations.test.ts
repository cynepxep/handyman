import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATIONS, deriveKey, maskSecret, openSecret, readCheckboxCheck, readKeycrmCheck, readMonoCheck, readNovaPoshtaCheck, readTelegramCheck,
  readTurboSmsCheck, sealSecret, validateField,
} from "../src/integrations";

test("интеграции: у каждого сервиса свои поля, обязательные поля существуют, переменные .env не повторяются", () => {
  const envs = INTEGRATIONS.flatMap((i) => i.fields.map((f) => f.env));
  assert.equal(new Set(envs).size, envs.length);
  for (const i of INTEGRATIONS) for (const r of i.required) assert.ok(i.fields.some((f) => f.key === r), `${i.id}.${r}`);
  assert.deepEqual(INTEGRATIONS.find((i) => i.id === "telegram")?.fields.map((f) => f.env), ["BOT_TOKEN", "ADMIN_CHAT_ID"]);
});

test("маска: длинный ключ — последние 4 знака, короткий — только точки, пустой — пусто", () => {
  assert.equal(maskSecret("123456789:AAbbccddeeffgg1234"), "••••••1234");
  assert.equal(maskSecret("short"), "••••••");
  assert.equal(maskSecret("  "), "");
});

test("шифрование: расшифровывается своим ключом; чужой ключ или подделка — null; каждый раз разный шифр", () => {
  const k = deriveKey("мой-ключ");
  const a = sealSecret("123:секрет", k);
  const b = sealSecret("123:секрет", k);
  assert.match(a, /^v1:/);
  assert.notEqual(a, b, "случайный iv");
  assert.ok(!a.includes("секрет"));
  assert.equal(openSecret(a, k), "123:секрет");
  assert.equal(openSecret(a, deriveKey("другой")), null);
  const raw = Buffer.from(a.slice(3), "base64");
  raw[raw.length - 1] ^= 1;
  assert.equal(openSecret(`v1:${raw.toString("base64")}`, k), null);
  assert.equal(openSecret("plain", k), null);
});

test("проверка значений: токен бота, ID чата, источник KeyCRM, имя отправителя SMS; пусто — без ошибки", () => {
  assert.equal(validateField("telegram", "botToken", ""), null);
  assert.equal(validateField("telegram", "botToken", "123456789:AAbbccddeeffgghhiijjkkll"), null);
  assert.match(validateField("telegram", "botToken", "abc") ?? "", /BotFather/);
  assert.equal(validateField("telegram", "adminChatId", "-1001234567890"), null);
  assert.match(validateField("telegram", "adminChatId", "@chat") ?? "", /число/);
  assert.match(validateField("keycrm", "sourceId", "сайт") ?? "", /число/);
  assert.match(validateField("sms", "sender", "HandymanOdesa") ?? "", /11/);
  assert.match(validateField("mono", "token", "a\nb") ?? "", /перенос/);
});

test("ответы сервисов при проверке понятны владельцу", () => {
  assert.deepEqual(readTelegramCheck({ ok: false, description: "Unauthorized" }), { ok: false, message: "Telegram не принял токен: Unauthorized" });
  const me = { ok: true, result: { username: "handyman_bot" } };
  assert.match(readTelegramCheck(me).message, /@handyman_bot.*не задан/);
  assert.equal(readTelegramCheck(me, { ok: true, result: { title: "Менеджеры" } }).message, "Бот @handyman_bot на связи. Чат менеджеров: «Менеджеры».");
  assert.equal(readTelegramCheck(me, { ok: false, description: "chat not found" }).ok, false);

  assert.deepEqual(readNovaPoshtaCheck({ success: true, data: [{ Description: "ФОП Іванов" }] }), { ok: true, message: "Ключ принят. Отправитель: ФОП Іванов." });
  assert.deepEqual(readNovaPoshtaCheck({ success: false, errors: ["API key expired"] }), { ok: false, message: "Нова Пошта не приняла ключ: API key expired." });

  assert.equal(readMonoCheck(200, { merchantName: "Handyman" }).message, "Токен принят. Мерчант: Handyman.");
  assert.match(readMonoCheck(403, { errCode: "FORBIDDEN" }).message, /не личный/);

  assert.equal(readCheckboxCheck(200, { access_token: "x" }).ok, true);
  assert.equal(readCheckboxCheck(401, { message: "Невірний логін" }).message, "Checkbox не принял логин или пароль кассира: Невірний логін.");

  const sources = { data: [{ id: 1, name: "Сайт" }, { id: 2, name: "Telegram" }] };
  assert.equal(readKeycrmCheck(200, sources, "1").message, "Ключ принят. Источник: Сайт.");
  assert.deepEqual(readKeycrmCheck(200, sources, "9"), { ok: false, message: "Ключ принят, но источника 9 нет. Есть: 1 — Сайт, 2 — Telegram." });
  assert.equal(readKeycrmCheck(401, null, "").ok, false);

  assert.equal(readTurboSmsCheck(200, { response_code: 0, response_result: { balance: 12.5 } }).message, "Токен принят. Баланс: 12.5 грн.");
  assert.equal(readTurboSmsCheck(200, { response_code: 103, response_status: "REQUIRED_TOKEN" }).ok, false);
});
