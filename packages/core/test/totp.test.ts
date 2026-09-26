import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode, base32Encode, checkPasswordStrength, consumeRecoveryCode, generateRecoveryCodes, generateTempPassword, generateTotpSecret, hotp, otpauthUrl, totp, verifyTotp,
} from "../src";

// Официальные тестовые векторы RFC 4226 (приложение D) и RFC 6238 (приложение B, SHA-1)
const RFC_KEY = Buffer.from("12345678901234567890", "ascii");

test("HOTP совпадает с RFC 4226", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, i) => assert.equal(hotp(RFC_KEY, i), code));
});

test("TOTP совпадает с RFC 6238 (8 цифр) и Google Authenticator (6 цифр)", () => {
  const b32 = base32Encode(RFC_KEY);
  assert.equal(b32, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(base32Decode(b32).toString("ascii"), "12345678901234567890");
  const cases: Array<[number, string]> = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"]];
  for (const [t, code] of cases) assert.equal(totp(b32, t * 1000, 30, 8), code, String(t));
  assert.equal(totp(b32, 59_000), "287082");
});

test("проверка кода: окно ±30 с, чужой/кривой код не проходит, повтор того же кода отклоняется", () => {
  const s = generateTotpSecret();
  assert.equal(s.length, 32);
  const now = Date.UTC(2026, 8, 26, 12, 0, 0);
  const code = totp(s, now);
  const r = verifyTotp(s, code, now);
  assert.ok(r.ok && typeof r.step === "number");
  assert.ok(verifyTotp(s, totp(s, now - 30_000), now).ok, "код предыдущих 30 секунд ещё годится");
  assert.equal(verifyTotp(s, totp(s, now - 120_000), now).ok, false, "старый код");
  assert.equal(verifyTotp(s, "12345", now).ok, false);
  assert.equal(verifyTotp(s, code, now, { notBeforeStep: r.step }).ok, false, "тот же код второй раз");
  assert.match(otpauthUrl(s, "owner"), /^otpauth:\/\/totp\/Handyman%3Aowner\?secret=[A-Z2-7]{32}&issuer=Handyman/);
});

test("коды восстановления одноразовые; временный пароль и требования к паролю", () => {
  const { codes, hashes } = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.match(codes[0], /^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  const left = consumeRecoveryCode(hashes, codes[3].toLowerCase().replace("-", " "));
  assert.equal(left?.length, 9);
  assert.equal(consumeRecoveryCode(left, codes[3]), null, "второй раз не годится");
  assert.equal(generateTempPassword().length, 12);
  assert.equal(checkPasswordStrength("short", "oleg"), "Пароль — не короче 10 символов.");
  assert.ok(checkPasswordStrength("1234567890", "oleg"));
  assert.ok(checkPasswordStrength("oleg-strong-pass", "oleg"));
  assert.equal(checkPasswordStrength("Korm2Tochka!", "oleg"), null);
});
