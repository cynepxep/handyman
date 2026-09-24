// Данные для «Мастерской v2». Только чтение реального каталога: ничего не пишем ни в базу, ни в поиск.
import "server-only";
import { prisma } from "@handyman/db";
import { searchProducts, SearchUnavailableError, type SearchResult } from "@handyman/db/catalog-search";
import {
  HIDDEN_CATEGORY_IDS, MENU_GROUPS, TASKS, assignCategories, extractFacets, pickQuickPick, pickSpecs, taskCategoryIds,
  type MenuGroup, type Spec, type Task,
} from "@handyman/core/catalog";

export type V2Card = {
  id: string;
  name: string;
  price: number;
  oldPrice: number | null;
  discountPct: number;
  available: boolean;
  image: string | null;
  specs: Spec[];
};

export type GroupView = { group: MenuGroup; total: number; image: string | null; subs: { id: string; nameUk: string; total: number }[] };
export type TaskView = { task: Task; total: number };

export type Demo = { key: string; label: string; catId: string; groupId: string; subId: string | null };

/** Примеры страниц категорий для показа разных «быстрых выборов». */
export const DEMOS: Demo[] = [
  { key: "cut", label: "Відрізні диски", catId: "acc-dysky-vidrizni-po-metalu", groupId: "discs", subId: "discs-cut" },
  { key: "drill", label: "Свердла по металу", catId: "acc-sverdla-po-metalu", groupId: "drills", subId: "drills-metal" },
  { key: "bits", label: "Біти та тримачі", catId: "hand-slyusarno-stolyarnyy-instrument-bity-ta-trymachi", groupId: "hand", subId: "hand-screw" },
  { key: "cordless", label: "Акумуляторний інструмент", catId: "ak", groupId: "cordless", subId: null },
];

export type V2Data = {
  groups: GroupView[];
  tasks: TaskView[];
  batteries: { value: string; count: number }[];
  sale: V2Card[];
  problems: string[];
  category: null | {
    demo: Demo;
    group: MenuGroup;
    total: number;
    cards: V2Card[];
    quickKey: string | null;
    quickLabel: string;
    quickValues: { value: string; count: number }[];
    pick: string | null;
    attrs: SearchResult["facets"]["attrs"];
    brand: SearchResult["facets"]["brand"];
    price: SearchResult["facets"]["price"];
    subsInGroup: { id: string; nameUk: string; total: number }[];
  };
  searchDown: boolean;
};

/** Размеры по возрастанию («6», «8», «10»), а не по алфавиту; нечисловые значения — по числу товаров. */
function sortQuick(values: { value: string; count: number }[]) {
  const num = (s: string) => Number.parseFloat(s.replace(",", "."));
  return values.every((v) => Number.isFinite(num(v.value)))
    ? [...values].sort((a, b) => num(a.value) - num(b.value) || a.value.localeCompare(b.value))
    : [...values].sort((a, b) => b.count - a.count);
}

const discountPct = (price: number, old: number | null) => (old && old > price ? Math.round((1 - price / old) * 100) : 0);

/** Цепочка названий категорий товара сверху вниз (из неё берётся «Серія» батареи). */
type ChainOf = (categoryId: string) => string[];

/** Характеристики для списка товаров: два запроса на весь список, а не по одному на товар. */
async function specsFor(ids: string[], chainOf: ChainOf, order?: string[]): Promise<Map<string, Spec[]>> {
  const [rows, prods] = ids.length
    ? await Promise.all([
        prisma.productAttribute.findMany({ where: { productId: { in: ids } }, select: { productId: true, key: true, value: true }, orderBy: { sort: "asc" } }),
        prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, categoryId: true } }),
      ])
    : [[], []];
  const byProduct = new Map<string, { name: string; value: string }[]>();
  for (const r of rows) (byProduct.get(r.productId) ?? byProduct.set(r.productId, []).get(r.productId)!).push({ name: r.key, value: r.value });
  const catOf = new Map(prods.map((p) => [p.id, p.categoryId]));
  return new Map(ids.map((id) => [id, pickSpecs(extractFacets(byProduct.get(id) ?? [], chainOf(catOf.get(id) ?? "")), order)]));
}

async function saleCards(chainOf: ChainOf): Promise<V2Card[]> {
  const rows = await prisma.product.findMany({
    where: { visible: true, oldPrice: { not: null }, supplierAvailable: true, categoryId: { notIn: HIDDEN_CATEGORY_IDS }, images: { some: {} } },
    select: { id: true, nameUk: true, price: true, oldPrice: true, supplierAvailable: true, images: { take: 1, orderBy: { sort: "asc" }, select: { url: true } } },
  });
  const cards = rows
    .map((r) => {
      const price = r.price.toNumber();
      const old = r.oldPrice ? r.oldPrice.toNumber() : null;
      return { r, price, old, pct: discountPct(price, old) };
    })
    .filter((x) => x.pct >= 10 && x.price >= 100)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8);
  const specs = await specsFor(cards.map((x) => x.r.id), chainOf);
  return cards.map((x) => ({
    id: x.r.id,
    name: x.r.nameUk,
    price: x.price,
    oldPrice: x.old,
    discountPct: x.pct,
    available: x.r.supplierAvailable,
    image: x.r.images[0]?.url ?? null,
    specs: specs.get(x.r.id) ?? [],
  }));
}

