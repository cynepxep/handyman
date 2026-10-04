// Карта сайта (шаг Л1): XML для /sitemap.xml и /sitemap/<N>.xml. Какие адреса — @handyman/core/sitemap, данные — @handyman/db/sitemap.
// Данные — в кэше: сброс при правке меню/страниц/товаров, страховка — 15 минут (импорт сбрасывает кэш в начале загрузки,
// а новые товары появляются в конце). Товары кэшируются кусками: в кэш Next.js не помещается запись больше 2 МБ,
// а у большого каталога весь список товаров — больше.
import "server-only";
import {
  productSitemapPath, sitemapFileCount, sitemapFileRange, sitemapIndexXml, sitemapXml, type SitemapPath,
} from "@handyman/core/sitemap";
import { loadSitemapBase, loadSitemapProducts } from "@handyman/db/sitemap";
import { TAG_CATALOG, TAG_SHOP, cached } from "./cache";
import { siteUrl } from "./content";
import { indexingOpen } from "./indexing";
import { getStaffSession } from "@/lib/auth";
import { logError } from "@handyman/db/errors";

/** Товаров в одном куске кэша (~0,7 МБ). */
const CHUNK = 5000;

const loadBase = cached(() => loadSitemapBase(), "sitemap-base", [TAG_SHOP, TAG_CATALOG], 900);
const loadChunk = cached((n: number) => loadSitemapProducts(n * CHUNK, CHUNK), "sitemap-products", [TAG_CATALOG], 900);

async function productPaths(from: number, to: number): Promise<SitemapPath[]> {
  if (to <= from) return [];
  const chunks = [];
  for (let n = Math.floor(from / CHUNK); n * CHUNK < to; n++) chunks.push(loadChunk(n));
  const rows = (await Promise.all(chunks)).flat();
  const offset = Math.floor(from / CHUNK) * CHUNK;
  return rows.slice(from - offset, to - offset).map(productSitemapPath);
}

/** XML файла номер `file` (с 1); нет такого — null. */
async function fileXml(file: number): Promise<string | null> {
  const base = await loadBase();
  if (file < 1 || file > sitemapFileCount(base.pages.length, base.products)) return null;
  const r = sitemapFileRange(file, base.pages.length, base.products);
  const list = [...base.pages.slice(r.pages[0], r.pages[1]), ...(await productPaths(r.products[0], r.products[1]))];
  return sitemapXml(list, siteUrl());
}

/** /sitemap.xml: вся карта, если помещается в один файл, иначе — оглавление со ссылками на /sitemap/1.xml, /sitemap/2.xml… */
export async function sitemapRootXml(): Promise<string> {
  const base = await loadBase();
  const files = sitemapFileCount(base.pages.length, base.products);
  return files === 1 ? (await fileXml(1))! : sitemapIndexXml(files, siteUrl());
}

/** /sitemap/<N>.xml (только когда файлов больше одного). */
export async function sitemapPartXml(file: number): Promise<string | null> {
  const base = await loadBase();
  return sitemapFileCount(base.pages.length, base.products) > 1 ? fileXml(file) : null;
}

/**
 * Ответ с картой. Пока сайт закрыт для Google, карты «нет» (404) — её видят только вошедшие в админку (посмотреть заранее).
 * Ошибка базы — 503: поисковик придёт позже, а не запомнит пустую карту.
 */
export async function sitemapResponse(build: () => Promise<string | null>): Promise<Response> {
  const open = await indexingOpen().catch(() => false);
  if (!open && !(await getStaffSession().catch(() => null))) return notFound();
  let xml: string | null;
  try {
    xml = await build();
  } catch (e) {
    logError("[sitemap] не удалось собрать карту сайта", e);
    return new Response("Service unavailable", { status: 503, headers: { "Retry-After": "600", "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (xml == null) return notFound();
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // закрытый сайт: карту смотрит сотрудник — не кэшировать; открытый — поисковики, час
      "Cache-Control": open ? "public, max-age=3600" : "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } });
