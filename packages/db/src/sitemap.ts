// Данные для карты сайта (шаг Л1). Какие адреса попадают в карту — решает @handyman/core/sitemap; здесь только чтение базы.
// Товары — те же, что открываются на витрине (видимые, не «Нераспределённые»; см. loadProduct в apps/web/lib/shop/product.ts),
// по порядку артикулов — чтобы большие карты делились на файлы и кусками кэшировались одинаково.

import { prisma } from "./client";
import { HIDDEN_CATEGORY_IDS } from "@handyman/core/catalog";
import { SHOP_LANGS } from "@handyman/core/site/routes";
import { sitemapPagePaths, type SitemapPath, type SitemapProduct, type SitemapSource } from "@handyman/core/sitemap";
import { loadMenuConfig } from "./site-content";

const productWhere = { visible: true, categoryId: { notIn: HIDDEN_CATEGORY_IDS } };

/** Меню, категории со счётчиками видимых товаров, страницы «Сайт → Страницы». */
export async function loadSitemapSource(): Promise<SitemapSource> {
  const [menu, categories, counts, pages] = await Promise.all([
    loadMenuConfig(),
    prisma.category.findMany({ select: { id: true, parentId: true } }),
    prisma.product.groupBy({ by: ["categoryId"], where: productWhere, _count: { _all: true } }),
    prisma.page.findMany({ select: { slug: true, visible: true }, orderBy: [{ sort: "asc" }, { slug: "asc" }] }),
  ]);
  return { menu, categories, counts: Object.fromEntries(counts.map((c) => [c.categoryId, c._count._all])), pages };
}

/** Адреса без товаров и число товаров — всё, что нужно, чтобы решить, сколько файлов у карты. */
export async function loadSitemapBase(): Promise<{ pages: SitemapPath[]; products: number }> {
  const [src, products] = await Promise.all([loadSitemapSource(), prisma.product.count({ where: productWhere })]);
  return { pages: sitemapPagePaths(src), products };
}

/** Товары карты по порядку артикулов: [skip, skip + take). */
export async function loadSitemapProducts(skip: number, take: number): Promise<SitemapProduct[]> {
  const rows = await prisma.product.findMany({ where: productWhere, select: { sku: true, nameUk: true, updatedAt: true }, orderBy: { sku: "asc" }, skip, take });
  return rows.map((r) => ({ sku: r.sku, nameUk: r.nameUk, updatedAt: r.updatedAt.toISOString() }));
}

/** Для «Проверки перед запуском»: сколько строк в карте (оба языка) и сколько в ней товаров. */
export async function sitemapStats(): Promise<{ urls: number; products: number }> {
  const b = await loadSitemapBase();
  return { urls: (b.pages.length + b.products) * SHOP_LANGS.length, products: b.products };
}
