// Поиск по каталогу через Meilisearch (обычный fetch, без библиотеки).
// Индекс — копия видимых товаров для быстрого поиска и фильтров; источник правды — PostgreSQL.
// Если Meilisearch недоступен, каталог и импорт работают, а индекс помечается устаревшим (см. markSearchStale).

import { prisma } from "./client";
import { loadMenuConfig } from "./site-content";
import {
  FACET_DEFS, FACET_FIELDS, UNSORTED_ID, extractFacets, facetField, fixKeyboardLayout, htmlToText, menuRanks, sortFacetValues, synonymMap,
} from "@handyman/core/catalog";
import { STOCK_RANK, stockLevel, type StockLevel } from "@handyman/core/shop";

export class SearchUnavailableError extends Error {
  constructor(message = "Поиск временно недоступен. Попробуйте позже.") {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

const host = () => (process.env.MEILI_HOST ?? "http://localhost:7700").replace(/\/$/, "");
const key = () => process.env.MEILI_MASTER_KEY ?? "";
const indexUid = () => process.env.MEILI_INDEX_PRODUCTS ?? "products";

async function meili<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(`${host()}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(key() ? { authorization: `Bearer ${key()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SearchUnavailableError();
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status >= 500) throw new SearchUnavailableError();
  return { status: res.status, data: data as T };
}

async function waitTask(taskUid: number, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { data } = await meili<{ status: string; error?: { message: string } }>("GET", `/tasks/${taskUid}`);
    if (data.status === "succeeded") return;
    if (data.status === "failed" || data.status === "canceled") throw new Error(`Задача поиска не выполнена: ${data.error?.message ?? data.status}`);
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error("Поиск слишком долго обновляется.");
}

async function task(method: string, path: string, body?: unknown) {
  const { status, data } = await meili<{ taskUid?: number; message?: string }>(method, path, body);
  if (status >= 400 || data?.taskUid == null) throw new Error(`Поиск: ${data?.message ?? `ошибка ${status}`}`);
  await waitTask(data.taskUid);
}

// ---------- документы ----------

export type SearchDoc = {
  id: string;
  sku: string;
  articleCode: string | null;
  nameUk: string;
  nameRu: string;
  nameSort: string;
  brand: string | null;
  categoryId: string;
  categoryIds: string[]; // сама категория и все родители (для «весь раздел»)
  categoryNames: string;
  price: number;
  oldPrice: number | null;
  hasDiscount: boolean;
  discountPct: number;
  available: boolean;
  /** наличие для покупателя: local — наш склад в Одессе, supplier — у поставщика, order — под заказ */
  stock: StockLevel;
  /** есть на нашем складе (фильтр «Швидка відправка з Одеси») */
  local: boolean;
  /** для сортировки: 2 — наш склад, 1 — поставщик, 0 — под заказ */
  inStock: 0 | 1 | 2;
  /** отметки владельца «Хіт» и «Новинка» (шаг 2.7) */
  hit: boolean;
  isNew: boolean;
  /** место категории в меню витрины (группа → подгруппа → порядок категорий): порядок «как в меню» в разделах */
  menuRank: number;
  image: string | null;
  descText: string;
  createdTs: number;
} & Record<string, unknown>;

type CatRow = { id: string; nameUk: string; parentId: string | null };

function chainOf(id: string, cats: Map<string, CatRow>): CatRow[] {
  const chain: CatRow[] = [];
  for (let cur = cats.get(id), i = 0; cur && i < 8; cur = cur.parentId ? cats.get(cur.parentId) : undefined, i++) chain.unshift(cur);
  return chain;
}

async function loadCatMap() {
  const rows = await prisma.category.findMany({ select: { id: true, nameUk: true, parentId: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

const NO_RANK = 999_999_999;

async function loadRanks(cats: Map<string, CatRow>) {
  return menuRanks([...cats.values()], (await loadMenuConfig()).groups);
}

async function buildDocs(where: { id?: { in: string[] } } = {}): Promise<{ docs: SearchDoc[]; hiddenIds: string[] }> {
  const cats = await loadCatMap();
  const ranks = await loadRanks(cats);
  const docs: SearchDoc[] = [];
  const hiddenIds: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.product.findMany({
      where,
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        brand: { select: { name: true } },
        images: { orderBy: { sort: "asc" }, take: 1, select: { url: true, localUrl: true } },
        attributes: { orderBy: { sort: "asc" }, select: { key: true, value: true } },
        stockItems: { select: { onHand: true } },
      },
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      // Скрытые и «Нераспределённые» покупателям не показываем.
      if (!r.visible || r.categoryId === UNSORTED_ID) {
        hiddenIds.push(r.id);
        continue;
      }
      const chain = chainOf(r.categoryId, cats);
      const price = r.price.toNumber();
      const oldPrice = r.oldPrice?.toNumber() ?? null;
      const doc: SearchDoc = {
        id: r.id, sku: r.sku, articleCode: r.articleCode, nameUk: r.nameUk, nameRu: r.nameRu,
        nameSort: r.nameUk.toLowerCase(),
        brand: r.brand?.name ?? null,
        categoryId: r.categoryId,
        categoryIds: chain.map((c) => c.id),
        categoryNames: chain.map((c) => c.nameUk).join(" "),
        price, oldPrice,
        hasDiscount: oldPrice != null && oldPrice > price,
        discountPct: oldPrice != null && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0,
        ...stockFields(r.stockItems.reduce((a, s) => a + s.onHand, 0), r.supplierAvailable),
        hit: r.isHit,
        isNew: r.isNew,
        menuRank: ranks.get(r.categoryId) ?? NO_RANK,
        image: r.images[0] ? (r.images[0].localUrl ?? r.images[0].url) : null, // своя копия, если уже скачана
        descText: htmlToText(r.descUk).slice(0, 400),
        createdTs: r.createdAt.getTime(),
      };
      const facets = extractFacets(r.attributes.map((a) => ({ name: a.key, value: a.value })), chain.map((c) => c.nameUk));
      for (const [k, values] of Object.entries(facets)) doc[facetField(k)] = values;
      docs.push(doc);
    }
  }
  return { docs, hiddenIds };
}

/** Поля наличия для индекса: «в наличии» = наш склад или поставщик; выше в списке то, что отправим быстрее. */
function stockFields(ownQty: number, supplierAvailable: boolean) {
  const stock = stockLevel(ownQty, supplierAvailable);
  return { stock, local: stock === "local", available: stock !== "order", inStock: STOCK_RANK[stock] };
}

// ---------- индекс ----------

const SETTINGS = () => ({
  searchableAttributes: ["nameUk", "nameRu", "sku", "articleCode", "brand", "categoryNames", "descText"],
  filterableAttributes: ["categoryIds", "categoryId", "brand", "price", "available", "local", "hasDiscount", "hit", "isNew", ...FACET_FIELDS],
  sortableAttributes: ["price", "createdTs", "nameSort", "inStock", "menuRank"],
  rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness", "inStock:desc"],
  synonyms: synonymMap(),
  // Опечатки допускаются в названиях, но не в артикулах (артикул ищем точно).
  typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 }, disableOnAttributes: ["sku", "articleCode"] },
  faceting: { maxValuesPerFacet: 300, sortFacetValuesBy: { "*": "count" } },
  pagination: { maxTotalHits: 5000 },
});

export async function ensureIndex() {
  const uid = indexUid();
  const found = await meili("GET", `/indexes/${uid}`);
  if (found.status === 404) await task("POST", "/indexes", { uid, primaryKey: "id" });
  await task("PATCH", `/indexes/${uid}/settings`, SETTINGS());
}

/** Полная пересборка индекса из базы. Вызывается после импорта и командой pnpm search:reindex. */
export async function reindexAll(): Promise<{ indexed: number }> {
  await ensureIndex();
  const { docs } = await buildDocs();
  const uid = indexUid();
  await task("DELETE", `/indexes/${uid}/documents`);
  for (let i = 0; i < docs.length; i += 1000) await task("POST", `/indexes/${uid}/documents`, docs.slice(i, i + 1000));
  await clearSearchStale();
  return { indexed: docs.length };
}

/** Обновить в индексе конкретные товары (после ручной правки). Скрытые и удалённые убираются. */
export async function reindexProducts(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const uid = indexUid();
  const { docs, hiddenIds } = await buildDocs({ id: { in: ids } });
  const present = new Set(docs.map((d) => d.id));
  const remove = [...new Set([...hiddenIds, ...ids.filter((id) => !present.has(id))])];
  if (docs.length) await task("POST", `/indexes/${uid}/documents`, docs);
  if (remove.length) await task("POST", `/indexes/${uid}/documents/delete-batch`, remove);
}

/** После правки меню: пересчитать у товаров в индексе только «место в меню» (быстро, без полной пересборки). */
export async function updateMenuRanks(): Promise<{ updated: number }> {
  const cats = await loadCatMap();
  const ranks = await loadRanks(cats);
  const rows = await prisma.product.findMany({ where: { visible: true, categoryId: { not: UNSORTED_ID } }, select: { id: true, categoryId: true } });
  const uid = indexUid();
  const docs = rows.map((r) => ({ id: r.id, menuRank: ranks.get(r.categoryId) ?? NO_RANK }));
  // PUT — частичное обновление: остальные поля документа не трогаются
  for (let i = 0; i < docs.length; i += 1000) await task("PUT", `/indexes/${uid}/documents`, docs.slice(i, i + 1000));
  return { updated: docs.length };
}

/** Безопасный вариант для мест, где сбой поиска не должен ломать основное действие. */
export async function reindexSafely(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error("[search] не удалось обновить индекс:", e instanceof Error ? e.message : e);
    await markSearchStale().catch(() => {});
  }
}

const STALE_KEY = "search.stale";
export const markSearchStale = () => prisma.setting.upsert({ where: { key: STALE_KEY }, update: { value: true }, create: { key: STALE_KEY, value: true } });
export const clearSearchStale = () => prisma.setting.deleteMany({ where: { key: STALE_KEY } });
export async function isSearchStale(): Promise<boolean> {
  return (await prisma.setting.findUnique({ where: { key: STALE_KEY } })) != null;
}

export async function searchStats(): Promise<{ ok: boolean; documents: number | null }> {
  try {
    const { status, data } = await meili<{ numberOfDocuments?: number }>("GET", `/indexes/${indexUid()}/stats`);
    return { ok: status === 200, documents: status === 200 ? (data.numberOfDocuments ?? 0) : null };
  } catch {
    return { ok: false, documents: null };
  }
}

// ---------- поиск ----------

/** menu — «как в меню» (порядок категорий подгруппы); по умолчанию в разделах, подразделах и задачах */
export type SearchSort = "relevance" | "price_asc" | "price_desc" | "new" | "name" | "menu";

export type SearchParams = {
  q?: string;
  cat?: string;
  /** Точный список категорий (раздел или задача витрины): товары, лежащие прямо в этих категориях. Пустой список — ничего. */
  categories?: string[];
  /** часть подраздела: одна категория (с вложенными) — чипы «Викрутки · Біти · …» */
  part?: string;
  brand?: string[];
  min?: number;
  max?: number;
  available?: boolean;
  /** только наш склад в Одессе */
  local?: boolean;
  sale?: boolean;
  /** только отмеченные «Хіт» / «Новинка» */
  hit?: boolean;
  isNew?: boolean;
  /** код фильтра → выбранные значения (см. FACET_DEFS) */
  facets?: Record<string, string[]>;
  sort?: SearchSort;
  page?: number;
  perPage?: number;
};

export type SearchItem = {
  id: string;
  sku: string;
  nameUk: string;
  nameRu: string;
  brand: string | null;
  price: number;
  oldPrice: number | null;
  discountPct: number;
  available: boolean;
  stock: StockLevel;
  hit?: boolean;
  isNew?: boolean;
  image: string | null;
  categoryId: string;
};

export type FacetValue = { value: string; count: number; selected: boolean };
export type SearchResult = {
  total: number;
  page: number;
  perPage: number;
  pages: number;
  items: SearchItem[];
  /** Запрос был исправлен по раскладке клавиатуры («rheu» → «круг»). */
  correctedQuery: string | null;
  /** сколько товаров есть на нашем складе в Одессе */
  localCount: number;
  /** категория (и все её родители) → сколько товаров, без учёта выбранной части подраздела (счётчики чипов «Викрутки · Біти») */
  categoryCounts: Record<string, number>;
  facets: {
    brand: FacetValue[];
    categories: { id: string; name: string; count: number }[];
    price: { min: number; max: number } | null;
    attrs: { key: string; label: string; values: FacetValue[] }[];
  };
  processingMs: number;
};

const esc = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const inList = (field: string, values: string[]) => `${field} IN [${values.map(esc).join(", ")}]`;

function sortRules(sort: SearchSort | undefined, hasQuery: boolean): string[] | undefined {
  switch (sort) {
    case "price_asc": return ["inStock:desc", "price:asc"];
    case "price_desc": return ["inStock:desc", "price:desc"];
    case "new": return ["inStock:desc", "createdTs:desc"];
    case "name": return ["inStock:desc", "nameSort:asc"];
    case "menu": return ["menuRank:asc", "inStock:desc", "nameSort:asc"];
    default: return hasQuery ? undefined : ["inStock:desc", "nameSort:asc"];
  }
}

type Distribution = Record<string, Record<string, number>>;
type MeiliHit = SearchItem & { id: string };
type MeiliResponse = {
  hits: MeiliHit[];
  estimatedTotalHits?: number;
  totalHits?: number;
  facetDistribution?: Distribution;
  facetStats?: Record<string, { min: number; max: number }>;
  processingTimeMs: number;
};

/** Поле, по которому дополнительный запрос считает счётчики «без своей группы». */
const extraField = (g: string) => (g === "brand" ? "brand" : g === "part" ? "categoryIds" : facetField(g.slice(2)));

const RETRIEVE = ["id", "sku", "nameUk", "nameRu", "brand", "price", "oldPrice", "discountPct", "available", "stock", "hit", "isNew", "image", "categoryId"];

export async function searchProducts(params: SearchParams): Promise<SearchResult> {
  const perPage = Math.min(60, Math.max(1, params.perPage ?? 24));
  const page = Math.max(1, params.page ?? 1);
  const uid = indexUid();
  const q0 = params.q?.trim() ?? "";
  const selectedFacets = Object.fromEntries(Object.entries(params.facets ?? {}).filter(([k, v]) => v.length && FACET_DEFS.some((d) => d.key === k)));
  const brands = params.brand?.filter(Boolean) ?? [];

  // Фильтры по группам: у выбранной группы свои счётчики считаем без неё (чтобы показать другие значения).
  const groups: Record<string, string> = {};
  if (params.cat) groups.cat = `categoryIds = ${esc(params.cat)}`;
  if (params.categories) {
    if (params.categories.length === 0) {
      return { total: 0, page, perPage, pages: 1, items: [], correctedQuery: null, localCount: 0, categoryCounts: {}, facets: { brand: [], categories: [], price: null, attrs: [] }, processingMs: 0 };
    }
    groups.cats = inList("categoryId", params.categories.slice(0, 500));
  }
  if (params.part) groups.part = `categoryIds = ${esc(params.part)}`;
  if (brands.length) groups.brand = inList("brand", brands);
  if (params.min != null && Number.isFinite(params.min)) groups.min = `price >= ${params.min}`;
  if (params.max != null && Number.isFinite(params.max)) groups.max = `price <= ${params.max}`;
  if (params.available) groups.available = "available = true";
  if (params.local) groups.local = "local = true";
  if (params.sale) groups.sale = "hasDiscount = true";
  if (params.hit) groups.hit = "hit = true";
  if (params.isNew) groups.isNew = "isNew = true";
  for (const [k, v] of Object.entries(selectedFacets)) groups[`f:${k}`] = inList(facetField(k), v);
  const filterWithout = (skip?: string) => Object.entries(groups).filter(([g]) => g !== skip).map(([, f]) => f);

  const facetFields = ["brand", "categoryIds", "price", "local", ...FACET_FIELDS];
  const run = async (q: string) => {
    const queries: Record<string, unknown>[] = [
      {
        indexUid: uid, q, filter: filterWithout(), limit: perPage, offset: (page - 1) * perPage,
        sort: sortRules(params.sort, q.length > 0), facets: facetFields, attributesToRetrieve: RETRIEVE,
      },
    ];
    const extra: string[] = [];
    if (groups.brand) extra.push("brand");
    if (groups.part) extra.push("part");
    for (const k of Object.keys(selectedFacets)) extra.push(`f:${k}`);
    for (const g of extra) queries.push({ indexUid: uid, q, filter: filterWithout(g), limit: 0, facets: [extraField(g)] });
    const { status, data } = await meili<{ results: MeiliResponse[]; message?: string }>("POST", "/multi-search", { queries });
    if (status >= 400) {
      if (status === 404) throw new SearchUnavailableError("Поисковый индекс ещё не создан. Соберите его в админке.");
      throw new Error(`Поиск: ${data?.message ?? status}`);
    }
    return { main: data.results[0], extra: data.results.slice(1), extraGroups: extra };
  };

  let correctedQuery: string | null = null;
  let res = await run(q0);
  if (q0 && (res.main.estimatedTotalHits ?? res.main.totalHits ?? res.main.hits.length) === 0) {
    for (const variant of fixKeyboardLayout(q0)) {
      const alt = await run(variant);
      if ((alt.main.estimatedTotalHits ?? alt.main.totalHits ?? alt.main.hits.length) > 0) {
        res = alt;
        correctedQuery = variant;
        break;
      }
    }
  }

  const total = res.main.estimatedTotalHits ?? res.main.totalHits ?? res.main.hits.length;
  const dist: Distribution = { ...(res.main.facetDistribution ?? {}) };
  res.extraGroups.forEach((g, i) => {
    const field = extraField(g);
    if (res.extra[i]?.facetDistribution?.[field]) dist[field] = res.extra[i].facetDistribution![field];
  });

  const toValues = (field: string, selected: string[], limit: number): FacetValue[] => {
    const entries = Object.entries(dist[field] ?? {}).map(([value, count]) => ({ value, count, selected: selected.includes(value) }));
    for (const s of selected) if (!entries.some((e) => e.value === s)) entries.push({ value: s, count: 0, selected: true });
    entries.sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count || a.value.localeCompare(b.value, "uk", { numeric: true }));
    return entries.slice(0, limit);
  };

  const attrs = FACET_DEFS.map((d) => {
    const field = facetField(d.key);
    const values = sortFacetValues(d.key, toValues(field, selectedFacets[d.key] ?? [], 80));
    const coverage = Object.values(dist[field] ?? {}).reduce((s, n) => s + n, 0);
    return { key: d.key, label: d.label, values, coverage, distinct: Object.keys(dist[field] ?? {}).length };
  })
    .filter((a) => (a.distinct >= 2 && a.coverage >= 3) || a.values.some((v) => v.selected))
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, 10)
    .map(({ key: k, label, values }) => ({ key: k, label, values }));

