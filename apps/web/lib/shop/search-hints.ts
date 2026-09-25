// Подсказки поиска («круг 125», «болгарка»…) для главной и строки поиска: ваши из «Сайт → Тексты» (home.hints) первыми,
// дальше — частые запросы покупателей за 30 дней и подразделы, из которых чаще заказывают. Сколько показывать и что скрыть — «Сайт → Главная».
import "server-only";
import { cache } from "react";
import { assignCategories, slugOf } from "@handyman/core/catalog";
import { mergeHints, paths, shopHref, type SearchHint } from "@handyman/core/site";
import { loadHomeSettings } from "@handyman/db/site-content";
import { orderedByCategory, topQueries } from "@handyman/db/search-stats";
import { getCategoryStats } from "./catalog";
import type { ShopContent } from "./content";
import { TAG_CATALOG, TAG_SHOP, cached } from "./cache";

/** Данные подсказок (настройки, частые запросы, заказы по категориям) — кэш на 10 минут, сброс при правке в админке. */
const loadHintData = cached(
  async () => {
    const [home, popular, ordered] = await Promise.all([loadHomeSettings(), topQueries({ found: true, limit: 20 }), orderedByCategory(30)]);
    return { hidden: home.hints.hidden, max: home.hints.max, popular: popular.map((q) => q.query), ordered: [...ordered.entries()] };
  },
  "search-hints", [TAG_SHOP, TAG_CATALOG], 600,
);

export const getSearchHints = cache(async (c: ShopContent): Promise<SearchHint[]> => {
  const pinned = c.t("home.hints").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const [{ hidden, max, popular, ordered }, { cats }] = await Promise.all([loadHintData(), getCategoryStats()]);
    // подразделы меню, из которых больше всего заказывали
    const { subOf } = assignCategories(cats, c.menu.groups);
    const bySub = new Map<string, number>();
    for (const [catId, qty] of ordered) {
      const subId = subOf.get(catId);
      if (subId) bySub.set(subId, (bySub.get(subId) ?? 0) + qty);
    }
    const fromOrders: SearchHint[] = [...bySub.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .flatMap(([subId]) => {
        const group = c.menu.groups.find((g) => !g.hidden && g.subs.some((s) => s.id === subId && !s.hidden));
        const sub = group?.subs.find((s) => s.id === subId);
        return group && sub ? [{ text: c.pick(sub.nameUk, sub.nameRu), href: shopHref(c.lang, paths.sub(slugOf(group), slugOf(sub))) }] : [];
      });
    return mergeHints({ pinned, popular, fromOrders, hidden, max });
  } catch (e) {
    console.error("[shop] подсказки поиска: беру только заданные вручную", e);
    return pinned.slice(0, 8).map((text) => ({ text }));
  }
});
