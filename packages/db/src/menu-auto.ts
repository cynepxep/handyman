// Автораскладка разделов по меню витрины (просьба владельца 2026-10-06): после загрузки каталога категории, которых нет в меню,
// сайт сам кладёт в подходящие подгруппы (или создаёт новые) — по подсказкам suggestMenuPlacement (core/src/catalog/menu-suggest.ts).
// Запускается из runJobs (jobs.ts) один раз на каждую завершённую загрузку. Что не удалось подобрать — остаётся владельцу
// в «Сайт → Меню и задачи» (блок «Не видны в меню»). Всё разложенное можно потом поправить там же.

import { applyMenuPlacement, lostCategories, suggestMenuPlacement } from "@handyman/core/catalog";
import { prisma } from "./client";
import { loadMenuConfig, saveMenuConfig } from "./site-content";
import { reindexSafely, updateMenuRanks } from "./catalog-search";

export type AutoPlaceResult = {
  /** сколько категорий положено в меню */
  placed: number;
  /** сколько товаров в них (стали видны в «Каталоге») */
  products: number;
  /** названия созданных подгрупп («Акумуляторний інструмент › Гайковерти») */
  created: string[];
  /** сколько категорий с товарами осталось вне меню (подобрать не удалось) */
  left: number;
};

export async function autoPlaceMenu(who = "сайт (автораскладка)"): Promise<AutoPlaceResult> {
  const [rows, counts, cfg] = await Promise.all([
    prisma.category.findMany({ select: { id: true, parentId: true, nameUk: true, nameRu: true } }),
    prisma.product.groupBy({ by: ["categoryId"], where: { visible: true }, _count: { _all: true } }),
    loadMenuConfig(),
  ]);
  const direct = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const lost = lostCategories(rows, direct, cfg);
  if (!lost.length) return { placed: 0, products: 0, created: [], left: 0 };
  const suggestions = suggestMenuPlacement(rows, cfg, lost.map((l) => l.id));
  const choices = lost.flatMap((l) => {
    const s = suggestions.get(l.id);
    return s ? [{ catId: l.id, target: s.kind === "new" ? `new:${s.key}` : s.subId }] : [];
  });
  if (!choices.length) return { placed: 0, products: 0, created: [], left: lost.length };
  const before = new Set(cfg.groups.flatMap((g) => g.subs.map((s) => s.id)));
  const r = applyMenuPlacement(cfg, choices, suggestions);
  if (!r.placed) return { placed: 0, products: 0, created: [], left: lost.length };
  await saveMenuConfig(r.cfg, who, "site.menu.auto");
  await reindexSafely(updateMenuRanks); // порядок товаров «как в меню»
  const created = r.cfg.groups.flatMap((g) => g.subs.filter((s) => !before.has(s.id)).map((s) => `${g.nameUk} › ${s.nameUk}`));
  const placedIds = new Set(choices.map((c) => c.catId));
  const products = lost.filter((l) => placedIds.has(l.id)).reduce((a, l) => a + l.count, 0);
  return { placed: r.placed, products, created, left: lostCategories(rows, direct, r.cfg).length };
}
