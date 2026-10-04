// Аналитика (шаг А1): товары для событий GA4 на сервере — цены из базы (с оптом и скидкой покупателя), категории — как в меню
// витрины (группа → подгруппа → категория каталога), названия — украинские (одинаковые в отчётах для обоих языков сайта).
import "server-only";
import { menuPlaceOf } from "@handyman/core/catalog";
import { cookies } from "next/headers";
import { UTM_COOKIE, analyticsItem, parseUtm, type AnalyticsItem, type PurchaseLine, type Utm } from "@handyman/core/shop";
import { prisma } from "@handyman/db";
import { quoteCart } from "@handyman/db/orders";
import { getCategoryStats } from "./catalog";
import { getShopContent } from "./content";

/** Названия для item_category…item_category3 по коду категории каталога. */
export async function analyticsCategoryNames(): Promise<(categoryId: string | null | undefined) => string[]> {
  const [{ cats, byId }, { menu }] = await Promise.all([getCategoryStats(), getShopContent("uk")]);
  const memo = new Map<string, string[]>();
  return (id) => {
    if (!id) return [];
    if (!memo.has(id)) {
      const place = menuPlaceOf(cats, menu.groups, id);
      memo.set(id, [place?.group.nameUk ?? "", place?.sub.nameUk ?? "", byId.get(id)?.nameUk ?? ""]);
    }
    return memo.get(id)!;
  };
}

export type AnalyticsLineInput = { sku: string; qty: number; atQty?: number };

/**
 * Товары для события по строкам { артикул, количество }: цена за штуку — как в корзине при количестве `atQty`
 * (например, после «У кошик» в корзине стало 3 шт. — цена опта от 3), `quantity` — сколько добавили/убрали.
 * Скрытые и удалённые товары пропускаются.
 */
export async function analyticsItemsFor(lines: AnalyticsLineInput[], clientId: string | null | undefined): Promise<AnalyticsItem[]> {
  const clean = lines.filter((l) => typeof l?.sku === "string" && l.sku.length <= 64 && Number.isFinite(l.qty)).slice(0, 100);
  if (!clean.length) return [];
  const [quote, rows, catsOf] = await Promise.all([
    quoteCart(clean.map((l) => ({ sku: l.sku, qty: Math.max(1, Math.floor(l.atQty ?? l.qty)) })), { clientId }),
    prisma.product.findMany({ where: { sku: { in: clean.map((l) => l.sku) } }, select: { sku: true, categoryId: true, brand: { select: { name: true } } } }),
    analyticsCategoryNames(),
  ]);
  const info = new Map(rows.map((r) => [r.sku, r]));
  const qtyOf = new Map(clean.map((l) => [l.sku, l.qty]));
  return quote.lines.map((q) =>
    analyticsItem({
      sku: q.sku, name: q.nameUk, brand: info.get(q.sku)?.brand?.name, categories: catsOf(info.get(q.sku)?.categoryId),
      price: q.price, qty: qtyOf.get(q.sku) ?? q.qty,
    }),
  );
}

/** Строки заказа для `purchase` — с категориями меню. */
export async function purchaseLinesWithCategories(lines: Array<PurchaseLine & { categoryId: string | null }>): Promise<PurchaseLine[]> {
  const catsOf = await analyticsCategoryNames();
  return lines.map(({ categoryId, ...l }) => ({ ...l, categories: catsOf(categoryId) }));
}

/** Метки последнего рекламного перехода (кука hm_utm, ставит proxy.ts) — для записи в заказ. */
export async function utmFromCookie(): Promise<Utm | null> {
  try {
    return parseUtm((await cookies()).get(UTM_COOKIE)?.value ?? null);
  } catch {
    return null;
  }
}
