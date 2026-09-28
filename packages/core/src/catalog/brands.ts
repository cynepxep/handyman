// Бренды в фиде поставщика: какие встречаются, какой наш бренд им ставить и что не загружать.
// Чистая логика без базы; запись решений — packages/db/src/catalog-import.ts (таблица FeedBrandMap).

import type { FeedItem } from "./feed-parse";

/** Условный ключ для товаров, у которых в фиде бренд не указан (у Vitals — все). */
export const NO_BRAND_KEY = "(без бренду)";

/** Ключ бренда из фида: регистр и лишние пробелы не важны («MILWAUKEE» = «Milwaukee»). */
export function vendorKey(vendor: string | null | undefined): string {
  const v = (vendor ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return v || NO_BRAND_KEY;
}

/**
 * Решение по бренду фида (то, что получает планировщик):
 * brand — ставить этот наш бренд (null — без бренда; «new:<название>» — бренд создаётся при применении);
 * skip — такие товары не загружать.
 */
export type BrandDecision = { kind: "brand"; brandId: string | null } | { kind: "skip" };

/** Ключ — vendorKey(...). Нет ключа — берётся бренд по умолчанию (PlanOptions.brandId). */
export type BrandMapping = ReadonlyMap<string, BrandDecision>;

/** Выбор владельца, как он хранится (FeedBrandMap): конкретный бренд, «без бренда» или «не загружать». */
export type StoredBrandChoice = { brandId: string | null; skip: boolean };

/** Что предлагает программа: найден наш бренд, создать новый, без бренда. */
export type BrandSuggestion = { kind: "brand"; brandId: string } | { kind: "new"; name: string } | { kind: "none" };

/** Префикс временного кода для бренда, который будет создан при применении. */
export const NEW_BRAND_PREFIX = "new:";

/** Автоподсказка: бренд из фида ищем среди наших (без учёта регистра), иначе — новый; нет бренда в фиде — бренд поставщика по умолчанию. */
export function suggestBrand(
  vendor: string | null,
  brands: ReadonlyArray<{ id: string; name: string }>,
  defaultBrand: string | null,
): BrandSuggestion {
  const name = vendor?.replace(/\s+/g, " ").trim() || defaultBrand?.trim() || "";
  if (!name) return { kind: "none" };
  const hit = brands.find((b) => b.name.trim().toLowerCase() === name.toLowerCase());
  return hit ? { kind: "brand", brandId: hit.id } : { kind: "new", name };
}

export type VendorCount = { key: string; name: string; count: number };

/** Бренды фида с количеством товаров: сначала самые частые, «без бренда» — в конце. Название — как чаще всего написано в фиде. */
export function countVendors(items: ReadonlyArray<Pick<FeedItem, "vendor">>): VendorCount[] {
  const map = new Map<string, { count: number; spell: Map<string, number> }>();
  for (const it of items) {
    const key = vendorKey(it.vendor);
    const cur = map.get(key) ?? { count: 0, spell: new Map<string, number>() };
    cur.count++;
    const shown = it.vendor?.replace(/\s+/g, " ").trim() || NO_BRAND_KEY;
    cur.spell.set(shown, (cur.spell.get(shown) ?? 0) + 1);
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, count: v.count, name: [...v.spell.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => (a.key === NO_BRAND_KEY ? 1 : b.key === NO_BRAND_KEY ? -1 : b.count - a.count || a.name.localeCompare(b.name)));
}

/** Итог для планировщика: выбор владельца, иначе автоподсказка (новый бренд — временный код «new:<название>»). */
export function decideBrand(stored: StoredBrandChoice | undefined, suggestion: BrandSuggestion): BrandDecision {
  if (stored) return stored.skip ? { kind: "skip" } : { kind: "brand", brandId: stored.brandId };
  if (suggestion.kind === "brand") return { kind: "brand", brandId: suggestion.brandId };
  if (suggestion.kind === "new") return { kind: "brand", brandId: NEW_BRAND_PREFIX + suggestion.name };
  return { kind: "brand", brandId: null };
}

/** Название бренда для владельца: как показать решение в отчёте. */
export function brandDecisionText(d: BrandDecision, names: ReadonlyMap<string, string>): string {
  if (d.kind === "skip") return "не загружать";
  if (!d.brandId) return "без бренда";
  if (d.brandId.startsWith(NEW_BRAND_PREFIX)) return `новый бренд «${d.brandId.slice(NEW_BRAND_PREFIX.length)}»`;
  return names.get(d.brandId) ?? d.brandId;
}
