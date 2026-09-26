// Отчёты (шаг 4.6): главный экран, продажи, товары, заказы, каталог. Только из своей базы; тестовые заказы не считаются.
// «Продажи» — оформленные в периоде заказы без отмен и возвратов (сколько продали); «Финансы» (4.5) — выполненные (сколько заработали).
// Деньги показывает страница только тем, у кого право «Финансы» — здесь считаем всё, прячет интерфейс.

import { prisma } from "./client";
import { UNSORTED_ID } from "@handyman/core/catalog";
import { CANCEL_REASON_RU, kyivHour, kyivWeekday, kyivYmd, median, periodDays, type Period } from "@handyman/core/shop";
import { topQueries } from "./search-stats";
import { lowStockList } from "./stock";

const r2 = (n: number) => Math.round(n * 100) / 100;
const LOST = ["CANCELLED", "RETURNED"] as const;

type Row = { id: string; total: number; subtotal: number; status: string; source: string | null; payMode: string; createdAt: Date; clientId: string; delivery: string };

async function ordersIn(from: Date, to: Date): Promise<Row[]> {
  const rows = await prisma.order.findMany({
    where: { isTest: false, createdAt: { gte: from, lt: to } },
    select: { id: true, total: true, subtotal: true, status: true, source: true, payMode: true, createdAt: true, clientId: true, delivery: true },
  });
  return rows.map((r) => ({ ...r, total: r.total.toNumber(), subtotal: r.subtotal.toNumber() }));
}

function summarize(rows: Row[]) {
  const sold = rows.filter((r) => !(LOST as readonly string[]).includes(r.status));
  const revenue = r2(sold.reduce((s, r) => s + r.total, 0));
  return {
    orders: rows.length,
    sold: sold.length,
    revenue,
    avg: sold.length ? r2(revenue / sold.length) : 0,
    discounts: r2(sold.reduce((s, r) => s + Math.max(0, r.subtotal - r.total), 0)),
    lost: rows.length - sold.length,
    lostSum: r2(rows.filter((r) => (LOST as readonly string[]).includes(r.status)).reduce((s, r) => s + r.total, 0)),
  };
}

/** Новые и повторные покупатели периода: новый — первый нетестовый заказ за всё время пришёлся на этот период. */
async function newVsRepeat(rows: Row[], from: Date) {
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  if (!clientIds.length) return { newClients: 0, repeatClients: 0 };
  const before = await prisma.order.groupBy({ by: ["clientId"], where: { isTest: false, clientId: { in: clientIds }, createdAt: { lt: from } } });
  const had = new Set(before.map((b) => b.clientId));
  return { newClients: clientIds.filter((c) => !had.has(c)).length, repeatClients: clientIds.filter((c) => had.has(c)).length };
}

const countBy = <T>(xs: T[], key: (x: T) => string, val: (x: T) => number = () => 1) => {
  const m = new Map<string, { count: number; sum: number }>();
  for (const x of xs) {
    const k = key(x);
    const cur = m.get(k) ?? { count: 0, sum: 0 };
    m.set(k, { count: cur.count + 1, sum: r2(cur.sum + val(x)) });
  }
  return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.count - a.count);
};

