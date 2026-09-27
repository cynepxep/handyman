// Списки товаров витрины: раздел, подраздел, задача, поиск. Какие категории входят — решает сервер по меню владельца
// (клиенту не доверяем), фильтры — из адреса страницы (parseListing).
import "server-only";
import { searchProducts, SearchUnavailableError, type SearchResult } from "@handyman/db/catalog-search";
import {
  FACET_DEFS, findGroup, findSub, findTask, pickQuickPick, slugOf, sortFacetValues, subCategoryMap, taskCategoryIds,
  type MenuConfig, type MenuGroup, type MenuSub, type Task,
} from "@handyman/core/catalog";
import { paths, type ListingState, type ShopLang } from "@handyman/core/site";
import { myToolGroups } from "@handyman/db/storefront-plus";
import { getClient } from "@/lib/client-auth";
import { getCategoryStats, toCards, type ShopCard } from "./catalog";

export const PER_PAGE = 24;
export const FACET_KEYS = FACET_DEFS.map((d) => d.key);

/** Что за список: передаётся и в браузер (для «Показати ще» и счётчика в шторке), поэтому только адреса, без категорий. */
export type ListingKey =
  | { kind: "group"; group: string }
  | { kind: "sub"; group: string; sub: string }
  | { kind: "task"; task: string }
  | { kind: "search"; q: string };

/** Для задач: какой «быстрый выбор» искать (у задачи нет своей группы). */
const TASK_QUICK_PICK = ["drillDiameter", "diameter", "slot", "shank", "power", "length"];

export type ResolvedListing = {
  key: ListingKey;
  categories?: string[];
  q?: string;
  quickPick: string[];
  specs?: string[];
  group?: MenuGroup;
  sub?: MenuSub;
  task?: Task;
  /** из каких категорий состоит подраздел/задача по порядку меню — чипы «Викрутки · Біти · …» */
  parts?: string[];
  /** открыли по прежнему адресу (адрес сменили в админке) — перенаправить сюда (адрес украинской версии, без ?запроса) */
  redirectTo?: string;
};

/** Найти раздел/подраздел/задачу по адресу и собрать точный список категорий. Нет такого или скрыт — null (страница 404). */
export async function resolveListing(key: ListingKey, menu: MenuConfig): Promise<ResolvedListing | null> {
  if (key.kind === "search") return { key, q: key.q.slice(0, 100), quickPick: [] };
  const { cats } = await getCategoryStats();
  if (key.kind === "task") {
    const found = findTask(menu, key.task);
    if (!found || found.item.hidden) return null;
    const task = found.item;
    return {
      key, task, categories: taskCategoryIds(cats, task), quickPick: TASK_QUICK_PICK, parts: partsOf(task, cats),
      ...(found.moved ? { redirectTo: paths.task(slugOf(task)) } : {}),
    };
  }
  const g = findGroup(menu, key.group);
  if (!g || g.item.hidden) return null;
  const group = g.item;
  const map = subCategoryMap(cats, menu.groups);
  if (key.kind === "sub") {
    const s = findSub(group, key.sub);
    if (!s || s.item.hidden) return null;
    const sub = s.item;
    return {
      key, group, sub, categories: map.get(sub.id) ?? [], quickPick: group.quickPick, specs: group.specs, parts: partsOf(sub, cats),
      ...(g.moved || s.moved ? { redirectTo: paths.sub(slugOf(group), slugOf(sub)) } : {}),
    };
  }
  return {
    key, group, categories: group.subs.flatMap((s) => map.get(s.id) ?? []), quickPick: group.quickPick, specs: group.specs,
    ...(g.moved ? { redirectTo: paths.group(slugOf(group)) } : {}),
  };
}

/** Части подраздела: его категории по порядку меню; если категория одна — её вложенные категории. */
function partsOf(item: { categoryIds: string[]; ownIds?: string[] }, cats: Array<{ id: string; parentId: string | null }>): string[] {
  const ids = [...new Set([...item.categoryIds, ...(item.ownIds ?? [])])];
  return ids.length === 1 ? cats.filter((c) => c.parentId === ids[0]).map((c) => c.id) : ids;
}

export type ListingPart = { id: string; name: string; count: number };

export type ListingData = {
  result: SearchResult;
  cards: ShopCard[];
  /** Быстрый выбор размера: фильтр и его значения по порядку (6, 8, 10…). */
  quick: { key: string; label: string; values: Array<{ value: string; count: number }> } | null;
  /** чипы частей подраздела (показываются, если частей с товарами хотя бы две) */
  parts: ListingPart[];
  /** шаг 5.6: инструмент вошедшего покупателя (из его заказов и «Мій інструмент» в кабинете) — есть, значит показываем фильтр «До мого інструменту» */
  mine: { tools: string[] } | null;
};

/** Инструмент вошедшего покупателя для фильтра «До мого інструменту» (нет входа или инструмента — null). */
async function myTools() {
  const client = await getClient();
  if (!client) return null;
  const my = await myToolGroups(client.id);
  return my.keys.length ? my : null;
}

async function listParts(r: ResolvedListing, counts: Record<string, number>, lang: ShopLang): Promise<ListingPart[]> {
  if (!r.parts?.length) return [];
  const { byId } = await getCategoryStats();
  const parts = r.parts
    .map((id) => ({ id, cat: byId.get(id), count: counts[id] ?? 0 }))
    .filter((p) => p.cat && p.count > 0)
    .map(({ id, cat, count }) => ({ id, name: lang === "ru" && cat!.nameRu ? cat!.nameRu : cat!.nameUk, count }));
  return parts.length >= 2 ? parts : [];
}

/** Страница списка. Поиск недоступен — null (страница покажет «спробуйте за хвилину»). */
export async function runListing(
  r: ResolvedListing, state: ListingState, lang: ShopLang, page = state.page, opts: { countOnly?: boolean } = {},
): Promise<ListingData | null> {
  try {
    const my = await myTools();
    // «До мого інструменту»: расходники к инструменту покупателя; нет инструмента — пусто (фильтр и не показывается)
    const fits = state.fit ? [state.fit] : state.mine ? (my?.keys ?? []) : undefined;
    const params = {
      q: r.q ?? "",
      ...(fits ? { fits } : {}),
      ...(state.tool ? { tools: [state.tool] } : {}),
      ...(r.categories ? { categories: r.categories } : {}),
      ...(state.part && r.parts?.includes(state.part) ? { part: state.part } : {}),
      facets: state.facets,
      available: state.available,
      local: state.local,
      sale: state.sale,
      hit: state.hit,
      isNew: state.isNew,
      min: state.min,
      max: state.max,
      // в разделах, подразделах и задачах по умолчанию — как в меню (сначала викрутки, потом біти…)
      sort: state.sort ?? (r.key.kind === "search" ? undefined : ("menu" as const)),
      page,
      perPage: opts.countOnly ? 1 : PER_PAGE,
    };
    const result = await searchProducts(params);
    const mine = my ? { tools: my.tools } : null;
    if (opts.countOnly) return { result, cards: [], quick: null, parts: [], mine };
    const cards = await toCards(result.items, lang);
    const q = pickQuickPick(r.quickPick, result.facets.attrs);
    const quick = q ? { key: q.key, label: q.label, values: sortFacetValues(q.key, q.values.map((v) => ({ value: v.value, count: v.count }))) } : null;
    return { result, cards, quick, parts: await listParts(r, result.categoryCounts, lang), mine };
  } catch (e) {
    if (e instanceof SearchUnavailableError) return null;
    throw e;
  }
}
