// Статистика поиска для подсказок «часто шукають»: сколько раз в день искали запрос и сколько товаров нашлось.
// Хранится только нормализованный текст запроса (normalizeQuery отбрасывает телефоны, почту, ссылки, артикулы), без привязки к человеку.
import { normalizeQuery } from "@handyman/core/site";
import { prisma } from "./client";

const KEEP_DAYS = 90;

const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Записать поиск (страница результатов, первая страница без фильтров). Раз в сутки чистим записи старше 90 дней. */
export async function logSearch(raw: string, results: number): Promise<void> {
  const query = normalizeQuery(raw);
  if (!query) return;
  const day = today();
  await prisma.searchQueryDay.upsert({
    where: { day_query: { day, query } },
    update: { count: { increment: 1 }, results },
    create: { day, query, count: 1, results },
  });
  if (Math.random() < 0.01) {
    await prisma.searchQueryDay.deleteMany({ where: { day: { lt: new Date(day.getTime() - KEEP_DAYS * 86_400_000) } } });
  }
}

export type QueryStat = { query: string; count: number; results: number };

/** Самые частые запросы за `days` дней. `found` — только те, что находили товары (для подсказок); false — только «не нашли». */
export async function topQueries(opts: { days?: number; limit?: number; found?: boolean } = {}): Promise<QueryStat[]> {
  const since = new Date(today().getTime() - (opts.days ?? 30) * 86_400_000);
  const rows = await prisma.$queryRaw<Array<{ query: string; count: bigint; results: number }>>`
    SELECT s.query, SUM(s.count) AS count,
      (SELECT l.results FROM "SearchQueryDay" l WHERE l.query = s.query ORDER BY l.day DESC LIMIT 1) AS results
    FROM "SearchQueryDay" s
    WHERE s.day >= ${since}
    GROUP BY s.query
    ORDER BY SUM(s.count) DESC, s.query
    LIMIT 200`;
  return rows
    .map((r) => ({ query: r.query, count: Number(r.count), results: Number(r.results ?? 0) }))
    .filter((r) => (opts.found === undefined ? true : opts.found ? r.results > 0 : r.results === 0))
    .slice(0, opts.limit ?? 20);
}

/** Сколько штук заказывали из каждой категории за `days` дней (без тестовых и отменённых заказов). */
export async function orderedByCategory(days = 30): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.$queryRaw<Array<{ categoryId: string; qty: bigint }>>`
    SELECT p."categoryId", SUM(i.qty) AS qty
    FROM "OrderItem" i
    JOIN "Order" o ON o.id = i."orderId"
    JOIN "Product" p ON p.id = i."productId"
    WHERE o."createdAt" >= ${since} AND NOT o."isTest" AND o.status NOT IN ('CANCELLED', 'RETURNED')
    GROUP BY p."categoryId"`;
  return new Map(rows.map((r) => [r.categoryId, Number(r.qty)]));
}