/** Продажи: итоги со сравнением, по дням, по каналам, по оплате, по дням недели и часам, отмены по причинам. */
export async function salesReport(p: Period) {
  const [rows, prevRows] = await Promise.all([ordersIn(p.from, p.to), ordersIn(p.prevFrom, p.prevTo)]);
  const cur = summarize(rows);
  const prev = summarize(prevRows);
  const [clients, prevClients] = await Promise.all([newVsRepeat(rows, p.from), newVsRepeat(prevRows, p.prevFrom)]);
  const sold = rows.filter((r) => !(LOST as readonly string[]).includes(r.status));
  const byDay = new Map(periodDays(p).map((d) => [d, { orders: 0, revenue: 0 }]));
  for (const r of sold) {
    const d = byDay.get(kyivYmd(r.createdAt));
    if (d) {
      d.orders++;
      d.revenue = r2(d.revenue + r.total);
    }
  }
  const lostRows = await prisma.order.findMany({ where: { id: { in: rows.filter((r) => (LOST as readonly string[]).includes(r.status)).map((r) => r.id) } }, select: { cancelReason: true, total: true } });
  return {
    cur: { ...cur, ...clients },
    prev: { ...prev, ...prevClients },
    days: [...byDay].map(([day, v]) => ({ day, ...v })),
    bySource: countBy(sold, (r) => r.source ?? "site", (r) => r.total),
    byPay: countBy(sold, (r) => r.payMode, (r) => r.total),
    byDelivery: countBy(sold, (r) => r.delivery, (r) => r.total),
    byWeekday: Array.from({ length: 7 }, (_, i) => sold.filter((r) => kyivWeekday(r.createdAt) === i).length),
    byHour: Array.from({ length: 24 }, (_, h) => sold.filter((r) => kyivHour(r.createdAt) === h).length),
    lostByReason: countBy(lostRows, (r) => (r.cancelReason ? CANCEL_REASON_RU[r.cancelReason] ?? r.cancelReason : "не указана"), (r) => r.total.toNumber()),
  };
}

/** Товары: топ по количеству и выручке, «лежат без продаж» на нашем складе, спрос из поиска. */
export async function productsReport(p: Period, opts: { top?: number } = {}) {
  const top = opts.top ?? 20;
  const items = await prisma.orderItem.findMany({
    where: { order: { isTest: false, createdAt: { gte: p.from, lt: p.to }, status: { notIn: [...LOST] } } },
    select: { productId: true, sku: true, name: true, qty: true, unitPrice: true, unitCost: true },
  });
  const by = new Map<string, { productId: string | null; sku: string; name: string; qty: number; revenue: number; cost: number; costKnown: boolean; orders: number }>();
  for (const i of items) {
    const cur = by.get(i.sku) ?? { productId: i.productId, sku: i.sku, name: i.name, qty: 0, revenue: 0, cost: 0, costKnown: true, orders: 0 };
    cur.qty += i.qty;
    cur.revenue = r2(cur.revenue + i.unitPrice.toNumber() * i.qty);
    if (i.unitCost != null) cur.cost = r2(cur.cost + i.unitCost.toNumber() * i.qty);
    else cur.costKnown = false;
    cur.orders++;
    by.set(i.sku, cur);
  }
  const all = [...by.values()];
  // на нашем складе, но не продавались 30/60/90 дней — деньги лежат
  const since = (days: number) => new Date(Date.now() - days * 86400_000);
  const ownProducts = await prisma.product.findMany({
    where: { stockItems: { some: { onHand: { gt: 0 } } } },
    select: { id: true, sku: true, nameUk: true, purchasePrice: true, stockItems: { select: { onHand: true } }, orderItems: { where: { order: { isTest: false, status: { notIn: [...LOST] } } }, orderBy: { order: { createdAt: "desc" } }, take: 1, select: { order: { select: { createdAt: true } } } } },
  });
  const stale = ownProducts
    .map((x) => ({ productId: x.id, sku: x.sku, name: x.nameUk, onHand: x.stockItems.reduce((s, i) => s + i.onHand, 0), purchasePrice: x.purchasePrice?.toNumber() ?? null, lastSale: x.orderItems[0]?.order.createdAt ?? null }))
    .filter((x) => !x.lastSale || x.lastSale < since(30))
    .sort((a, b) => (a.lastSale?.getTime() ?? 0) - (b.lastSale?.getTime() ?? 0));
  const staleCount = (d: number) => stale.filter((x) => !x.lastSale || x.lastSale < since(d)).length;
  const [queries, notFound] = await Promise.all([topQueries({ days: Math.max(p.days, 1), limit: 10, found: true }), topQueries({ days: Math.max(p.days, 1), limit: 10, found: false })]);
  return {
    byQty: [...all].sort((a, b) => b.qty - a.qty).slice(0, top),
    byRevenue: [...all].sort((a, b) => b.revenue - a.revenue).slice(0, top),
    soldProducts: all.length,
    stale: stale.slice(0, 50),
    staleCounts: { d30: staleCount(30), d60: staleCount(60), d90: staleCount(90) },
    queries,
    notFound,
  };
}

