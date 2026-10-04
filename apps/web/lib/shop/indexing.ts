// Открыт ли сайт для поисковиков (шаг 8.5; переключает владелец в «Проверка перед запуском»). Кэш — как у контента витрины:
// переключатель вызывает shopChanged(), страницы сразу получают новый <meta name="robots">.
import "server-only";
import { loadIndexing, loadSearchConsole } from "@handyman/db/launch-check";
import { cached, TAG_SHOP } from "./cache";

export const indexingOpen = cached(async () => (await loadIndexing()).open, "site-indexing", [TAG_SHOP], 300);

/** Метаданные robots для страниц витрины: до открытия — noindex. */
export async function shopRobots(): Promise<{ index: boolean; follow: boolean }> {
  const open = await indexingOpen().catch(() => false);
  return { index: open, follow: open };
}

const searchConsoleCode = cached(async () => (await loadSearchConsole()).code, "site-search-console", [TAG_SHOP], 3600);

/** Мета-тег google-site-verification (шаг Л1): код из «Проверки перед запуском»; нет кода — тега нет. */
export async function shopVerification(): Promise<{ google: string } | undefined> {
  const code = await searchConsoleCode().catch(() => null);
  return code ? { google: code } : undefined;
}
