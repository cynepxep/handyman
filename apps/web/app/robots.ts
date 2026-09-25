import type { MetadataRoute } from "next";

// До запуска магазина (Этап 8) сайт закрыт от поисковиков целиком (вопрос Т6).
// При запуске: разрешить витрину, закрыть /admin, /design, /api, служебные комбинации фильтров, добавить sitemap.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
