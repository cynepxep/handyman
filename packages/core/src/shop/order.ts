// Правила заказа (чистая логика, без базы): телефон, проверка формы оформления, расчёт сумм, номер заказа.
// Деньги считает только сервер: сюда приходят цены из базы, а не из браузера (правило №1 проекта; как createOrder старого магазина).

import type { CheckoutSettings, DeliveryChoice, PayChoice } from "./checkout-settings";
import { canSkipCall, type StockLevel } from "./stock";

// ---------- телефон ----------

/** Телефон к виду +380XXXXXXXXX. Понимает «093 366 24 07», «0933662407», «380…», «+380 (93) 366-24-07». Не украинский мобильный/городской — null. */
export function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let d = digits;
  if (/^0\d{9}$/.test(d)) d = `38${d}`;
  if (/^80\d{9}$/.test(d)) d = `3${d}`;
  return /^380\d{9}$/.test(d) ? `+${d}` : null;
}

/** +380933662407 → «+380 (93) 366-24-07». */
export function formatPhone(e164: string): string {
  const m = /^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+380 (${m[1]}) ${m[2]}-${m[3]}-${m[4]}` : e164;
}

// ---------- корзина ----------

export type CartLineInput = { sku: string; qty: number };
export const MAX_QTY = 99;
export const MAX_LINES = 50;

/** Корзина из браузера: артикулы строкой, количество 1–99, одинаковые строки сложены, не больше 50 строк. */
export function cleanCart(raw: unknown): CartLineInput[] {
  if (!Array.isArray(raw)) return [];
  const map = new Map<string, number>();
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const sku = String((it as Record<string, unknown>).sku ?? "").trim().slice(0, 60);
    const qty = Math.floor(Number((it as Record<string, unknown>).qty));
    if (!sku || !Number.isFinite(qty) || qty < 1) continue;
    map.set(sku, Math.min(MAX_QTY, (map.get(sku) ?? 0) + qty));
  }
  return [...map.entries()].slice(0, MAX_LINES).map(([sku, qty]) => ({ sku, qty }));
}

// ---------- суммы ----------

const round2 = (n: number) => Math.round(n * 100) / 100;

export type Totals = {
  /** сумма по ценам каталога */
  subtotal: number;
  discountPct: number;
  /** итог к оплате со скидкой */
  total: number;
  /** оплатить сейчас (предоплата / всё / 0 для «уточнит менеджер») */
  dueNow: number;
  /** оплатить при получении */
  later: number;
  /** цена за штуку со скидкой по каждой строке — снимок в OrderItem.unitPrice */
  unitPrices: number[];
};

/** Расчёт как в старом магазине: скидка за полную оплату — для «повна оплата» и «на картку»; предоплата не больше итога. */
export function computeTotals(lines: Array<{ price: number; qty: number }>, pay: PayChoice | "later", s: CheckoutSettings): Totals {
  const discountPct = pay === "full" || pay === "card" ? s.fullPayDiscountPct : 0;
  const unitPrices = lines.map((l) => round2(l.price * (1 - discountPct / 100)));
  const subtotal = round2(lines.reduce((a, l) => a + l.price * l.qty, 0));
  const total = round2(lines.reduce((a, l, i) => a + unitPrices[i] * l.qty, 0));
  const dueNow = pay === "prepay" ? round2(Math.min(s.prepayAmount, total)) : pay === "later" ? 0 : total;
  return { subtotal, discountPct, total, dueNow, later: round2(total - dueNow), unitPrices };
}

/** Номер заказа для покупателя: HM-1001, HM-1002… (seq — счётчик базы). */
export const orderNumber = (seq: number) => `HM-${1000 + seq}`;

// ---------- форма оформления ----------

/** address — «кур’єр НП на адресу»: больше не предлагается (решение владельца), остаётся для старых заказов. */
export type NpType = "warehouse" | "postomat" | "address";
/** Что можно выбрать при оформлении: відділення або поштомат. */
export const NP_TYPES: NpType[] = ["warehouse", "postomat"];

export type CheckoutInput = {
  firstName: string;
  lastName: string;
  phone: string;
  delivery: DeliveryChoice;
  npType?: NpType;
  city?: string;
  /** номер отделения/почтомата или адрес курьера НП */
  npPoint?: string;
  /** коды из справочника НП (выбрано из списка); проверяются на сервере */
  npCityRef?: string;
  npPointRef?: string;
  /** самовывоз: код магазина (Warehouse.id); проверяется на сервере */
  pickupId?: string;
  /** адрес курьера по Одессе */
  address?: string;
  pay: PayChoice;
  comment?: string;
  noCallback?: boolean;
  items: CartLineInput[];
};

/** Ошибки — ключи текстов витрины (показываются на языке сайта). */
export type CheckoutErrors = Partial<Record<"firstName" | "lastName" | "phone" | "delivery" | "city" | "npPoint" | "address" | "pickup" | "pay" | "items" | "noCallback", string>>;

export type CheckoutCheck =
  | { ok: true; value: CheckoutInput & { phone: string } }
  | { ok: false; errors: CheckoutErrors };

const NP_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PICKUP_ID = /^[A-Za-z0-9_-]{1,40}$/;
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Проверка формы оформления. `levels` — наличие товаров корзины (с сервера): если есть «під замовлення»,
 * отказаться от звонка нельзя. `settings` — какие способы включены.
 */
export function validateCheckout(raw: Record<string, unknown>, s: CheckoutSettings, levels: StockLevel[] = []): CheckoutCheck {
  const errors: CheckoutErrors = {};
  const firstName = txt(raw.firstName, 60);
  const lastName = txt(raw.lastName, 60);
  const phone = normalizePhone(String(raw.phone ?? ""));
  const delivery = String(raw.delivery ?? "") as DeliveryChoice;
  const pay = String(raw.pay ?? "") as PayChoice;
  const items = cleanCart(raw.items);
  if (firstName.length < 2) errors.firstName = "errName";
  if (lastName.length < 2) errors.lastName = "err.lastName";
  if (!phone) errors.phone = "errPhone";
  if (!items.length) errors.items = "emptyT";
  if (!s.delivery[delivery]) errors.delivery = "err.delivery";
  if (!s.pay[pay]) errors.pay = "err.pay";

  const value: CheckoutInput & { phone: string } = {
    firstName, lastName, phone: phone ?? "", delivery, pay, items,
    comment: txt(raw.comment, 500) || undefined,
    noCallback: raw.noCallback === true || raw.noCallback === "on",
  };
  if (delivery === "np") {
    const npType = (NP_TYPES as string[]).includes(String(raw.npType)) ? (String(raw.npType) as NpType) : "warehouse";
    value.npType = npType;
    value.city = txt(raw.city, 80);
    value.npPoint = txt(raw.npPoint, 160);
    if (value.city.length < 2) errors.city = "err.city";
    if (value.npPoint.length < 1) errors.npPoint = "err.npPoint";
    const ref = (v: unknown) => (typeof v === "string" && NP_REF.test(v) ? v : undefined);
    value.npCityRef = ref(raw.npCityRef);
    value.npPointRef = value.npCityRef ? ref(raw.npPointRef) : undefined;
  } else if (delivery === "pickup") {
    const id = String(raw.pickupId ?? "");
    if (PICKUP_ID.test(id)) value.pickupId = id;
  } else if (delivery === "courier") {
    value.address = txt(raw.address, 160);
    if (value.address.length < 5) errors.address = "errAddr";
  }
  if (value.noCallback && !canSkipCall(levels)) value.noCallback = false; // «під замовлення» — звоним обязательно
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// ---------- статусы заказа (подписи для админки и сообщений менеджеру) ----------

export const ORDER_STATUS_RU: Record<string, string> = {
  NEW: "Новый",
  NO_ANSWER: "Не дозвонились",
  AWAITING_SUPPLIER: "Ждём товар от поставщика",
  PAID: "Оплачен",
  PACKED: "Собран",
  SHIPPED: "Отправлен",
  DONE: "Выполнен",
  CANCELLED: "Отменён",
  RETURNED: "Возврат",
};

export const PAY_MODE_RU: Record<string, string> = { PREPAY: "Предоплата", FULL: "Полная оплата на сайте", CARD: "По реквизитам", LATER: "Уточнит менеджер" };
export const DELIVERY_RU: Record<string, string> = { NOVA_POSHTA: "Нова Пошта", COURIER_ODESA: "Курьер по Одессе", PICKUP: "Самовывоз", TO_CONFIRM: "Уточнит менеджер" };
export const NP_TYPE_RU: Record<string, string> = { warehouse: "отделение", postomat: "почтомат", address: "курьер НП на адрес" };
