// Двухфакторный вход (шаг 4.7): одноразовые коды из приложения (Google Authenticator, Microsoft Authenticator и т. п.).
// Стандарт TOTP (RFC 6238, на основе HOTP RFC 4226): HMAC-SHA1, 6 цифр, шаг 30 секунд. Без внешних библиотек — node:crypto.
// Коды восстановления — одноразовые, хранятся только хешами.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("не base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Новый секрет: 20 случайных байт (160 бит, как рекомендует RFC 4226) в base32. */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

/** Ключ для ручного ввода в приложение — группами по 4. */
export const formatSecret = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

/** Код HOTP для счётчика (RFC 4226). */
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totp(secretB32: string, at = Date.now(), step = 30, digits = 6): string {
  return hotp(base32Decode(secretB32), Math.floor(at / 1000 / step), digits);
}

/**
 * Проверка кода: допускаем ±1 шаг (часы телефона чуть спешат/отстают). Сравнение без утечки по времени.
 * `notBeforeStep` — защита от повторного ввода того же кода (передайте последний принятый шаг).
 */
export function verifyTotp(secretB32: string, code: string, at = Date.now(), opts: { window?: number; notBeforeStep?: number } = {}): { ok: boolean; step?: number } {
  const clean = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false };
  let key: Buffer;
  try {
    key = base32Decode(secretB32);
  } catch {
    return { ok: false };
  }
  const cur = Math.floor(at / 1000 / 30);
  const w = opts.window ?? 1;
  for (let s = cur - w; s <= cur + w; s++) {
    if (opts.notBeforeStep !== undefined && s <= opts.notBeforeStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(clean))) return { ok: true, step: s };
  }
  return { ok: false };
}

/** Ссылка otpauth:// — на телефоне открывает приложение-аутентификатор и сразу добавляет аккаунт. */
export function otpauthUrl(secretB32: string, account: string, issuer = "Handyman"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- коды восстановления ----------

const hashCode = (c: string) => createHash("sha256").update(c.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

/** 10 одноразовых кодов вида ABCD-EFGH: показываются один раз, храним только хеши. */
export function generateRecoveryCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(5)).slice(0, 8);
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashCode) };
}

/** Код восстановления подходит? Возвращает оставшиеся хеши (использованный удаляется) или null. */
export function consumeRecoveryCode(hashes: unknown, code: string): string[] | null {
  const list = Array.isArray(hashes) ? hashes.filter((h): h is string => typeof h === "string") : [];
  const h = hashCode(code);
  const i = list.indexOf(h);
  return i < 0 ? null : [...list.slice(0, i), ...list.slice(i + 1)];
}

// ---------- пароль сотрудника ----------

/** Временный пароль для нового сотрудника / сброса: 12 символов без похожих (0/O, 1/l). */
export function generateTempPassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(12);
  return Array.from(b, (x) => abc[x % abc.length]).join("");
}

/** Пароль сотрудника: не короче 10 символов, не только цифры, не равен логину. */
export function checkPasswordStrength(pw: string, username: string): string | null {
  if (pw.length < 10) return "Пароль — не короче 10 символов.";
  if (/^\d+$/.test(pw)) return "Пароль не может состоять только из цифр.";
  if (pw.toLowerCase().includes(username.toLowerCase())) return "Пароль не должен содержать логин.";
  return null;
}
