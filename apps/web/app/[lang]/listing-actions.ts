"use server";

// Действия списков товаров, которые вызывает браузер:
// «Показати ще» (следующая страница карточек) и «сколько найдётся» (число на кнопке шторки фильтров).
// Из браузера приходит только адрес раздела и строка фильтров; категории и цены сервер берёт сам.
import { isShopLang, parseListing } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { FACET_KEYS, resolveListing, runListing, type ListingKey } from "@/lib/shop/listing";
import type { ShopCard } from "@/lib/shop/catalog";

const clean = (s: unknown, max = 80) => (typeof s === "string" ? s.slice(0, max) : "");

function safeKey(raw: unknown): ListingKey | null {
  if (!raw || typeof raw !== "object") return null;
  const k = raw as Record<string, unknown>;
  switch (k.kind) {
    case "group": return { kind: "group", group: clean(k.group) };
    case "sub": return { kind: "sub", group: clean(k.group), sub: clean(k.sub) };
    case "task": return { kind: "task", task: clean(k.task) };
    case "search": return { kind: "search", q: clean(k.q, 100) };
    default: return null;
  }
}

async function prepare(lang: unknown, key: unknown, query: unknown) {
  if (!isShopLang(lang)) return null;
  const k = safeKey(key);
  if (!k) return null;
  const c = await getShopContent(lang);
  const r = await resolveListing(k, c.menu);
  if (!r) return null;
  const state = parseListing(new URLSearchParams(clean(query, 2000)), FACET_KEYS);
  return { lang, r, state };
}

/** «Показати ще»: карточки страницы `page` (с характеристиками и ссылками). */
export async function loadMoreAction(lang: unknown, key: unknown, query: unknown, page: unknown): Promise<{ cards: ShopCard[]; pages: number }> {
  const p = await prepare(lang, key, query);
  const n = typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= 200 ? page : 0;
  if (!p || !n) return { cards: [], pages: 0 };
  const data = await runListing(p.r, p.state, p.lang, n);
  return { cards: data?.cards ?? [], pages: data?.result.pages ?? 0 };
}

/** Сколько товаров найдётся с такими фильтрами (для кнопки «Показати N товарів» в шторке). */
export async function countAction(lang: unknown, key: unknown, query: unknown): Promise<number | null> {
  const p = await prepare(lang, key, query);
  if (!p) return null;
  const data = await runListing(p.r, { ...p.state, page: 1 }, p.lang, 1, { countOnly: true });
  return data?.result.total ?? null;
}