  // Подкатегории текущего раздела (или корневые) со счётчиками
  const cats = await loadCatMap();
  const childrenOf = [...cats.values()].filter((c) => (params.cat ? c.parentId === params.cat : c.parentId == null));
  const categories = childrenOf
    .map((c) => ({ id: c.id, name: c.nameUk, count: dist.categoryIds?.[c.id] ?? 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const stats = res.main.facetStats?.price;
  return {
    total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)),
    items: res.main.hits.map(({ id, sku, nameUk, nameRu, brand, price, oldPrice, discountPct, available, stock, hit, isNew, image, categoryId }) => ({
      id, sku, nameUk, nameRu, brand, price, oldPrice, discountPct, available, hit: hit === true, isNew: isNew === true,
      // индекс без поля stock (собран до шага 2.6) — считаем по «available»
      stock: stock ?? (available ? "supplier" : "order"), image, categoryId,
    })),
    /** сколько товаров выдачи есть на нашем складе (показывать ли фильтр «Швидка відправка з Одеси») */
    localCount: res.main.facetDistribution?.local?.["true"] ?? 0,
    categoryCounts: dist.categoryIds ?? {},
    correctedQuery,
    facets: { brand: toValues("brand", brands, 30), categories, price: stats ? { min: Math.floor(stats.min), max: Math.ceil(stats.max) } : null, attrs },
    processingMs: res.main.processingTimeMs,
  };
}

export type Suggestion = { id: string; sku: string; nameUk: string; nameRu: string; price: number; image: string | null; available: boolean; stock?: StockLevel };

/** Подсказки для строки поиска в шапке: название, фото, цена. */
export async function suggestProducts(q: string, limit = 6): Promise<{ items: Suggestion[]; correctedQuery: string | null }> {
  const query = q.trim();
  if (query.length < 2) return { items: [], correctedQuery: null };
  const uid = indexUid();
  const ask = async (text: string) => {
    const { status, data } = await meili<{ hits: Suggestion[]; message?: string }>("POST", `/indexes/${uid}/search`, {
      q: text, limit, attributesToRetrieve: ["id", "sku", "nameUk", "nameRu", "price", "image", "available", "stock"],
    });
    if (status === 404) throw new SearchUnavailableError("Поисковый индекс ещё не создан.");
    if (status >= 400) throw new Error(`Поиск: ${data?.message ?? status}`);
    return data.hits;
  };
  let items = await ask(query);
  let correctedQuery: string | null = null;
  if (!items.length) {
    for (const variant of fixKeyboardLayout(query)) {
      const alt = await ask(variant);
      if (alt.length) {
        items = alt;
        correctedQuery = variant;
        break;
      }
    }
  }
  return { items, correctedQuery };
}
