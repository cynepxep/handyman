// Данные каталога для витрины: карточки товаров с ключевыми характеристиками, группы меню со счётчиками и фото,
// задачи, батареи, акции. Только чтение. Меню и задачи — из настроек владельца (админка «Сайт → Меню и задачи»).
import "server-only";
import { cache } from "react";
import { prisma } from "@handyman/db";
import { searchProducts, SearchUnavailableError, type SearchItem } from "@handyman/db/catalog-search";
import {
  HIDDEN_CATEGORY_IDS, assignCategories, extractFacets, pickSpecs, slugOf, taskCategoryIds,
  type MenuConfig, type MenuGroup, type Spec, type Task,
} from "@handyman/core/catalog";
import { paths, shopHref, type ShopLang } from "@handyman/core/site";
import type { CardData } from "@/components/shop/product-card";

/** Карточка товара для списка (с готовой ссылкой на страницу товара на языке сайта). */
export type ShopCard = CardData & { specs: Spec[] };

export type GroupView = { group: MenuGroup; total: number; image: string | null; subs: Array<{ id: string; slug: string; nameUk: string; nameRu: string; total: number; hidden: boolean }> };
export type TaskView = { task: Task; total: number };

/** Категория с этим кодом содержит аккумуляторный инструмент: из неё берётся блок «Яка у вас батарея?». */
export const BATTERY_CATEGORY_ID = "ak";

const discountPct = (price: number, old: number | null) => (old && old > price ? Math.round((1 - price / old) * 100) : 0);

/** Дерево категорий и число товаров прямо в каждой — одним заходом на запрос. */
export const getCategoryStats = cache(async () => {
  const [cats, counts] = await Promise.all([
    prisma.category.findMany({ select: { id: true, nameUk: true, nameRu: true, parentId: true } }),
    prisma.product.groupBy({ by: ["categoryId"], where: { visible: true }, _count: { _all: true } }),
  ]);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const direct = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  /** Цепочка названий категорий сверху вниз (из неё берётся серия батареи для характеристик). */
  const chainOf = (id: string): string[] => {
    const out: string[] = [];
    for (let cur = byId.get(id), i = 0; cur && i < 6; cur = cur.parentId ? byId.get(cur.parentId) : undefined, i++) out.unshift(cur.nameUk);
    return out;
  };
  return { cats, byId, direct, chainOf };
});

/** Карточки для списка: название на языке сайта и до трёх характеристик (два запроса на весь список). */
export async function toCards(items: SearchItem[], lang: ShopLang, specOrder?: string[]): Promise<ShopCard[]> {
  const ids = items.map((i) => i.id);
  const [{ chainOf }, rows] = await Promise.all([
    getCategoryStats(),
    ids.length ? prisma.productAttribute.findMany({ where: { productId: { in: ids } }, select: { productId: true, key: true, value: true }, orderBy: { sort: "asc" } }) : [],
  ]);
  const params = new Map<string, { name: string; value: string }[]>();
  for (const r of rows) (params.get(r.productId) ?? params.set(r.productId, []).get(r.productId)!).push({ name: r.key, value: r.value });
  return items.map((i) => ({
    id: i.id,
    sku: i.sku,
    name: lang === "ru" && i.nameRu ? i.nameRu : i.nameUk,
    // адрес товара строится из украинского названия — одинаковый для обоих языков (кроме приставки /ru)
    href: shopHref(lang, paths.product(i.sku, i.nameUk)),
    price: i.price,
    oldPrice: i.oldPrice,
    discountPct: i.discountPct,
    available: i.available,
    image: i.image,
    specs: pickSpecs(extractFacets(params.get(i.id) ?? [], chainOf(i.categoryId)), specOrder),
  }));
}

