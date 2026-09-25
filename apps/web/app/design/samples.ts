// Реальные «трудные» товары для стенда дизайн-системы: длинное название, самая большая цена, скидка, «Під замовлення», без фото.
import "server-only";
import { prisma } from "@handyman/db";
import type { SearchItem } from "@handyman/db/catalog-search";
import { HIDDEN_CATEGORY_IDS } from "@handyman/core/catalog";
import { stockLevel } from "@handyman/core/shop";
import { toCards, type ShopCard } from "@/lib/shop/catalog";

export async function loadSampleCards(): Promise<Array<{ label: string; card: ShopCard }>> {
  const rows = await prisma.product.findMany({
    where: { visible: true, categoryId: { notIn: HIDDEN_CATEGORY_IDS } },
    select: {
      id: true, sku: true, nameUk: true, nameRu: true, price: true, oldPrice: true, supplierAvailable: true, categoryId: true, stockItems: { select: { onHand: true } },
      images: { take: 1, orderBy: { sort: "asc" }, select: { url: true } },
    },
  });
  const items: SearchItem[] = rows.map((r) => {
    const price = r.price.toNumber();
    const old = r.oldPrice ? r.oldPrice.toNumber() : null;
    return {
      id: r.id, sku: r.sku, nameUk: r.nameUk, nameRu: r.nameRu, brand: null, price,
      oldPrice: old && old > price ? old : null, discountPct: old && old > price ? Math.round((1 - price / old) * 100) : 0,
      available: r.supplierAvailable, stock: stockLevel(r.stockItems.reduce((a, x) => a + x.onHand, 0), r.supplierAvailable), image: r.images[0]?.url ?? null, categoryId: r.categoryId,
    };
  });
  const withImg = items.filter((i) => i.image);
  const pick = (label: string, list: SearchItem[], cmp: (a: SearchItem, b: SearchItem) => number) => {
    const found = [...list].sort(cmp)[0];
    return found ? { label, item: found } : null;
  };
  const chosen = [
    pick("Самое длинное название", withImg, (a, b) => b.nameUk.length - a.nameUk.length),
    pick("Самая большая цена", withImg, (a, b) => b.price - a.price),
    pick("Большая скидка", withImg.filter((i) => i.oldPrice), (a, b) => b.discountPct - a.discountPct),
    pick("Под заказ", withImg.filter((i) => !i.available), (a, b) => a.price - b.price),
    pick("Короткое название, дешёвый", withImg.filter((i) => i.price > 0), (a, b) => a.nameUk.length - b.nameUk.length || a.price - b.price),
    pick("Без фото", items.filter((i) => !i.image), (a, b) => a.nameUk.length - b.nameUk.length),
  ].filter((x): x is { label: string; item: SearchItem } => x !== null);
  const cards = await toCards(chosen.map((c) => c.item), "uk");
  return chosen.map((c, i) => ({ label: c.label, card: cards[i] }));
}
