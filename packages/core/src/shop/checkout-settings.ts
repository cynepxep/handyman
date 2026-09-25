// Настройки оформления заказа: сумма предоплаты, скидка за полную оплату, какие способы доставки и оплаты включены.
// Хранятся в Setting («shop.checkout»), правятся владельцем в админке «Сайт → Оформлення». Подписи способов — тексты в «Сайт → Тексты».

export const CHECKOUT_SETTING_KEY = "shop.checkout";

export type PayChoice = "prepay" | "full" | "card";
export type DeliveryChoice = "np" | "pickup" | "courier";
export const PAY_CHOICES: PayChoice[] = ["prepay", "full", "card"];
export const DELIVERY_CHOICES: DeliveryChoice[] = ["np", "pickup", "courier"];

export type CheckoutSettings = {
  /** Сколько платить сразу при «Передплата», ₴ (остаток — при получении). */
  prepayAmount: number;
  /** Скидка за полную оплату (онлайн или на карту), %. 0 — без скидки (решение владельца на 2026-09-25). */
  fullPayDiscountPct: number;
  pay: Record<PayChoice, boolean>;
  delivery: Record<DeliveryChoice, boolean>;
};

export const DEFAULT_CHECKOUT: CheckoutSettings = {
  prepayAmount: 200,
  fullPayDiscountPct: 0,
  pay: { prepay: true, full: true, card: true },
  delivery: { np: true, pickup: true, courier: true },
};

const MAX_PREPAY = 100_000;
const MAX_DISCOUNT = 30;

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : def;
};

/** Прочитать сохранённые настройки; чего нет или сломано — стандартное. Хотя бы один способ всегда включён. */
export function parseCheckoutSettings(raw: unknown): CheckoutSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const flags = <K extends string>(v: unknown, keys: K[], def: Record<K, boolean>): Record<K, boolean> => {
    const src = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    const out = Object.fromEntries(keys.map((k) => [k, typeof src[k] === "boolean" ? (src[k] as boolean) : def[k]])) as Record<K, boolean>;
    return keys.some((k) => out[k]) ? out : { ...def };
  };
  return {
    prepayAmount: num(o.prepayAmount, DEFAULT_CHECKOUT.prepayAmount, 0, MAX_PREPAY),
    fullPayDiscountPct: num(o.fullPayDiscountPct, DEFAULT_CHECKOUT.fullPayDiscountPct, 0, MAX_DISCOUNT),
    pay: flags(o.pay, PAY_CHOICES, DEFAULT_CHECKOUT.pay),
    delivery: flags(o.delivery, DELIVERY_CHOICES, DEFAULT_CHECKOUT.delivery),
  };
}

export type SettingsFormResult = { ok: true; value: CheckoutSettings } | { ok: false; error: string };

/** Проверка формы админки (подписи ошибок — для владельца, по-русски). */
export function validateCheckoutSettingsForm(input: Record<string, string | undefined>): SettingsFormResult {
  const prepay = Number((input.prepayAmount ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(prepay) || prepay < 0 || prepay > MAX_PREPAY) return { ok: false, error: `Сумма предоплаты — число от 0 до ${MAX_PREPAY} ₴.` };
  const disc = Number((input.fullPayDiscountPct ?? "0").replace(",", ".") || 0);
  if (!Number.isFinite(disc) || disc < 0 || disc > MAX_DISCOUNT) return { ok: false, error: `Скидка за полную оплату — от 0 до ${MAX_DISCOUNT} %.` };
  const pay = Object.fromEntries(PAY_CHOICES.map((k) => [k, input[`pay.${k}`] === "on"])) as Record<PayChoice, boolean>;
  const delivery = Object.fromEntries(DELIVERY_CHOICES.map((k) => [k, input[`delivery.${k}`] === "on"])) as Record<DeliveryChoice, boolean>;
  if (!PAY_CHOICES.some((k) => pay[k])) return { ok: false, error: "Оставьте включённым хотя бы один способ оплаты." };
  if (!DELIVERY_CHOICES.some((k) => delivery[k])) return { ok: false, error: "Оставьте включённым хотя бы один способ доставки." };
  return { ok: true, value: { prepayAmount: Math.round(prepay * 100) / 100, fullPayDiscountPct: Math.round(disc * 100) / 100, pay, delivery } };
}
