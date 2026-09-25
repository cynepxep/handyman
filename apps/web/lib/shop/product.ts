// Данные страницы товара: сам товар (фото, характеристики, описание), место в меню для хлебных крошек, похожие товары.
import "server-only";
import { cache } from "react";
import { prisma } from "@handyman/db";
import { searchProducts, SearchUnavailableError } from "@handyman/db/catalog-search";
import { HIDDEN_CATEGORY_IDS, menuPlaceOf, sanitizeHtml, type MenuConfig } from "@handyman/core/catalog";
import type { ShopLang } from "@handyman/core/site";
import { getCategoryStats, toCards, type ShopCard } from "./catalog";

/** Товар по артикулу. Скрытый или «Нераспределённый» — как будто его нет (страница 404). */
export const loadProduct = cache(async (sku: string) => {
  const p = await prisma.product.findUnique({
    where: { sku },
    include: {
      images: { orderBy: { sort: "asc" }, select: { url: true } },
      attributes: { orderBy: { sort: "asc" }, select: { key: true, value: true } },
      brand: { select: { name: true } },
    },
  });
  if (!p || !p.visible || HIDDEN_CATEGORY_IDS.includes(p.categoryId)) return null;
  const price = p.price.toNumber();
  const old = p.oldPrice?.toNumber() ?? null;
  return {
    id: p.id,
    sku: p.sku,
    nameUk: p.nameUk,
    nameRu: p.nameRu,
    descUk: p.descUk,
    descRu: p.descRu,
    price,
    oldPrice: old && old > price ? old : null,
    discountPct: old && old > price ? Math.round((1 - price / old) * 100) : 0,
    available: p.supplierAvailable,
    brand: p.brand?.name ?? null,
    categoryId: p.categoryId,
    images: p.images.map((i) => i.url),
    attributes: p.attributes.map((a) => ({ name: a.key.trim(), value: a.value.trim() })).filter((a) => a.name && a.value),
  };
});

export type ProductData = NonNullable<Awaited<ReturnType<typeof loadProduct>>>;

/** Где товар лежит в меню витрины (группа и подгруппа) — для хлебных крошек. */
export async function productPlace(menu: MenuConfig, categoryId: string) {
  const { cats } = await getCategoryStats();
  return menuPlaceOf(cats, menu.groups, categoryId);
}

/** Описание на языке сайта (русского нет — украинское), очищенное от опасного HTML. */
export const productDescription = (p: ProductData, lang: ShopLang) => sanitizeHtml((lang === "ru" && p.descRu?.trim()) || p.descUk || "");

/** Похожие товары: та же категория, сначала в наличии, без самого товара. */
export async function similarProducts(p: ProductData, lang: ShopLang, limit = 8): Promise<ShopCard[]> {
  try {
    const res = await searchProducts({ categories: [p.categoryId], perPage: limit + 1 });
    return toCards(res.items.filter((i) => i.id !== p.id).slice(0, limit), lang);
  } catch (e) {
    if (e instanceof SearchUnavailableError) return [];
    throw e;
  }
}
