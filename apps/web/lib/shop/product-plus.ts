// Страница товара, «Витрина+» (шаг 5.6): цены от количества (опт, упаковка), совместимость («Підходить до» / «Витратні матеріали»),
// отзывы и вопросы, подписки «повідомити» вошедшего покупателя. Цены и наличие не кэшируются.
import "server-only";
import { searchProducts, SearchUnavailableError } from "@handyman/db/catalog-search";
import { loadQtyRules } from "@handyman/db/orders";
import { compatOfProduct, publishedReviews, watchesFor } from "@handyman/db/storefront-plus";
import { botUsername } from "@handyman/db/client-auth";
import { qtyPrices, type TierKey } from "@handyman/core/shop";
import type { ShopLang } from "@handyman/core/site";
import { toCards, type ShopCard } from "./catalog";

export type CompatBlock = { title: "fits" | "accessories"; groups: Array<{ key: string; label: string }>; cards: ShopCard[]; total: number; allKey: string | null };

async function compatCards(field: "fits" | "tools", keys: string[], selfId: string, lang: ShopLang, limit = 12): Promise<{ cards: ShopCard[]; total: number }> {
  if (!keys.length) return { cards: [], total: 0 };
  try {
    const res = await searchProducts({ [field]: keys, perPage: limit + 1 });
    const items = res.items.filter((i) => i.id !== selfId).slice(0, limit);
    return { cards: await toCards(items, lang), total: Math.max(0, res.total - (res.items.some((i) => i.id === selfId) ? 1 : 0)) };
  } catch (e) {
    if (e instanceof SearchUnavailableError) return { cards: [], total: 0 };
    throw e;
  }
}

/**
 * Блоки совместимости: расходник → «Підходить до» (инструменты тех же групп); инструмент → «Витратні матеріали та аксесуари».
 * «Усі» ведёт на список группы (/search?tool=… или ?fit=…), если группа одна.
 */
export async function compatBlocks(productId: string, lang: ShopLang): Promise<CompatBlock[]> {
  const rows = await compatOfProduct(productId);
  if (!rows.length) return [];
  const label = (r: (typeof rows)[number]) => (lang === "ru" && r.labelRu ? r.labelRu : r.label);
  const asAcc = rows.filter((r) => r.role === "ACCESSORY");
  const asHost = rows.filter((r) => r.role === "HOST");
  const out: CompatBlock[] = [];
  if (asHost.length) {
    const keys = asHost.map((r) => r.key);
    const { cards, total } = await compatCards("fits", keys, productId, lang);
    if (cards.length) out.push({ title: "accessories", groups: asHost.map((r) => ({ key: r.key, label: label(r) })), cards, total, allKey: keys.length === 1 ? keys[0] : null });
  }
  if (asAcc.length) {
    const keys = asAcc.map((r) => r.key);
    const { cards, total } = await compatCards("tools", keys, productId, lang);
    // группы показываем даже без инструментов на сайте: «Підходить до: Диск 125 мм» — уже полезно
    out.push({ title: "fits", groups: asAcc.map((r) => ({ key: r.key, label: label(r) })), cards, total, allKey: keys.length === 1 ? keys[0] : null });
  }
  return out;
}

/** Лестница цен от количества для этого покупателя (гость — общие цены; вошедший — плюс цены его уровня, например «Опт»). */
export async function productQtyPrices(productId: string, price: number, tier: TierKey | null) {
  const r = (await loadQtyRules([productId])).get(productId);
  return r ? qtyPrices(price, r.breaks, r.packs, tier) : [];
}

export async function productReviews(productId: string) {
  return publishedReviews(productId);
}

/** Подписки вошедшего покупателя на товар и можно ли слать в Telegram. Ссылка на бота — для тех, кто не вошёл через Telegram. */
export async function watchState(client: { id: string; tgId: bigint | null } | null, productId: string) {
  const [kinds, bot] = await Promise.all([watchesFor(client?.id, productId), botUsername().catch(() => null)]);
  return { kinds, direct: Boolean(client?.tgId), bot };
}
