"use server";

// Действия корзины и оформления, которые вызывает браузер. Цены, наличие, суммы и проверку формы делает сервер;
// из браузера приходят только артикулы, количество и введённые покупателем данные.
import { computeTotals, canSkipCall, nextQtyPrice, type PayChoice, type QtyPrice, type StockLevel } from "@handyman/core/shop";
import { isShopLang, paths, shopHref, type ShopLang } from "@handyman/core/site";
import { clientDiscountFor, loadCheckoutSettings, placeOneClick, placeOrder, quoteCart } from "@handyman/db/orders";
import { setReferrer } from "@handyman/db/clients";
import { prisma } from "@handyman/db";
import { getStaffSession } from "@/lib/auth";
import { getShopContent } from "@/lib/shop/content";
import { getClient, refCodeFromCookie } from "@/lib/client-auth";
import { logError } from "@handyman/db/errors";
import { guardForm } from "@/lib/antispam";
import { utmFromCookie } from "@/lib/shop/analytics";

/** Этап 5: приглашение засчитываем, если это первый заказ покупателя (и его ещё никто не пригласил). */
async function creditReferral(orderNo: string) {
  const ref = await refCodeFromCookie();
  if (!ref) return;
  const o = await prisma.order.findUnique({ where: { no: orderNo }, select: { clientId: true } });
  if (!o) return;
  if ((await prisma.order.count({ where: { clientId: o.clientId, isTest: false } })) === 1) await setReferrer(o.clientId, ref).catch(() => false);
}

export type CartLineView = {
  sku: string; name: string; href: string; image: string | null; price: number; oldPrice: number | null; stock: StockLevel; qty: number;
  /** шаг 5.6: обычная цена за штуку (если price меньше — применён опт/упаковка) и следующая ступенька «ещё N шт. — по X» */
  basePrice: number; next: { more: number; price: number } | null;
  /** лестница цен от количества: пока сервер пересчитывает новое количество, браузер показывает unitPriceAt(basePrice, tiers, qty) (шаг Л2) */
  tiers: QtyPrice[];
};
export type CartQuote = { lines: CartLineView[]; missing: string[]; subtotal: number };

const langOf = (l: unknown): ShopLang => (isShopLang(l) ? l : "uk");

/** Корзина с актуальными ценами и наличием (для мини-корзины и страницы корзины). */
export async function quoteCartAction(lang: unknown, items: unknown): Promise<CartQuote> {
  const l = langOf(lang);
  const client = await getClient();
  const q = await quoteCart(items, { clientId: client?.id });
  const lines = q.lines.map((x) => {
    const nx = nextQtyPrice(x.tiers, x.qty);
    return {
      sku: x.sku, name: l === "ru" && x.nameRu ? x.nameRu : x.nameUk, href: shopHref(l, paths.product(x.sku, x.nameUk)),
      image: x.image, price: x.price, oldPrice: x.oldPrice, stock: x.stock, qty: x.qty,
      basePrice: x.basePrice, next: nx ? { more: nx.minQty - x.qty, price: nx.unitPrice } : null, tiers: x.tiers,
    };
  });
  return { lines, missing: q.missing, subtotal: Math.round(lines.reduce((a, x) => a + x.price * x.qty, 0) * 100) / 100 };
}

export type CheckoutQuote = CartQuote & {
  totals: { subtotal: number; discountPct: number; total: number; dueNow: number; later: number };
  canSkipCall: boolean;
};

/** Итог для страницы оформления при выбранном способе оплаты. */
export async function checkoutQuoteAction(lang: unknown, items: unknown, pay: unknown): Promise<CheckoutQuote> {
  const [quote, settings, client] = await Promise.all([quoteCartAction(lang, items), loadCheckoutSettings(), getClient()]);
  const p: PayChoice = pay === "full" || pay === "card" ? pay : "prepay";
  const t = computeTotals(quote.lines, p, settings, await clientDiscountFor(client?.id)); // скидка вошедшего покупателя — та же, что при заказе
  return {
    ...quote,
    totals: { subtotal: t.subtotal, discountPct: t.discountPct, total: t.total, dueNow: t.dueNow, later: t.later },
    canSkipCall: canSkipCall(quote.lines.map((x) => x.stock)),
  };
}

/** Заказ сотрудника (вошёл в админку) помечается тестовым: не учитывается в статистике и не уйдёт в CRM. */
async function isStaff(): Promise<boolean> {
  try {
    return (await getStaffSession()) != null;
  } catch {
    return false;
  }
}

export type PlaceOrderResult = { ok: true; url: string } | { ok: false; errors: Record<string, string>; message?: string };

/**
 * Оформить заказ. Ошибки — сразу текстом на языке сайта. Защита от ботов (шаг 8.3): `website` — скрытое поле-ловушка, `fillMs` — сколько
 * форма была открыта, не больше 5 заказов за 10 минут с одного адреса (вместе с «1 клік»; счётчик в базе). Та же корзина с того же
 * телефона за 10 минут — открывается первый заказ (placeOrder).
 */
export async function placeOrderAction(lang: unknown, form: Record<string, unknown>): Promise<PlaceOrderResult> {
  const l = langOf(lang);
  const { t } = await getShopContent(l);
  try {
    const bad = await guardForm("order", form);
    if (bad) return { ok: false, errors: {}, message: t(bad) };
    const client = await getClient();
    const r = await placeOrder(form, { lang: l, isTest: await isStaff(), clientId: client?.id, utm: await utmFromCookie() });
    if (!r.ok) return { ok: false, errors: Object.fromEntries(Object.entries(r.errors).map(([k, key]) => [k, t(key ?? "err.server")])) };
    if (!r.duplicate) await creditReferral(r.no);
    return { ok: true, url: shopHref(l, paths.order(r.no, r.accessKey)) };
  } catch (e) {
    logError("[checkout] заказ не создан", e);
    return { ok: false, errors: {}, message: t("err.server") };
  }
}

/** «Купити в 1 клік». */
export type OneClickResult = { ok: true; message: string; no?: string; k?: string } | { ok: false; message: string };

export async function oneClickAction(lang: unknown, form: { sku?: unknown; qty?: unknown; phone?: unknown; name?: unknown; website?: unknown; fillMs?: unknown }): Promise<OneClickResult> {
  const l = langOf(lang);
  const { t } = await getShopContent(l);
  try {
    const bad = await guardForm("order", form);
    if (bad) return { ok: false, message: t(bad) };
    const client = await getClient();
    const r = await placeOneClick(form, { lang: l, isTest: await isStaff(), clientId: client?.id, utm: await utmFromCookie() });
    if (r.ok && !r.duplicate) await creditReferral(r.no);
    if (!r.ok) return { ok: false, message: t(r.error) };
    // номер и ключ — только для события покупки (шаг А1); повтор того же заказа ключ не получает
    return { ok: true, message: t("oneClick.done", { no: r.no }), ...(r.duplicate ? {} : { no: r.no, k: r.accessKey }) };
  } catch (e) {
    logError("[one-click] заказ не создан", e);
    return { ok: false, message: t("err.server") };
  }
}