/** Заказы: скорость (до первой смены статуса, до отправки), кто обрабатывал, «не дозвонились». По журналу действий. */
export async function ordersReport(p: Period) {
  const orders = await prisma.order.findMany({ where: { isTest: false, createdAt: { gte: p.from, lt: p.to } }, select: { id: true, createdAt: true, status: true, source: true, createdBy: true } });
  const ids = orders.map((o) => o.id);
  const logs = ids.length
    ? await prisma.auditLog.findMany({ where: { action: "order.status", target: { in: ids } }, orderBy: { ts: "asc" }, select: { target: true, ts: true, who: true, details: true } })
    : [];
  const created = new Map(orders.map((o) => [o.id, o.createdAt]));
  const firstTouch = new Map<string, Date>();
  const shipped = new Map<string, Date>();
  const byWho = new Map<string, { changes: number; orders: Set<string> }>();
  for (const l of logs) {
    if (!l.target) continue;
    if (!firstTouch.has(l.target)) firstTouch.set(l.target, l.ts);
    const to = (l.details as { to?: string } | null)?.to;
    if ((to === "SHIPPED" || to === "DONE") && !shipped.has(l.target)) shipped.set(l.target, l.ts);
    const w = byWho.get(l.who) ?? { changes: 0, orders: new Set<string>() };
    w.changes++;
    w.orders.add(l.target);
    byWho.set(l.who, w);
  }
  const mins = (m: Map<string, Date>) => [...m].map(([id, ts]) => (ts.getTime() - created.get(id)!.getTime()) / 60_000).filter((x) => x >= 0);
  const touch = mins(firstTouch);
  const ship = mins(shipped);
  return {
    total: orders.length,
    untouched: orders.filter((o) => !firstTouch.has(o.id) && o.status === "NEW").length,
    noAnswer: orders.filter((o) => o.status === "NO_ANSWER").length,
    firstTouchMedian: median(touch),
    shipMedian: median(ship),
    manual: orders.filter((o) => o.source === "manual").length,
    byWho: [...byWho].map(([who, v]) => ({ who, changes: v.changes, orders: v.orders.size })).sort((a, b) => b.orders - a.orders),
    byCreator: countBy(orders.filter((o) => o.createdBy), (o) => o.createdBy!),
  };
}

/** Каталог: сколько всего, видно, в наличии, без фото/описания/закупки, на своём складе, расхождения цен, «Нераспределённые». */
export async function catalogStats() {
  const [total, visible, supplier, own, noPhoto, noDesc, noCost, conflicts, unsorted] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { visible: true, categoryId: { not: UNSORTED_ID } } }),
    prisma.product.count({ where: { supplierAvailable: true } }),
    prisma.product.count({ where: { stockItems: { some: { onHand: { gt: 0 } } } } }),
    prisma.product.count({ where: { visible: true, images: { none: {} } } }),
    prisma.product.count({ where: { visible: true, OR: [{ descUk: null }, { descUk: "" }] } }),
    prisma.product.count({ where: { purchasePrice: null, stockItems: { some: { onHand: { gt: 0 } } } } }),
    prisma.product.count({ where: { priceConflict: true } }),
    prisma.product.count({ where: { categoryId: UNSORTED_ID } }),
  ]);
  return { total, visible, supplier, own, noPhoto, noDesc, noCost, conflicts, unsorted };
}

/** Главный экран: цифры за период со сравнением + что требует действия. */
export async function dashboard(p: Period) {
  const [sales, action, overdueTasks, low] = await Promise.all([
    salesReport(p),
    prisma.order.findMany({ where: { isTest: false, status: { in: ["NEW", "NO_ANSWER", "AWAITING_SUPPLIER"] } }, orderBy: { createdAt: "asc" }, take: 10, select: { id: true, no: true, status: true, createdAt: true, recipientName: true, total: true } }),
    prisma.task.count({ where: { done: false, dueAt: { lt: new Date() } } }),
    lowStockList(8),
  ]);
  return { sales, action, overdueTasks, low };
}
