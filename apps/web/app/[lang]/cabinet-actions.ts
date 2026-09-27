"use server";
// Кабинет покупателя (шаг 5.5): общая корзина сайт ↔ Mini App, «Обране», «Мій інструмент». Всё — только для своей сессии (кука hm_client).
import { isShopLang } from "@handyman/core/site";
import { favoriteSkus, mergeFavorites, setFavorite, setTool, syncCart, type SyncedCart } from "@handyman/db/cabinet";
import type { CardData } from "@/components/shop/product-card";
import { getCardsBySkus } from "@/lib/shop/catalog";
import { getClient } from "@/lib/client-auth";

/** Корзина браузера встречается с корзиной в кабинете. null — покупатель не вошёл (корзина остаётся только в браузере). */
export async function cartSyncAction(input: { local: unknown; baseVersion: unknown; dirty: unknown }): Promise<SyncedCart | null> {
  const client = await getClient();
  if (!client) return null;
  return syncCart(client.id, input ?? {});
}

/** Избранное: гостевое из браузера (pending) переносится в кабинет; ответ — полный список. null — не вошёл. */
export async function favSyncAction(pending: unknown): Promise<string[] | null> {
  const client = await getClient();
  if (!client) return null;
  return Array.isArray(pending) && pending.length ? mergeFavorites(client.id, pending) : favoriteSkus(client.id);
}

/** Сердечко у вошедшего. false — не получилось (нет товара, список полон, сессия кончилась). */
export async function favToggleAction(sku: unknown, on: unknown): Promise<boolean> {
  const client = await getClient();
  if (!client || typeof sku !== "string") return false;
  return setFavorite(client.id, sku, on === true);
}

/** Карточки избранного (цены и наличие — свежие, с сервера). */
export async function favCardsAction(lang: unknown, skus: unknown): Promise<CardData[]> {
  if (!Array.isArray(skus)) return [];
  return getCardsBySkus(isShopLang(lang) ? lang : "uk", skus.filter((s): s is string => typeof s === "string"), 60);
}

/** «Це мій інструмент» / «Прибрати». */
export async function toolToggleAction(sku: unknown, on: unknown): Promise<boolean> {
  const client = await getClient();
  if (!client || typeof sku !== "string") return false;
  return setTool(client.id, sku, on === true);
}
