// Карта сайта для поисковиков (шаг Л1): какие адреса витрины в неё попадают и сам XML. Чистая логика без базы:
// данные собирает packages/db/src/sitemap.ts, отдают адреса /sitemap.xml и /sitemap/<N>.xml (apps/web/app/sitemap*).
// В карте — только то, что поисковик может и должен видеть: главная, каталог, разделы и подразделы с товарами, задачи, страницы
// «Сайт → Страницы» и товары (без «Нераспределённых» и скрытых). Каждый адрес — на двух языках (укр. без приставки, рус. /ru)
// со ссылками друг на друга (hreflang), как в <link rel="alternate"> самих страниц. Служебное (ROBOTS_PRIVATE_PATHS) — никогда.

import { paths, shopHref, SHOP_LANGS } from "./site/routes";
import { robotsBlocks, robotsRules, type RobotsRule } from "./launch-check";
import { HIDDEN_CATEGORY_IDS, slugOf, subCategoryMap, taskCategoryIds, type CatNode, type MenuConfig } from "./catalog/storefront-menu";

/** Ограничение Google: не больше 50 000 адресов в одном файле карты. */
export const SITEMAP_MAX_URLS = 50_000;
/** Один адрес страницы даёт строку на каждом языке. */
export const SITEMAP_PATHS_PER_FILE = Math.floor(SITEMAP_MAX_URLS / SHOP_LANGS.length);

/** Адрес украинской версии (с «/» в начале, без ?запроса) и дата последнего изменения (ISO), если известна. */
export type SitemapPath = { path: string; lastModified?: string };

/** Всё, кроме товаров: меню владельца, категории со счётчиками видимых товаров, страницы «Сайт → Страницы». */
export type SitemapSource = {
  menu: MenuConfig;
  categories: CatNode[];
  /** число видимых товаров прямо в каждой категории */
  counts: Record<string, number>;
  pages: Array<{ slug: string; visible: boolean }>;
};

export type SitemapProduct = { sku: string; nameUk: string; updatedAt?: string | null };

const allowed = (p: SitemapPath) => !robotsBlocks(true, p.path);

/**
 * Адреса без товаров: главная, каталог, видимые разделы/подразделы/задачи, в которых есть товары (пустой раздел поисковику
 * не нужен — «тонкая» страница), видимые текстовые страницы. Порядок — как в меню.
 */
export function sitemapPagePaths(src: SitemapSource): SitemapPath[] {
  const out: SitemapPath[] = [{ path: paths.home() }, { path: paths.catalog() }];
  const count = (ids: string[]) => ids.reduce((a, id) => a + (HIDDEN_CATEGORY_IDS.includes(id) ? 0 : (src.counts[id] ?? 0)), 0);
  const map = subCategoryMap(src.categories, src.menu.groups);
  for (const g of src.menu.groups) {
    if (g.hidden) continue;
    // раздел показывает товары всех своих подразделов (как resolveListing на витрине)
    if (count(g.subs.flatMap((s) => map.get(s.id) ?? [])) === 0) continue;
    out.push({ path: paths.group(slugOf(g)) });
    for (const s of g.subs) {
      if (s.hidden || count(map.get(s.id) ?? []) === 0) continue;
      out.push({ path: paths.sub(slugOf(g), slugOf(s)) });
    }
  }
  for (const t of src.menu.tasks) {
    if (t.hidden || count(taskCategoryIds(src.categories, t)) === 0) continue;
    out.push({ path: paths.task(slugOf(t)) });
  }
  for (const p of src.pages) if (p.visible) out.push({ path: paths.info(p.slug) });
  // один адрес — один раз (два раздела с одинаковым адресом владелец сохранить не может, но страховка дешёвая)
  const seen = new Set<string>();
  return out.filter((p) => allowed(p) && !seen.has(p.path) && Boolean(seen.add(p.path)));
}

/** Адрес товара — тот же, что canonical на странице товара (артикул + название по-украински). */
export function productSitemapPath(p: SitemapProduct): SitemapPath {
  return { path: paths.product(p.sku, p.nameUk), ...(p.updatedAt ? { lastModified: p.updatedAt } : {}) };
}

/** Сколько файлов нужно карте. 0 файлов не бывает: главная есть всегда. */
export function sitemapFileCount(pagePaths: number, products: number): number {
  return Math.max(1, Math.ceil((pagePaths + products) / SITEMAP_PATHS_PER_FILE));
}

/**
 * Что лежит в файле номер `file` (с 1): сначала все адреса без товаров, затем товары по порядку артикулов.
 * Возвращает полуоткрытые промежутки [from, to) в списке страниц и в списке товаров.
 */
export function sitemapFileRange(file: number, pagePaths: number, products: number): { pages: [number, number]; products: [number, number] } {
  const start = (file - 1) * SITEMAP_PATHS_PER_FILE;
  const end = Math.min(start + SITEMAP_PATHS_PER_FILE, pagePaths + products);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  return {
    pages: [clamp(start, pagePaths), clamp(end, pagePaths)],
    products: [clamp(start - pagePaths, products), clamp(end - pagePaths, products)],
  };
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Адрес сайта без «/» в конце: https://handyman.example. */
export const siteOrigin = (base: string | URL) => String(base).replace(/\/+$/, "");

/** XML карты: каждый адрес на обоих языках, у каждого — ссылки на обе версии и x-default (украинская). */
export function sitemapXml(list: SitemapPath[], base: string | URL): string {
  const origin = siteOrigin(base);
  const abs = (lang: (typeof SHOP_LANGS)[number], path: string) => xmlEscape(origin + shopHref(lang, path));
  const rows: string[] = [];
  for (const p of list) {
    const links =
      SHOP_LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${abs(l, p.path)}"/>`).join("") +
      `<xhtml:link rel="alternate" hreflang="x-default" href="${abs("uk", p.path)}"/>`;
    const mod = p.lastModified ? `<lastmod>${xmlEscape(p.lastModified)}</lastmod>` : "";
    for (const lang of SHOP_LANGS) rows.push(`<url><loc>${abs(lang, p.path)}</loc>${links}${mod}</url>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    rows.join("\n") + (rows.length ? "\n" : "") + `</urlset>\n`
  );
}

/** Адрес файла карты: один файл — /sitemap.xml, несколько — /sitemap.xml (оглавление) и /sitemap/1.xml, /sitemap/2.xml… */
export const sitemapFileUrl = (base: string | URL, file: number) => `${siteOrigin(base)}/sitemap/${file}.xml`;
export const sitemapRootUrl = (base: string | URL) => `${siteOrigin(base)}/sitemap.xml`;

/** Оглавление карты (sitemap index), когда адресов больше, чем помещается в один файл. */
export function sitemapIndexXml(files: number, base: string | URL): string {
  const rows = Array.from({ length: files }, (_, i) => `<sitemap><loc>${xmlEscape(sitemapFileUrl(base, i + 1))}</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</sitemapindex>\n`;
}

/** Номер файла из адреса /sitemap/<N>.xml (N с 1, без ведущих нулей). Не число — null. */
export function parseSitemapFile(name: string): number | null {
  const m = /^([1-9]\d{0,4})\.xml$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** robots.txt целиком: правила + строка «Sitemap:» — только когда сайт открыт для поисковиков. */
export function robotsConfig(open: boolean, base: string | URL): { rules: RobotsRule[]; sitemap?: string } {
  return open ? { rules: robotsRules(true), sitemap: sitemapRootUrl(base) } : { rules: robotsRules(false) };
}
