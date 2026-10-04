"use server";

// Аналитика (шаг А1): данные для событий собирает сервер — цены и суммы из базы, браузер их не считает.
// Браузер вызывает эти действия, только если аналитика включена (на странице есть контейнер GTM).
import { purchaseEvent, type AnalyticsItem, type PurchaseEvent } from "@handyman/core/shop";
import { claimPurchase } from "@handyman/db/analytics";
import { logError } from "@handyman/db/errors";
import { getStaffSession } from "@/lib/auth";
import { getClient } from "@/lib/client-auth";
import { analyticsItemsFor, purchaseLinesWithCategories, type AnalyticsLineInput } from "@/lib/shop/analytics";

/** Товары для add_to_cart / remove_from_cart / begin_checkout / add_to_wishlist (цены — как в корзине этого покупателя). */
export async function analyticsItemsAction(lines: unknown): Promise<AnalyticsItem[]> {
  if (!Array.isArray(lines)) return [];
  try {
    const client = await getClient();
    return await analyticsItemsFor(lines as AnalyticsLineInput[], client?.id);
  } catch (e) {
    logError("[analytics] товары для события не собраны", e);
    return [];
  }
}

/**
 * Событие покупки для страницы «Дякуємо» (и «Купити в 1 клік»): отдаётся один раз на заказ (флаг в базе), только по номеру и ключу.
 * Тестовые, «подозрительные» и из браузера с входом в админку — null.
 */
export async function claimPurchaseAction(no: unknown, key: unknown): Promise<PurchaseEvent | null> {
  if (typeof no !== "string" || typeof key !== "string" || no.length > 20 || key.length > 64) return null;
  try {
    const staff = await getStaffSession().catch(() => null);
    const r = await claimPurchase(no, key, { staff: staff != null });
    if (!r.send) return null;
    return purchaseEvent(r.no, await purchaseLinesWithCategories(r.lines));
  } catch (e) {
    logError("[analytics] событие покупки не собрано", e);
    return null;
  }
}
