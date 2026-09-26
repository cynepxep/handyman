// Заказы в админке (шаг 4.3): фильтры списка, причины отмены, заказ по звонку, реквизиты продавца для счёта. Чистая логика без базы.

import { normalizePhone } from "./order";

// ---------- источники и «требуют действия» ----------

export const ORDER_SOURCE_RU: Record<string, string> = {
  site: "Сайт",
  one_click: "Купить в 1 клик",
  manual: "По звонку (менеджер)",
  miniapp: "Telegram-магазин",
  bot: "Бот",
};
export const ORDER_SOURCES = Object.keys(ORDER_SOURCE_RU);

/** Статусы, по которым менеджер должен что-то сделать: позвонить, дождаться товара. */
export const ACTION_STATUSES = ["NEW", "NO_ANSWER", "AWAITING_SUPPLIER"] as const;

// ---------- причины отмены и возврата ----------

export const CANCEL_REASONS: Array<{ key: string; ru: string }> = [
  { key: "changed_mind", ru: "Передумал" },
  { key: "no_answer", ru: "Не дозвонились" },
  { key: "out_of_stock", ru: "Нет в наличии / поставщик не привёз" },
  { key: "price", ru: "Дорого / нашёл дешевле" },
  { key: "delivery", ru: "Не устроили доставка или сроки" },
  { key: "np_refused", ru: "Не забрал на Новой Почте" },
  { key: "defect", ru: "Брак / не подошёл (возврат)" },
  { key: "duplicate", ru: "Дубль заказа" },
  { key: "test", ru: "Тестовый заказ" },
  { key: "other", ru: "Другое" },
];
export const CANCEL_REASON_RU: Record<string, string> = Object.fromEntries(CANCEL_REASONS.map((r) => [r.key, r.ru]));
export const needsCancelReason = (status: string) => status === "CANCELLED" || status === "RETURNED";

// ---------- фильтры списка ----------

export type OrderFilters = {
  q: string;
  status: string; // "" | статус | "action" (требуют действия)
  source: string;
  pay: string;
  delivery: string;
  from: string; // YYYY-MM-DD
  to: string;
  test: "hide" | "only" | "all";
  page: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Параметры адреса → фильтры (неизвестное отбрасывается). По умолчанию тестовые заказы показываются (их мало, и их надо видеть). */
export function parseOrderFilters(p: Record<string, string | undefined>, known: { statuses: readonly string[]; pays: readonly string[]; deliveries: readonly string[] }): OrderFilters {
  const pick = (v: string | undefined, list: readonly string[]) => (v && list.includes(v) ? v : "");
  return {
    q: (p.q ?? "").trim().slice(0, 80),
    status: p.status === "action" ? "action" : pick(p.status, known.statuses),
    source: pick(p.source, ORDER_SOURCES),
    pay: pick(p.pay, known.pays),
    delivery: pick(p.delivery, known.deliveries),
    from: p.from && DATE.test(p.from) ? p.from : "",
    to: p.to && DATE.test(p.to) ? p.to : "",
    test: p.test === "hide" || p.test === "only" ? p.test : "all",
    page: Math.max(1, Math.floor(Number(p.page)) || 1),
  };
}

/** Граница суток по Киеву (UTC+2/+3) для фильтра «с — по». `end` — начало СЛЕДУЮЩЕГО дня. */
export function kyivDayStart(ymd: string, end = false): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d + (end ? 1 : 0), 0, 0, 0));
  // смещение Киева в этот момент: разница между «киевскими» часами и UTC
  const kyivHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" }).format(guess));
  const offsetH = kyivHour >= 12 ? kyivHour - 24 : kyivHour; // 2 или 3
  return new Date(guess.getTime() - offsetH * 3600_000);
}

// ---------- заказ по звонку ----------

export type ManualOrderInput = {
  phone: string;
  name: string;
  items: Array<{ sku: string; qty: number }>;
  delivery: "np" | "pickup" | "courier" | "to_confirm";
  pay: "prepay" | "full" | "card" | "later";
  city: string;
  npPoint: string;
  address: string;
  comment: string;
  isTest: boolean;
};

/** Форма «Новый заказ» в админке. Цены сюда не приходят — их берёт сервер из базы. */
export function validateManualOrder(raw: Record<string, unknown>): { ok: true; value: ManualOrderInput } | { ok: false; error: string } {
  const s = (k: string, max: number) => String(raw[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const phone = normalizePhone(s("phone", 40));
  if (!phone) return { ok: false, error: "Укажите телефон покупателя (украинский номер, например 093 123 45 67)." };
  let items: Array<{ sku: string; qty: number }> = [];
  try {
    const parsed = JSON.parse(String(raw.items ?? "[]"));
    if (Array.isArray(parsed)) {
      const bySku = new Map<string, number>();
      for (const it of parsed) {
        const sku = String(it?.sku ?? "").trim().slice(0, 64);
        const qty = Math.min(999, Math.max(0, Math.floor(Number(it?.qty) || 0)));
        if (sku && qty > 0) bySku.set(sku, (bySku.get(sku) ?? 0) + qty);
      }
      items = [...bySku].map(([sku, qty]) => ({ sku, qty }));
    }
  } catch {
    items = [];
  }
  if (!items.length) return { ok: false, error: "Добавьте хотя бы один товар." };
  const delivery = (["np", "pickup", "courier", "to_confirm"] as const).find((d) => d === raw.delivery) ?? "to_confirm";
  const pay = (["prepay", "full", "card", "later"] as const).find((d) => d === raw.pay) ?? "later";
  const city = s("city", 80);
  const npPoint = s("npPoint", 200);
  const address = s("address", 200);
  if (delivery === "np" && (!city || !npPoint)) return { ok: false, error: "Для Новой Почты укажите город и отделение (или выберите «Уточнить позже»)." };
  if (delivery === "courier" && !address) return { ok: false, error: "Для курьера по Одессе укажите адрес." };
  return { ok: true, value: { phone, name: s("name", 80), items, delivery, pay, city, npPoint, address, comment: s("comment", 500), isTest: raw.isTest === "on" || raw.isTest === true } };
}

// ---------- реквизиты продавца (для счёта) ----------

export const SELLER_SETTING_KEY = "shop.seller";

export type SellerDetails = { name: string; code: string; iban: string; bank: string; address: string; note: string };
export const EMPTY_SELLER: SellerDetails = { name: "", code: "", iban: "", bank: "", address: "", note: "" };

export function parseSeller(raw: unknown): SellerDetails {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: keyof SellerDetails, max: number) => String(r[k] ?? "").trim().slice(0, max);
  return { name: s("name", 160), code: s("code", 20), iban: s("iban", 40).replace(/\s/g, "").toUpperCase(), bank: s("bank", 120), address: s("address", 200), note: s("note", 500) };
}

/** Проверка реквизитов: IBAN — UA + 27 цифр, код ЄДРПОУ/ІПН — 8 или 10 цифр (если указаны). */
export function validateSeller(raw: Record<string, unknown>): { ok: true; value: SellerDetails } | { ok: false; error: string } {
  const v = parseSeller(raw);
  if (v.iban && !/^UA\d{27}$/.test(v.iban)) return { ok: false, error: "IBAN — это UA и 27 цифр, например UA213223130000026007233566001." };
  if (v.code && !/^(\d{8}|\d{10})$/.test(v.code)) return { ok: false, error: "Код ЄДРПОУ — 8 цифр, ІПН ФОП — 10 цифр." };
  return { ok: true, value: v };
}
