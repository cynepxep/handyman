import type { MetadataRoute } from "next";
import { robotsRules } from "@handyman/core/launch-check";
import { loadIndexing } from "@handyman/db/launch-check";

// До запуска сайт закрыт от поисковиков целиком. Открывает владелец кнопкой в «Проверка перед запуском» (шаг 8.5):
// тогда витрина разрешена, служебное (админка, API, корзина, оформление, поиск, адреса с параметрами) — нет.
// Карта сайта (sitemap.xml) — Этап 6.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { open } = await loadIndexing();
  return { rules: robotsRules(open) };
}
