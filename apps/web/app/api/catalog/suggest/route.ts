// Подсказки для строки поиска в шапке: название, фото, цена. /api/catalog/suggest?q=трим
import { NextRequest, NextResponse } from "next/server";
import { SearchUnavailableError, suggestProducts } from "@handyman/db/catalog-search";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  try {
    const result = await suggestProducts(q, 6);
    return NextResponse.json(result, { headers: { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } });
  } catch (e) {
    if (e instanceof SearchUnavailableError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[api/catalog/suggest]", e);
    return NextResponse.json({ error: "Не удалось выполнить поиск." }, { status: 500 });
  }
}
