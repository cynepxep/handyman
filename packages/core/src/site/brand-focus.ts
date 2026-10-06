// Основной бренд витрины (решение владельца 2026-10-06: «сайт Milwaukee + наш склад»).
// По умолчанию каталог, разделы, поиск и полки главной показывают товары основного бренда, а товары с нашего склада в Одессе
// (любого бренда) — всегда. Покупатель переключает «Milwaukee / Vitals / Усі» (адрес ?b=…, выбор запоминается в куке).
// Основной бренд — «Сайт → Главная» (HomeSettings.focusBrand); пусто — выключено (все бренды вместе, как раньше).
// Без зависимостей: работает и в браузере.

export const BRAND_PARAM = "b";
export const BRAND_COOKIE = "hm_brand";
/** «Усі бренди» в адресе. */
export const BRAND_ALL = "all";
/** Основной бренд включается, только когда его товаров на сайте хотя бы столько (иначе витрина была бы почти пустой). */
export const FOCUS_MIN_PRODUCTS = 20;
/** Основной бренд по умолчанию (владелец может выбрать другой или выключить). */
export const DEFAULT_FOCUS_BRAND = "Milwaukee";

/** Код бренда для адреса: «Milwaukee» → «milwaukee», «Black & Decker» → «black-decker». */
export function brandKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** Что выбрал покупатель: основной бренд (+ наш склад), один бренд или все. */
export type BrandChoice = { mode: "focus" } | { mode: "all" } | { mode: "brand"; brand: string };

/** Выбор из адреса/куки. Незнакомый бренд или основной — «основной». `brands` — бренды, которые есть на сайте. */
export function parseBrandChoice(raw: string | null | undefined, focus: string, brands: readonly string[]): BrandChoice {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === BRAND_ALL) return { mode: "all" };
  if (!v || v === brandKey(focus)) return { mode: "focus" };
  const brand = brands.find((b) => brandKey(b) === v);
  return brand ? { mode: "brand", brand } : { mode: "focus" };
}

/** Фильтр для поиска: бренды и «или наш склад». null — без ограничения. */
export type BrandScope = { brands: string[]; orLocal: boolean };

export function brandScope(choice: BrandChoice, focus: string): BrandScope | null {
  if (choice.mode === "all") return null;
  if (choice.mode === "brand") return { brands: [choice.brand], orLocal: false };
  return { brands: [focus], orLocal: true };
}

/** Значение для адреса (?b=…): основной бренд не пишется. */
export function brandParam(choice: BrandChoice): string | undefined {
  return choice.mode === "all" ? BRAND_ALL : choice.mode === "brand" ? brandKey(choice.brand) : undefined;
}

/**
 * Кнопки переключателя: основной бренд, остальные бренды, у которых есть товары в этом списке (по убыванию), и «Усі».
 * Других брендов нет — переключатель не нужен (пустой список).
 */
export function brandSwitchOptions(
  focus: string, choice: BrandChoice, counts: Readonly<Record<string, number>>,
): Array<{ key: string; label: string | null; current: boolean }> {
  const others = Object.entries(counts)
    .filter(([b, n]) => n > 0 && brandKey(b) !== brandKey(focus))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([b]) => b);
  if (choice.mode === "brand" && !others.includes(choice.brand)) others.unshift(choice.brand);
  if (!others.length) return [];
  return [
    { key: brandKey(focus), label: focus, current: choice.mode === "focus" },
    ...others.slice(0, 6).map((b) => ({ key: brandKey(b), label: b, current: choice.mode === "brand" && choice.brand === b })),
    // подпись «Усі» — из реестра текстов витрины (label: null)
    { key: BRAND_ALL, label: null, current: choice.mode === "all" },
  ];
}
