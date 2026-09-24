// Данные для стенда направлений стиля: только чтение реального каталога, ничего не пишем.
import "server-only";
import { prisma } from "@handyman/db";
import { searchProducts, SearchUnavailableError, type SearchResult } from "@handyman/db/catalog-search";
import { UNSORTED_ID } from "@handyman/core/catalog";
import { loadCategories } from "@/lib/catalog";

export type Card = {
  id: string;
  name: string;
  brand: string | null;
  price: number;
  oldPrice: number | null;
  discountPct: number;
  available: boolean;
  image: string | null;
};

export type Tile = { id: string; name: string; total: number; image: string | null };

export type Edge = { label: string; card: Card };

export type DesignData = {
  tiles: Tile[];
  listing: SearchResult | null;
  listingCards: Card[];
  edges: Edge[];
  searchDown: boolean;
};

const discount = (price: number, old: number | null) => (old && old > price ? Math.round((1 - price / old) * 100) : 0);

/** Крайние случаи из реального каталога: самое длинное название, самая большая цена, нет фото и т. д. */
async function loadEdges(): Promise<Edge[]> {
  const rows = await prisma.product.findMany({
    where: { visible: true, categoryId: { not: UNSORTED_ID } },
    select: {
      id: true,
      nameUk: true,
      price: true,
      oldPrice: true,
      supplierAvailable: true,
      brand: { select: { name: true } },
      images: { take: 1, orderBy: { sort: "asc" }, select: { url: true } },
    },
  });
  const cards: Card[] = rows.map((r) => {
    const price = r.price.toNumber();
    const old = r.oldPrice ? r.oldPrice.toNumber() : null;
    return {
      id: r.id,
      name: r.nameUk,
      brand: r.brand?.name ?? null,
      price,
      oldPrice: old && old > price ? old : null,
      discountPct: discount(price, old),
      available: r.supplierAvailable,
      image: r.images[0]?.url ?? null,
    };
  });
  const withImage = cards.filter((c) => c.image);
  const pick = (label: string, list: Card[], cmp: (a: Card, b: Card) => number): Edge | null => {
    const c = [...list].sort(cmp)[0];
    return c ? { label, card: c } : null;
  };
  const edges = [
    pick("Самое длинное название", withImage, (a, b) => b.name.length - a.name.length),
    pick("Самая большая цена", withImage, (a, b) => b.price - a.price),
    pick("Самая дешёвая", withImage.filter((c) => c.price > 0), (a, b) => a.price - b.price),
    pick("Большая скидка", withImage.filter((c) => c.oldPrice), (a, b) => b.discountPct - a.discountPct),
    pick("Под заказ", withImage.filter((c) => !c.available), (a, b) => b.name.length - a.name.length),
    pick("Без фото", cards.filter((c) => !c.image), (a, b) => a.name.length - b.name.length),
  ];
  return edges.filter((e): e is Edge => e !== null);
}

export async function loadDesignData(): Promise<DesignData> {
  const cats = await loadCategories();
  const roots = cats.roots.filter((r) => r.id !== UNSORTED_ID);

  let searchDown = false;
  const tiles: Tile[] = await Promise.all(
    roots.map(async (r) => {
      try {
        const res = await searchProducts({ cat: r.id, perPage: 1, available: true });
        const all = await searchProducts({ cat: r.id, perPage: 1 });
        return { id: r.id, name: r.nameUk, total: all.total, image: res.items[0]?.image ?? all.items[0]?.image ?? null };
      } catch (e) {
        if (!(e instanceof SearchUnavailableError)) throw e;
        searchDown = true;
        return { id: r.id, name: r.nameUk, total: 0, image: null };
      }
    }),
  );

  let listing: SearchResult | null = null;
  try {
    listing = await searchProducts({ q: "круг", perPage: 12 });
  } catch (e) {
    if (!(e instanceof SearchUnavailableError)) throw e;
    searchDown = true;
  }
  const listingCards: Card[] = (listing?.items ?? []).map((i) => ({
    id: i.id,
    name: i.nameUk,
    brand: i.brand,
    price: i.price,
    oldPrice: i.oldPrice,
    discountPct: i.discountPct,
    available: i.available,
    image: i.image,
  }));

  return { tiles, listing, listingCards, edges: await loadEdges(), searchDown };
}
