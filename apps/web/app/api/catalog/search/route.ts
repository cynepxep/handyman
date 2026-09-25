// Публичный поиск по каталогу для витрины, Mini App и бота.
// Пример: /api/catalog/search?q=круг&cat=acc&brand=Vitals&min=100&max=500&avail=1&f.diameter=125&sort=price_asc&page=2
// Параметры фильтров разбираются так же, как в адресе страниц витрины (parseListing).
import { NextRequest, NextResponse } from "next/server";
import { SearchUnavailableError, searchProducts } from "@handyman/db/catalog-search";
import { FACET_DEFS } from "@handyman/core/catalog";
import { parseListing } from "@handyman/core/site/listing";

export const dynamic = "force-dynamic";

const FACET_KEYS = FACET_DEFS.map((d) => d.key);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const s = parseListing(sp, FACET_KEYS);
  const per = Number(sp.get("per"));

  try {
    const result = await searchProducts({
      q: (sp.get("q") ?? "").slice(0, 100),
      cat: sp.get("cat")?.slice(0, 120) || undefined,
      brand: sp.getAll("brand").map((b) => b.trim()).filter(Boolean).slice(0, 30),
      min: s.min,
      max: s.max,
      available: s.available,
      sale: s.sale,
      hit: s.hit,
      isNew: s.isNew,
      facets: s.facets,
      sort: s.sort,
      page: s.page,
      perPage: Number.isFinite(per) && per > 0 ? Math.floor(per) : 24,
    });
    return NextResponse.json(result, { headers: { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } });
  } catch (e) {
    if (e instanceof SearchUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[api/catalog/search]", e);
    return NextResponse.json({ error: "Не удалось выполнить поиск." }, { status: 500 });
  }
}
