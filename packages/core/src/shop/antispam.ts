// Защита публичных форм от ботов и спама (шаг 8.3). Чистая логика без базы и без node:crypto — модуль входит в @handyman/core/shop,
// который импортирует корзина в браузере. Запись счётчиков — packages/db/src/rate-limit.ts, проверки в действиях — apps/web/lib/antispam.ts.

/** Правило лимита: не больше `limit` событий за `windowSec` секунд с одного «кто» (адрес, телефон, покупатель, логин). */
export type RateRule = { limit: number; windowSec: number; what: string };

export const RATE_RULES = {
  /** оформление заказа и «Купити в 1 клік» (общий счётчик) — с одного адреса */
  order: { limit: 5, windowSec: 10 * 60, what: "заказы с сайта" },
  /** «Передзвоніть мені» — с одного адреса */
  callback: { limit: 3, windowSec: 10 * 60, what: "«Передзвоніть мені»" },
  /** отзывы и вопросы — с одного адреса */
  review: { limit: 5, windowSec: 60 * 60, what: "отзывы и вопросы" },
  /** «Повідомити про зниження ціни / надходження» — один покупатель */
  watch: { limit: 20, windowSec: 60 * 60, what: "подписки «Повідомити»" },
  /** SMS-код входа — с одного адреса (на один номер — свои лимиты в client-auth.ts) */
  smsSend: { limit: 5, windowSec: 60 * 60, what: "SMS-коды входа" },
  /** ввод SMS-кода — с одного адреса */
  smsVerify: { limit: 10, windowSec: 15 * 60, what: "проверка SMS-кода" },
  /** вход через Telegram (новая ссылка на бота) — с одного адреса */
  tgLogin: { limit: 10, windowSec: 10 * 60, what: "вход через Telegram" },
  /** ошибки из браузера — с одного адреса и со всего сайта */
  clientError: { limit: 10, windowSec: 60, what: "ошибки из браузера" },
  clientErrorAll: { limit: 120, windowSec: 60, what: "ошибки из браузера (всего)" },
  /** неверный пароль или код входа в админку — с одного адреса (на логин — блокировка учётной записи в staff.ts) */
  adminLogin: { limit: 5, windowSec: 15 * 60, what: "неудачные входы в админку" },
  /** тревога о переборе пароля — не чаще раза в час на логин/адрес */
  securityAlert: { limit: 1, windowSec: 60 * 60, what: "тревога о переборе" },
} as const satisfies Record<string, RateRule>;

export type RateRuleName = keyof typeof RATE_RULES;

/** Окно времени для счётчика: номер окна, когда оно кончится и сколько секунд ждать до нового. */
export function rateWindow(rule: RateRule, now: Date = new Date()): { bucket: number; expiresAt: Date; retryAfterSec: number } {
  const ms = rule.windowSec * 1000;
  const bucket = Math.floor(now.getTime() / ms);
  const end = (bucket + 1) * ms;
  return { bucket, expiresAt: new Date(end), retryAfterSec: Math.max(1, Math.ceil((end - now.getTime()) / 1000)) };
}

/** Форма, заполненная быстрее — почти наверняка бот (человеку нужно время хотя бы на номер телефона). */
export const MIN_FILL_MS = 3000;

/** Скрытое поле-ловушка `website` заполнено — бот (человек его не видит). */
export const trapFilled = (website: unknown): boolean => typeof website === "string" && website.trim() !== "";

/**
 * «Слишком быстро»: браузер присылает, сколько миллисекунд прошло с открытия формы. Нет числа — старая открытая страница (до обновления сайта)
 * или прямой запрос: такое пропускаем, чтобы не отказать живому покупателю; решают остальные защиты (лимиты, ловушка).
 */
export function filledTooFast(fillMs: unknown): boolean {
  const n = typeof fillMs === "number" ? fillMs : typeof fillMs === "string" && fillMs.trim() !== "" ? Number(fillMs) : NaN;
  return Number.isFinite(n) && n >= 0 && n < MIN_FILL_MS;
}

/** Повторный заказ: тот же телефон и та же корзина за это время — второй не создаём, показываем первый. */
export const DUPLICATE_ORDER_MS = 10 * 60_000;

/** «Подпись» корзины: артикулы с количеством, без порядка. Одинаковая подпись = та же корзина. */
export function cartSignature(lines: Array<{ sku: string; qty: number }>): string {
  const sum = new Map<string, number>();
  for (const l of lines) sum.set(l.sku, (sum.get(l.sku) ?? 0) + l.qty);
  return [...sum].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([s, q]) => `${s}×${q}`).join(",");
}

/** Почему заказ «подозрительный» — для админки. */
export const SUSPICIOUS_RU: Record<string, string> = {
  blocked: "покупатель в чёрном списке",
};
