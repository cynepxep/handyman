"use server";

// Нова Пошта для оформления заказа: поиск города и отделения/почтомата. Запросы к НП — только с сервера (кэш на сутки).
// null — НП сейчас не отвечает: в форме поля работают как обычный текст.
import { npCities, npPoints, type NpCity } from "@handyman/db/novaposhta";
import { npEstimateForItems } from "@handyman/db/np-shipments";
import { clientDiscountFor, loadCheckoutSettings, quoteCart } from "@handyman/db/orders";
import { computeTotals, isNpRef, type PayChoice } from "@handyman/core/shop";
import { getClient } from "@/lib/client-auth";

/** label — «Відділення №12 (до 30 кг…)», hint — адрес «вул. Софіївська, 34» (в списке мелко под номером). */
export type NpOption = { ref: string; label: string; hint?: string };

export async function npCitiesAction(q: unknown): Promise<NpCity[] | null> {
  return typeof q === "string" ? npCities(q) : [];
}

export async function npPointsAction(cityRef: unknown, kind: unknown, q: unknown, lang: unknown): Promise<NpOption[] | null> {
  if (typeof cityRef !== "string" || (kind !== "warehouse" && kind !== "postomat")) return [];
  const list = await npPoints(cityRef, kind, typeof q === "string" ? q : "");
  return (
    list &&
    list.map((p) => {
      const text = lang === "ru" ? p.ru : p.uk;
      const i = text.indexOf(": ");
      return i > 0 ? { ref: p.ref, label: text.slice(0, i), hint: text.slice(i + 2) } : { ref: p.ref, label: text };
    })
  );
}

/** Шаг 3.4: примерная стоимость и дата доставки НП в город покупателя; `date` — «гггг-мм-дд». null — НП не ответила. */
export type NpEstimateView = { cost: number | null; free: boolean; date: string | null };

/**
 * Стоимость и срок для корзины/оформления/товара: сумма и вес — по товарам из базы (цены с сервера, со скидкой покупателя при выбранной оплате),
 * «бесплатно» — по тому же правилу, что при заказе.
 */
export async function npEstimateAction(cityRef: unknown, items: unknown, pay?: unknown): Promise<NpEstimateView | null> {
  if (!isNpRef(cityRef)) return null;
  const client = await getClient();
  const [q, settings] = await Promise.all([quoteCart(items, { clientId: client?.id }), loadCheckoutSettings()]);
  if (!q.lines.length) return null;
  const p: PayChoice = pay === "full" || pay === "card" ? pay : "prepay";
  const t = computeTotals(q.lines, p, settings, await clientDiscountFor(client?.id));
  return npEstimateForItems(cityRef, t.total, q.lines.map((l) => ({ productId: l.productId, qty: l.qty })));
}
