// Открыт ли сайт для поисковиков (шаг 8.5; переключает владелец в «Проверка перед запуском»). Кэш — как у контента витрины:
// переключатель вызывает shopChanged(), страницы сразу получают новый <meta name="robots">.
import "server-only";
import { loadIndexing } from "@handyman/db/launch-check";
import { cached, TAG_SHOP } from "./cache";

export const indexingOpen = cached(async () => (await loadIndexing()).open, "site-indexing", [TAG_SHOP], 300);

/** Метаданные robots для страниц витрины: до открытия — noindex. */
export async function shopRobots(): Promise<{ index: boolean; follow: boolean }> {
  const open = await indexingOpen().catch(() => false);
  return { index: open, follow: open };
}
