// Бот и Mini App (Этап 5) — чистая логика: разбор /start, язык, клавиатура, проверка подписи данных Telegram Mini App.
// Бот работает напрямую через Telegram Bot API (без библиотек — как в прототипе); запросы — в packages/db/src/telegram.ts.

import { createHmac, timingSafeEqual } from "node:crypto";

export type StartPayload =
  | { kind: "login" | "ref" | "link"; code: string }
  /** шаг 5.6: «Повідомити про зниження ціни» (wp_<товар>) / «про надходження» (ws_<товар>) */
  | { kind: "watch"; watch: "PRICE" | "STOCK"; code: string }
  | null;

/** «/start login_ABC» → { kind: "login", code: "ABC" }. Параметр /start у Telegram — до 64 символов [A-Za-z0-9_-]. */
export function parseStart(text: string): { isStart: boolean; payload: StartPayload } {
  const m = String(text ?? "").trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
  if (!m) return { isStart: false, payload: null };
  const p = m[1] ?? "";
  const wm = p.match(/^(wp|ws)_([A-Za-z0-9]{8,40})$/);
  if (wm) return { isStart: true, payload: { kind: "watch", watch: wm[1] === "wp" ? "PRICE" : "STOCK", code: wm[2] } };
  const pm = p.match(/^(login|ref|link)_([A-Za-z0-9_-]{4,60})$/);
  return { isStart: true, payload: pm ? { kind: pm[1] as "login" | "ref" | "link", code: pm[2] } : null };
}

/** «/chatid» (в группе — «/chatid@ИмяБота»): бот отвечает ID этого чата — его вписывают в «Интеграции → Чат менеджеров (ID)». */
export const isChatIdCommand = (text: string | undefined) => /^\/chatid(?:@\w+)?$/i.test(String(text ?? "").trim());

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

// ---------- долгий опрос: кратковременные сбои связи с Telegram ----------

/**
 * Сбой «сам пройдёт»: Telegram не ответил вовремя (тайм-аут), обрыв сети, 429 (слишком часто) или 5xx (Bad Gateway и т. п. на стороне Telegram).
 * Такие сбои бот пережидает и повторяет; в журнал «Ошибки» они попадают, только если связи нет дольше `BOT_OUTAGE_REPORT_MS`.
 */
export function isTransientTelegramFailure(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { name, message, code } = e as { name?: unknown; message?: unknown; code?: unknown };
  if (typeof code === "number" && code !== 0) return code === 429 || code >= 500;
  if (name === "TimeoutError" || name === "AbortError") return true;
  return typeof message === "string" && /fetch failed|aborted due to timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|terminated/i.test(message);
}

export const BOT_OUTAGE_REPORT_MS = 5 * 60_000;

/** Состояние «связи с Telegram нет»: когда началось и сообщили ли уже в журнал. */
export type BotOutage = { since: number | null; reported: boolean; fails: number };
export const botOutageStart = (): BotOutage => ({ since: null, reported: false, fails: 0 });

/**
 * Очередной сбой опроса. `report` — пора записать в журнал (один раз за сбой: связи нет дольше 5 минут),
 * `waitMs` — пауза перед повтором (5 с, 10 с, 20 с … до минуты).
 */
export function botOutageFail(s: BotOutage, now: number): { next: BotOutage; report: boolean; waitMs: number } {
  const since = s.since ?? now;
  const report = !s.reported && now - since >= BOT_OUTAGE_REPORT_MS;
  const fails = s.fails + 1;
  return { next: { since, reported: s.reported || report, fails }, report, waitMs: Math.min(60_000, 5_000 * 2 ** Math.min(fails - 1, 4)) };
}
