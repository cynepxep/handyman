"use server";

// «Ви переглядали»: браузер хранит только артикулы, карточки (цены, наличие) отдаёт сервер.
import { isShopLang } from "@handyman/core/site";
import type { CardData } from "@/components/shop/product-card";
import { getCardsBySkus } from "@/lib/shop/catalog";

export async function viewedCardsAction(lang: unknown, skus: unknown): Promise<CardData[]> {
  if (!Array.isArray(skus)) return [];
  return getCardsBySkus(isShopLang(lang) ? lang : "uk", skus.filter((s): s is string => typeof s === "string"));
}