/** Группы меню со счётчиками товаров и фото (самый дорогой товар в наличии из группы — обычно самый «представительный»). */
export async function getMenuView(menu: MenuConfig) {
  const { cats, direct } = await getCategoryStats();
  const { subOf, conflicts, missing } = assignCategories(cats, menu.groups);
  const tops = await prisma.$queryRaw<Array<{ categoryId: string; price: number; url: string }>>`
    SELECT DISTINCT ON (p."categoryId") p."categoryId", p.price::float8 AS price,
      (SELECT i.url FROM "ProductImage" i WHERE i."productId" = p.id ORDER BY i.sort LIMIT 1) AS url
    FROM "Product" p
    WHERE p.visible AND p."supplierAvailable" AND EXISTS (SELECT 1 FROM "ProductImage" i WHERE i."productId" = p.id)
    ORDER BY p."categoryId", p.price DESC`;
  const topOf = new Map(tops.map((t) => [t.categoryId, t]));

  const subTotal = new Map<string, number>();
  const catsOfSub = new Map<string, string[]>();
  for (const [catId, subId] of subOf) {
    subTotal.set(subId, (subTotal.get(subId) ?? 0) + (direct.get(catId) ?? 0));
    (catsOfSub.get(subId) ?? catsOfSub.set(subId, []).get(subId)!).push(catId);
  }

  const groups: GroupView[] = menu.groups.map((group) => {
    const catIds = group.subs.flatMap((s) => catsOfSub.get(s.id) ?? []);
    const best = catIds.map((id) => topOf.get(id)).filter((x) => x != null).sort((a, b) => b.price - a.price)[0];
    const subs = group.subs.map((s) => ({ id: s.id, slug: slugOf(s), nameUk: s.nameUk, nameRu: s.nameRu, total: subTotal.get(s.id) ?? 0, hidden: s.hidden === true }));
    return { group, total: subs.reduce((a, s) => a + s.total, 0), image: best?.url ?? null, subs };
  });
  const tasks: TaskView[] = menu.tasks.map((task) => ({ task, total: taskCategoryIds(cats, task).reduce((a, id) => a + (direct.get(id) ?? 0), 0) }));
  const lost = cats.filter((c) => !HIDDEN_CATEGORY_IDS.includes(c.id) && (direct.get(c.id) ?? 0) > 0 && !subOf.has(c.id)).length;
  return { groups, tasks, problems: { conflicts, missing, lost } };
}

/** Серии аккумуляторов со счётчиками — для «Яка у вас батарея?». Если поиск недоступен — пусто. */
export async function getBatteries(): Promise<Array<{ value: string; count: number }>> {
  try {
    const ak = await searchProducts({ cat: BATTERY_CATEGORY_ID, perPage: 1 });
    return (ak.facets.attrs.find((a) => a.key === "series")?.values ?? []).map((v) => ({ value: v.value, count: v.count }));
  } catch (e) {
    if (e instanceof SearchUnavailableError) return [];
    throw e;
  }
}

/** Акции: товары в наличии со старой ценой, скидка от 10 %, дороже 100 ₴ — самые большие скидки первыми. */
export async function getSaleCards(lang: ShopLang, limit = 8): Promise<ShopCard[]> {
  const rows = await prisma.product.findMany({
    where: { visible: true, oldPrice: { not: null }, supplierAvailable: true, categoryId: { notIn: HIDDEN_CATEGORY_IDS }, images: { some: {} } },
    select: { id: true, sku: true, nameUk: true, nameRu: true, price: true, oldPrice: true, categoryId: true, images: { take: 1, orderBy: { sort: "asc" }, select: { url: true } } },
  });
  const items: SearchItem[] = rows
    .map((r) => {
      const price = r.price.toNumber();
      const old = r.oldPrice ? r.oldPrice.toNumber() : null;
      return { r, price, old, pct: discountPct(price, old) };
    })
    .filter((x) => x.pct >= 10 && x.price >= 100)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, limit)
    .map(({ r, price, old, pct }) => ({
      id: r.id, sku: r.sku, nameUk: r.nameUk, nameRu: r.nameRu, brand: null, price, oldPrice: old, discountPct: pct, available: true,
      image: r.images[0]?.url ?? null, categoryId: r.categoryId,
    }));
  return toCards(items, lang);
}
