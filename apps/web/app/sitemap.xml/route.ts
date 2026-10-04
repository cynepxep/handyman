// Карта сайта для поисковиков (шаг Л1): https://<домен>/sitemap.xml — этот адрес владелец отправляет в Google Search Console.
// Большой каталог (больше 25 000 страниц) — оглавление со ссылками на /sitemap/1.xml, /sitemap/2.xml…
// Пока сайт закрыт для Google — 404 (вошедшие в админку видят карту заранее).
import { sitemapResponse, sitemapRootXml } from "@/lib/shop/sitemap";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return sitemapResponse(sitemapRootXml);
}
