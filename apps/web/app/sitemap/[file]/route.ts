// Части большой карты сайта (шаг Л1): /sitemap/1.xml, /sitemap/2.xml… — на них ссылается оглавление /sitemap.xml.
import { parseSitemapFile } from "@handyman/core/sitemap";
import { sitemapPartXml, sitemapResponse } from "@/lib/shop/sitemap";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const n = parseSitemapFile((await params).file);
  return sitemapResponse(async () => (n == null ? null : sitemapPartXml(n)));
}
