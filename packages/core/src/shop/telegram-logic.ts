// Бот и Mini App (Этап 5) — чистая логика: разбор /start, язык, клавиатура, проверка подписи данных Telegram Mini App.
// Бот работает напрямую через Telegram Bot API (без библиотек — как в прототипе); запросы — в packages/db/src/telegram.ts.

import { createHmac, timingSafeEqual } from "node:crypto";

export type StartPayload = { kind: "login" | "ref" | "link"; code: string } | null;

/** «/start login_ABC» → { kind: "login", code: "ABC" }. Параметр /start у Telegram — до 64 символов [A-Za-z0-9_-]. */
export function parseStart(text: string): { isStart: boolean; payload: StartPayload } {
  const m = String(text ?? "").trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
  if (!m) return { isStart: false, payload: null };
  const p = m[1] ?? "";
  const pm = p.match(/^(login|ref|link)_([A-Za-z0-9_-]{4,60})$/);
  return { isStart: true, payload: pm ? { kind: pm[1] as "login" | "ref" | "link", code: pm[2] } : null };
}

/** Язык ответов: сохранённый у клиента → язык Telegram (ru → русский, остальное → украинский). */
export function botLang(clientLang: "UK" | "RU" | null | undefined, telegramLang: string | undefined): "uk" | "ru" {
  if (clientLang) return clientLang === "RU" ? "ru" : "uk";
  return telegramLang?.toLowerCase().startsWith("ru") ? "ru" : "uk";
}

/** Какую кнопку нажали (текст кнопки приходит обычным сообщением) — сравниваем с текстами на обоих языках. */
export function whichButton(text: string, both: Array<Record<string, string>>): "orders" | "help" | "phone" | null {
  const s = text.trim();
  for (const t of both) {
    if (s === t["bot.btn.orders"]) return "orders";
    if (s === t["bot.btn.help"]) return "help";
    if (s === t["bot.btn.phone"]) return "phone";
  }
  if (/^\/orders\b/.test(s)) return "orders";
  if (/^\/help\b/.test(s)) return "help";
  return null;
}

/** Клавиатура под полем ввода: «Поделиться номером» (пока не подключён), «Мои заказы», «Помощь», «Магазин» (если у сайта есть https-адрес). */
export function mainKeyboard(t: Record<string, string>, p: { hasPhone: boolean; shopUrl: string | null }) {
  const rows: Array<Array<Record<string, unknown>>> = [];
  if (!p.hasPhone) rows.push([{ text: t["bot.btn.phone"], request_contact: true }]);
  if (p.shopUrl) rows.push([{ text: t["bot.btn.shop"], web_app: { url: p.shopUrl } }]);
  rows.push([{ text: t["bot.btn.orders"] }, { text: t["bot.btn.help"] }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

/** Адрес магазина для кнопки Mini App: только https (так требует Telegram); язык — русский с /ru. */
export function shopUrlFor(publicUrl: string | undefined, lang: "uk" | "ru"): string | null {
  const u = publicUrl?.trim().replace(/\/+$/, "");
  if (!u || !/^https:\/\//.test(u)) return null;
  return lang === "ru" ? `${u}/ru` : u;
}

// ---------- Mini App: проверка initData ----------

export type TgWebUser = { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };

/**
 * Проверка данных, которые Telegram передаёт в Mini App (Telegram.WebApp.initData): подпись HMAC-SHA256 ключом,
 * производным от токена бота (секрет = HMAC_SHA256(ключ «WebAppData», токен)). Данные старше `maxAgeSec` отклоняем.
 */
export function verifyInitData(initData: string, botToken: string, now = Date.now(), maxAgeSec = 24 * 3600): { ok: true; user: TgWebUser; authDate: number } | { ok: false; error: string } {
  if (!initData || !botToken) return { ok: false, error: "нет данных" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, error: "нет подписи" };
  params.delete("hash");
  const check = [...params].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest("hex");
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hash, "hex"))) return { ok: false, error: "подпись не совпала" };
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec) return { ok: false, error: "данные устарели" };
  try {
    const user = JSON.parse(params.get("user") ?? "null") as TgWebUser | null;
    if (!user || typeof user.id !== "number") return { ok: false, error: "нет пользователя" };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, error: "повреждённые данные" };
  }
}

/** Подписать initData (для тестов и локальной проверки без Telegram). */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
