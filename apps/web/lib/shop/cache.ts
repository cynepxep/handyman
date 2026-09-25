// Кэш данных витрины между запросами (шаг 2.8): тексты, контакты, меню, счётчики разделов, подсказки поиска.
// Цены, наличие и списки товаров НЕ кэшируются (берутся из базы и поиска на каждый запрос).
// Правки в админке видны сразу: действия админки вызывают shopChanged() / catalogChanged().
// Страховка на случай пропущенного сброса — срок жизни записи (revalidate).
import "server-only";
import { revalidatePath, unstable_cache, updateTag } from "next/cache";

/** Тексты, контакты, меню, страницы, настройки главной. */
export const TAG_SHOP = "shop";
/** Категории и счётчики товаров (меняются импортом и правкой товаров). */
export const TAG_CATALOG = "catalog";

/** Закэшировать функцию. Аргументы входят в ключ; результат должен сохраняться в JSON (без Map, Date → строка). */
export function cached<A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: string, tags: string[], revalidateSec: number) {
  return unstable_cache(fn, [key], { tags, revalidate: revalidateSec });
}

/** После правки контента сайта в админке (тексты, контакты, меню, страницы, главная, магазины): сайт покажет новое сразу. */
export function shopChanged(): void {
  updateTag(TAG_SHOP);
  updateTag(TAG_CATALOG);
  revalidatePath("/", "layout");
}

/** После правки товаров и категорий (видимость, категория, импорт): обновить счётчики разделов. */
export function catalogChanged(): void {
  updateTag(TAG_CATALOG);
}
