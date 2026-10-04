import type { MetadataRoute } from "next";
import { robotsConfig } from "@handyman/core/sitemap";
import { loadIndexing } from "@handyman/db/launch-check";
import { siteUrl } from "@/lib/shop/content";

// До запуска сайт закрыт от поисковиков целиком. Открывает владелец кнопкой в «Проверка перед запуском» (шаг 8.5):
// тогда витрина разрешена, служебное (админка, API, корзина, оформление, поиск, адреса с параметрами) — нет,
// и появляется строка «Sitemap:» с адресом карты сайта (шаг Л1, app/sitemap.xml).
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { open } = await loadIndexing();
  return robotsConfig(open, siteUrl());
}
