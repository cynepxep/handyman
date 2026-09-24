// Публичный поиск по каталогу для витрины (Этап 2), Mini App и бота.
// Пример: /api/catalog/search?q=круг&cat=acc&brand=Vitals&min=100&max=500&avail=1&f.diameter=125&sort=price_asc&page=2
import { NextRequest, NextResponse } from "next/server";
import { SearchUnavailableError, searchProducts, type SearchSort } from "@handyman/db/catalog-search";
import { FACET_DEFS } from "@handyman/core/catalog";

export const dynamic = "force-dynamic";

const SORTS = new Set<SearchSort>(["relevance", "price_asc", "price_desc", "new", "name"]);
const num = (v: string | null) => {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const facets: Record<string, string[]> = {};
  for (const def of FACET_DEFS) {
    const values = sp.getAll(`f.${def.key}`).map((v) => v.trim()).filter(Boolean).slice(0, 30);
    if (values.length) facets[def.key] = values;
  }
  const sort = sp.get("sort") as SearchSort | null;

  try {
    const result = await searchProducts({
      q: (sp.get("q") ?? "").slice(0, 100),
      cat: sp.get("cat")?.slice(0, 120) || undefined,
      brand: sp.getAll("brand").map((b) => b.trim()).filter(Boolean).slice(0, 30),
      min: num(sp.get("min")),
      max: num(sp.get("max")),
      available: sp.get("avail") === "1",
      sale: sp.get("sale") === "1",
      facets,
      sort: sort && SORTS.has(sort) ? sort : undefined,
      page: Math.max(1, Math.floor(num(sp.get("page")) ?? 1)),
      perPage: Math.floor(num(sp.get("per")) ?? 24),
    });
    return NextResponse.json(result, { headers: { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } });
  } catch (e) {
    if (e instanceof SearchUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[api/catalog/search]", e);
    return NextResponse.json({ error: "Не удалось выполнить поиск." }, { status: 500 });
  }
}