export async function loadV2(opts: { screen: string; demoKey?: string; pick?: string }): Promise<V2Data> {
  const [cats, counts] = await Promise.all([
    prisma.category.findMany({ select: { id: true, nameUk: true, parentId: true } }),
    prisma.product.groupBy({ by: ["categoryId"], where: { visible: true }, _count: { _all: true } }),
  ]);
  const direct = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const { subOf, conflicts, missing } = assignCategories(cats);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const chainOf: ChainOf = (id) => {
    const out: string[] = [];
    for (let cur = catById.get(id), i = 0; cur && i < 6; cur = cur.parentId ? catById.get(cur.parentId) : undefined, i++) out.unshift(cur.nameUk);
    return out;
  };

  // Проверка меню: каждый видимый товар (кроме служебных категорий) попадает ровно в одну подгруппу.
  const problems: string[] = [];
  if (conflicts.length) problems.push(`Конфликты меню: ${conflicts.join("; ")}`);
  if (missing.length) problems.push(`В меню есть коды, которых нет в базе: ${missing.join(", ")}`);
  const lost = cats.filter((c) => !HIDDEN_CATEGORY_IDS.includes(c.id) && (direct.get(c.id) ?? 0) > 0 && !subOf.has(c.id));
  if (lost.length) problems.push(`Товары не попали в меню: ${lost.map((c) => `${c.nameUk} (${direct.get(c.id)})`).join(", ")}`);

  const subTotal = new Map<string, number>();
  const catsOfSub = new Map<string, string[]>();
  for (const [catId, subId] of subOf) {
    subTotal.set(subId, (subTotal.get(subId) ?? 0) + (direct.get(catId) ?? 0));
    (catsOfSub.get(subId) ?? catsOfSub.set(subId, []).get(subId)!).push(catId);
  }

  // Фото группы: самый «богатый» товар в наличии из её категорий.
  const groups: GroupView[] = await Promise.all(
    MENU_GROUPS.map(async (group) => {
      const catIds = group.subs.flatMap((s) => catsOfSub.get(s.id) ?? []);
      const p = catIds.length
        ? await prisma.product.findFirst({
            where: { visible: true, supplierAvailable: true, categoryId: { in: catIds }, images: { some: {} } },
            orderBy: { price: "desc" },
            select: { images: { take: 1, orderBy: { sort: "asc" }, select: { url: true } } },
          })
        : null;
      const subs = group.subs.map((s) => ({ id: s.id, nameUk: s.nameUk, total: subTotal.get(s.id) ?? 0 }));
      return { group, total: subs.reduce((a, s) => a + s.total, 0), image: p?.images[0]?.url ?? null, subs };
    }),
  );

  const tasks: TaskView[] = TASKS.map((task) => ({
    task,
    total: taskCategoryIds(cats, task).reduce((a, id) => a + (direct.get(id) ?? 0), 0),
  }));

  let searchDown = false;
  let batteries: { value: string; count: number }[] = [];
  try {
    const ak = await searchProducts({ cat: "ak", perPage: 1 });
    batteries = (ak.facets.attrs.find((a) => a.key === "series")?.values ?? []).map((v) => ({ value: v.value, count: v.count }));
  } catch (e) {
    if (!(e instanceof SearchUnavailableError)) throw e;
    searchDown = true;
  }

  const data: V2Data = { groups, tasks, batteries, sale: [], problems, category: null, searchDown };
  if (opts.screen === "home") data.sale = await saleCards(chainOf);

  if (opts.screen === "category") {
    const demo = DEMOS.find((d) => d.key === opts.demoKey) ?? DEMOS[0];
    const group = MENU_GROUPS.find((g) => g.id === demo.groupId)!;
    try {
      const base = await searchProducts({ cat: demo.catId, perPage: 1 });
      const quick = pickQuickPick(group.quickPick, base.facets.attrs);
      const pick = quick && opts.pick && quick.values.some((v) => v.value === opts.pick) ? opts.pick : null;
      const res = pick && quick ? await searchProducts({ cat: demo.catId, perPage: 12, facets: { [quick.key]: [pick] } }) : await searchProducts({ cat: demo.catId, perPage: 12 });
      const specs = await specsFor(res.items.map((i) => i.id), chainOf, group.specs);
      data.category = {
        demo,
        group,
        total: res.total,
        cards: res.items.map((i) => ({
          id: i.id,
          name: i.nameUk,
          price: i.price,
          oldPrice: i.oldPrice,
          discountPct: i.discountPct,
          available: i.available,
          image: i.image,
          specs: specs.get(i.id) ?? [],
        })),
        quickKey: quick?.key ?? null,
        quickLabel: quick?.label ?? "",
        quickValues: sortQuick(quick?.values.map((v) => ({ value: v.value, count: v.count })) ?? []),
        pick,
        attrs: res.facets.attrs,
        brand: res.facets.brand,
        price: res.facets.price,
        subsInGroup: groups.find((g) => g.group.id === group.id)?.subs ?? [],
      };
    } catch (e) {
      if (!(e instanceof SearchUnavailableError)) throw e;
      data.searchDown = true;
    }
  }
  return data;
}
