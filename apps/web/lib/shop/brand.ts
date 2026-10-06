// Основной бренд витрины и выбор покупателя («Milwaukee / Vitals / Усі»): правила — @handyman/core/site/brand-focus.ts.
// Основной бренд — «Сайт → Главная» (по умолчанию Milwaukee); действует, только когда его товаров на сайте не меньше FOCUS_MIN_PRODUCTS.
// Выбор покупателя — ?b=… в адресе (proxy.ts запоминает его в куке hm_brand), иначе кука, иначе основной бренд.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@handyman/db";
import { loadHomeSettings } from "@handyman/db/site-content";
import { HIDDEN_CATEGORY_IDS } from "@handyman/core/catalog";
import {
  BRAND_COOKIE, FOCUS_MIN_PRODUCTS, brandKey, brandScope, brandSwitchOptions, parseBrandChoice, type BrandChoice, type BrandScope,
} from "@handyman/core/site";
import { TAG_CATALOG, TAG_SHOP, cached } from "./cache";

/** Бренды с видимыми товарами: название → сколько (кэш, сброс при правке товаров и импорте). */
const loadBrandCounts = cached(
  async (): Promise<Record<string, number>> => {
    const rows = await prisma.product.groupBy({ by: ["brandId"], where: { visible: true, categoryId: { notIn: HIDDEN_CATEGORY_IDS }, brandId: { not: null } }, _count: { _all: true } });
    const names = await prisma.brand.findMany({ where: { id: { in: rows.map((r) => r.brandId!) } }, select: { id: true, name: true } });
    const nameOf = new Map(names.map((b) => [b.id, b.name]));
    return Object.fromEntries(rows.flatMap((r) => (nameOf.has(r.brandId!) ? [[nameOf.get(r.brandId!)!, r._count._all]] : [])));
  },
  "brand-counts", [TAG_CATALOG, TAG_SHOP], 300,
);

/** Основной бренд (точное название, как в базе) или null — выключен владельцем или товаров бренда мало. */
export const getFocusBrand = cache(async (): Promise<{ focus: string | null; brands: string[] }> => {
  const [home, counts] = await Promise.all([loadHomeSettings().catch(() => null), loadBrandCounts().catch(() => ({}) as Record<string, number>)]);
  const brands = Object.keys(counts);
  const want = brandKey(home?.focusBrand ?? "");
  const focus = want ? brands.find((b) => brandKey(b) === want) ?? null : null;
  return { focus: focus && (counts[focus] ?? 0) >= FOCUS_MIN_PRODUCTS ? focus : null, brands };
});

export type BrandState = {
  /** основной бренд (null — выключено: всё как раньше, переключателя нет) */
  focus: string | null;
  choice: BrandChoice;
  /** фильтр для поиска (null — все бренды) */
  scope: BrandScope | null;
  /** покупатель выбрал сам (?b= или кука) — тогда пустой список не подменяется на «Усі» */
  explicit: boolean;
};

/** Что показывать: `raw` — значение ?b= из адреса (нет — смотрим куку). */
export const getBrandState = cache(async (raw?: string): Promise<BrandState> => {
  const { focus, brands } = await getFocusBrand();
  if (!focus) return { focus: null, choice: { mode: "all" }, scope: null, explicit: false };
  const value = raw ?? (await cookies()).get(BRAND_COOKIE)?.value;
  const choice = parseBrandChoice(value, focus, brands);
  return { focus, choice, scope: brandScope(choice, focus), explicit: choice.mode !== "focus" };
});

/** Кнопки бренда для страницы «Каталог» (по всем товарам сайта). Нет основного бренда или других брендов — пусто. */
export async function getCatalogBrandSwitch(raw?: string) {
  const bs = await getBrandState(raw);
  if (!bs.focus) return [];
  return brandSwitchOptions(bs.focus, bs.choice, await loadBrandCounts().catch(() => ({})));
}
