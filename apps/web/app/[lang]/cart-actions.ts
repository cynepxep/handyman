"use server";

// Действия корзины и оформления, которые вызывает браузер. Цены, наличие, суммы и проверку формы делает сервер;
// из браузера приходят только артикулы, количество и введённые покупателем данные.
import { headers } from "next/headers";
import { computeTotals, canSkipCall, type PayChoice, type StockLevel } from "@handyman/core/shop";
import { isShopLang, paths, shopHref, type ShopLang } from "@handyman/core/site";
import { loadCheckoutSettings, placeOneClick, placeOrder, quoteCart } from "@handyman/db/orders";
import { getStaffSession } from "@/lib/auth";
import { getShopContent } from "@/lib/shop/content";

export type CartLineView = {
  sku: string; name: string; href: string; image: string | null; price: number; oldPrice: number | null; stock: StockLevel; qty: number;
};
export type CartQuote = { lines: CartLineView[]; missing: string[]; subtotal: number };

const langOf = (l: unknown): ShopLang => (isShopLang(l) ? l : "uk");

/** Корзина с актуальными ценами и наличием (для мини-корзины и страницы корзины). */
export async function quoteCartAction(lang: unknown, items: unknown): Promise<CartQuote> {
  const l = langOf(lang);
  const q = await quoteCart(items);
  const lines = q.lines.map((x) => ({
    sku: x.sku, name: l === "ru" && x.nameRu ? x.nameRu : x.nameUk, href: shopHref(l, paths.product(x.sku, x.nameUk)),
    image: x.image, price: x.price, oldPrice: x.oldPrice, stock: x.stock, qty: x.qty,
  }));
  return { lines, missing: q.missing, subtotal: Math.round(lines.reduce((a, x) => a + x.price * x.qty, 0) * 100) / 100 };
}

export type CheckoutQuote = CartQuote & {
  totals: { subtotal: number; discountPct: number; total: number; dueNow: number; later: number };
  canSkipCall: boolean;
};

/** Итог для страницы оформления при выбранном способе оплаты. */
export async function checkoutQuoteAction(lang: unknown, items: unknown, pay: unknown): Promise<CheckoutQuote> {
  const [quote, settings] = await Promise.all([quoteCartAction(lang, items), loadCheckoutSettings()]);
  const p: PayChoice = pay === "full" || pay === "card" ? pay : "prepay";
  const t = computeTotals(quote.lines, p, settings);
  return {
    ...quote,
    totals: { subtotal: t.subtotal, discountPct: t.discountPct, total: t.total, dueNow: t.dueNow, later: t.later },
    canSkipCall: canSkipCall(quote.lines.map((x) => x.stock)),
  };
}

// ---------- защита от спама: не больше 5 заказов за 10 минут с одного адреса (в памяти сервера) ----------

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;
const hits = new Map<string, number[]>();

async function tooMany(): Promise<boolean> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((ts) => now - ts < WINDOW_MS);
  if (list.length >= LIMIT) return true;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // не даём таблице расти бесконечно
  return false;
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

/** Оформить заказ. Ошибки — сразу текстом на языке сайта. `website` — скрытое поле-ловушка для ботов. */
export async function placeOrderAction(lang: unknown, form: Record<string, unknown>): Promise<PlaceOrderResult> {
  const l = langOf(lang);
  const { t } = await getShopContent(l);
  if (typeof form?.website === "string" && form.website.trim()) return { ok: false, errors: {}, message: t("err.server") };
  if (await tooMany()) return { ok: false, errors: {}, message: t("err.tooMany") };
  try {
    const r = await placeOrder(form, { lang: l, isTest: await isStaff() });
    if (!r.ok) return { ok: false, errors: Object.fromEntries(Object.entries(r.errors).map(([k, key]) => [k, t(key ?? "err.server")])) };
    return { ok: true, url: shopHref(l, paths.order(r.no, r.accessKey)) };
  } catch (e) {
    console.error("[checkout] заказ не создан", e);
    return { ok: false, errors: {}, message: t("err.server") };
  }
}

/** «Купити в 1 клік». */
export async function oneClickAction(lang: unknown, form: { sku?: unknown; qty?: unknown; phone?: unknown; name?: unknown; website?: unknown }) {
  const l = langOf(lang);
  const { t } = await getShopContent(l);
  if (typeof form?.website === "string" && form.website.trim()) return { ok: false as const, message: t("err.server") };
  if (await tooMany()) return { ok: false as const, message: t("err.tooMany") };
  try {
    const r = await placeOneClick(form, { lang: l, isTest: await isStaff() });
    return r.ok ? { ok: true as const, message: t("oneClick.done", { no: r.no }) } : { ok: false as const, message: t(r.error) };
  } catch (e) {
    console.error("[one-click] заказ не создан", e);
    return { ok: false as const, message: t("err.server") };
  }
}
