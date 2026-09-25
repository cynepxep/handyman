// Параметры списка товаров в адресе: ?f.diameter=125&f.diameter=180&avail=1&fast=1&sale=1&hit=1&new=1&min=100&max=500&sort=price_asc&page=2
// Одно место для страниц разделов, поиска, API и кнопок фильтров (разбор и сборка адреса). Без зависимостей: работает и в браузере.

export const LISTING_SORTS = ["relevance", "price_asc", "price_desc", "new", "name"] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export type ListingState = {
  /** код фильтра (FACET_DEFS) → выбранные значения */
  facets: Record<string, string[]>;
  available: boolean;
  /** только наш склад в Одессе («Швидка відправка з Одеси») */
  local: boolean;
  sale: boolean;
  /** только «Хіти» / «Новинки» (ссылка «Усі» с главной) */
  hit?: boolean;
  isNew?: boolean;
  min?: number;
  max?: number;
  sort?: ListingSort;
  page: number;
};

type Raw = URLSearchParams | Record<string, string | string[] | undefined>;

const all = (raw: Raw, key: string): string[] => {
  if (raw instanceof URLSearchParams) return raw.getAll(key);
  const v = raw[key];
  return v == null ? [] : Array.isArray(v) ? v : [v];
};
const first = (raw: Raw, key: string) => all(raw, key)[0];
const num = (v: string | undefined) => {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export const MAX_PAGE = 200;

/** Разобрать адрес. Неизвестные фильтры и мусор отбрасываются; значений одного фильтра — не больше 30. */
export function parseListing(raw: Raw, facetKeys: readonly string[]): ListingState {
  const facets: Record<string, string[]> = {};
  for (const key of facetKeys) {
    const values = [...new Set(all(raw, `f.${key}`).map((v) => v.trim().slice(0, 60)).filter(Boolean))].slice(0, 30);
    if (values.length) facets[key] = values;
  }
  const sort = first(raw, "sort");
  let min = num(first(raw, "min"));
  let max = num(first(raw, "max"));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return {
    facets,
    available: first(raw, "avail") === "1",
    local: first(raw, "fast") === "1",
    sale: first(raw, "sale") === "1",
    ...(first(raw, "hit") === "1" ? { hit: true } : {}),
    ...(first(raw, "new") === "1" ? { isNew: true } : {}),
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
    ...(sort && (LISTING_SORTS as readonly string[]).includes(sort) ? { sort: sort as ListingSort } : {}),
    page: Math.min(MAX_PAGE, Math.max(1, Math.floor(num(first(raw, "page")) ?? 1))),
  };
}

/** Собрать ?запрос. `q` — текст поиска (для страницы поиска). Страница 1 и пустые значения не пишутся. */
export function listingQuery(state: ListingState, q?: string): string {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  for (const [key, values] of Object.entries(state.facets)) for (const v of values) qs.append(`f.${key}`, v);
  if (state.available) qs.set("avail", "1");
  if (state.local) qs.set("fast", "1");
  if (state.sale) qs.set("sale", "1");
  if (state.hit) qs.set("hit", "1");
  if (state.isNew) qs.set("new", "1");
  if (state.min != null) qs.set("min", String(state.min));
  if (state.max != null) qs.set("max", String(state.max));
  if (state.sort) qs.set("sort", state.sort);
  if (state.page > 1) qs.set("page", String(state.page));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** Включить/выключить значение фильтра. `single` — быстрый выбор: остаётся только это значение. Страница сбрасывается на первую. */
export function toggleFacet(state: ListingState, key: string, value: string, single = false): ListingState {
  const cur = state.facets[key] ?? [];
  const on = cur.includes(value);
  const nextValues = single ? (on ? [] : [value]) : on ? cur.filter((v) => v !== value) : [...cur, value];
  const facets = { ...state.facets };
  if (nextValues.length) facets[key] = nextValues;
  else delete facets[key];
  return { ...state, facets, page: 1 };
}

/** Есть ли выбранные фильтры (для кнопки «Скинути»). Сортировка фильтром не считается. */
export const hasFilters = (s: ListingState) => Object.keys(s.facets).length > 0 || s.available || s.local || s.sale || !!s.hit || !!s.isNew || s.min != null || s.max != null;

/** Сбросить все фильтры, оставив сортировку. */
export const clearFilters = (s: ListingState): ListingState => ({ facets: {}, available: false, local: false, sale: false, page: 1, ...(s.sort ? { sort: s.sort } : {}) });

/** Сколько фильтров выбрано (число на кнопке «Фільтри»). */
export const filterCount = (s: ListingState) =>
  Object.values(s.facets).reduce((a, v) => a + v.length, 0) + Number(s.available) + Number(s.local) + Number(s.sale) + Number(!!s.hit) + Number(!!s.isNew) + Number(s.min != null || s.max != null);
