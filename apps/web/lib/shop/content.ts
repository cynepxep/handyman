// Контент витрины (тексты, контакты, меню, страницы) — один раз на запрос, даже если его просят шапка, страница и подвал.
import "server-only";
import { cache } from "react";
import { loadSiteContent, type SiteContent } from "@handyman/db/site-content";
import { EMPTY_CONTACTS, defaultTexts, fillText, shopHref, type ShopLang } from "@handyman/core/site";
import { defaultMenuConfig } from "@handyman/core/catalog";
import { TAG_SHOP, cached } from "./cache";

/** Контент из базы — в кэше между запросами (сбрасывается при сохранении в админке, страховка — час). */
const loadCached = cached((lang: ShopLang) => loadSiteContent(lang), "site-content", [TAG_SHOP], 3600);

/** Текст по ключу с подстановкой {переменных}. */
export type T = (key: string, vars?: Record<string, string | number>) => string;

export type ShopContent = SiteContent & { lang: ShopLang; t: T; pick: (uk: string, ru: string) => string };

export const getShopContent = cache(async (lang: ShopLang): Promise<ShopContent> => {
  let content: SiteContent;
  try {
    content = await loadCached(lang);
  } catch (e) {
    // База недоступна: сайт не падает, показывает стандартные тексты и меню.
    console.error("[shop] не удалось загрузить контент сайта", e);
    content = { texts: defaultTexts(lang), contacts: EMPTY_CONTACTS, menu: defaultMenuConfig(), pages: [] };
  }
  const t: T = (key, vars) => fillText(content.texts[key] ?? key, vars);
  const pick = (uk: string, ru: string) => (lang === "uk" ? uk : ru || uk);
  return { ...content, lang, t, pick };
});

/** Адрес сайта для метаданных (превью ссылок, hreflang). На сервере задаётся PUBLIC_URL в .env. */
export function siteUrl(): URL {
  const raw = process.env.PUBLIC_URL?.trim();
  try {
    return new URL(raw || "http://localhost:3100");
  } catch {
    return new URL("http://localhost:3100");
  }
}

/** Метаданные адреса страницы: канонический адрес и та же страница на другом языке (hreflang). */
export function alternatesFor(lang: ShopLang, path: string) {
  return {
    canonical: shopHref(lang, path),
    languages: { uk: shopHref("uk", path), ru: shopHref("ru", path), "x-default": shopHref("uk", path) },
  };
}
