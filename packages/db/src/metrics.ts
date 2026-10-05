// «Отчёты → Метрики»: воронка (посетители → корзина → оформление → заказ → выкуп), деньги (средний чек, валовая прибыль)
// и реклама (CAC, ROAS), повторные покупки. Только своя база; тестовые заказы не считаются. Формулы — @handyman/core/shop (metrics.ts).
//
// Посетителей сайт считает сам, без cookies: отпечаток = sha256(соль дня + адрес + браузер), соль новая каждый день (вчерашних
// посетителей с сегодняшними не связать), отпечатки старше вчера удаляются — остаются только числа по дням (MetricDay).
// Поэтому «посетители» за несколько дней — сумма уникальных за каждый день (кто заходил 3 дня подряд — 3 визита).

import { createHash, randomBytes } from "node:crypto";
import {
  AD_CHANNELS, AD_EXPENSE_CATEGORY, METRIC_CHANNELS, adSpendFor, cac, channelOf, isBotAgent, kyivYmd, parseUtm, periodDays, rate, roas,
  type MetricChannel, type MetricStep, type Period,
} from "@handyman/core/shop";
import { prisma } from "./client";
import { loadFinance, orderSelect, profitOf } from "./finance";

const SALT_KEY = "metrics.salt";
const r2 = (n: number) => Math.round(n * 100) / 100;
const LOST = ["CANCELLED", "RETURNED"];
/** Заказы, которые покупатель оформил сам (сайт, «1 клік», Telegram-магазин) — их делим на посетителей. По звонку — отдельно. */
const ONLINE = (source: string | null) => source !== "manual";
const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

let saltCache: { day: string; salt: string } | null = null;

/** Соль дня: первый визит нового дня меняет её (кто успел — тот и записал) и удаляет отпечатки старше вчера. */
async function daySalt(ymd: string): Promise<string> {
  if (saltCache?.day === ymd) return saltCache.salt;
  const fresh = { day: ymd, salt: randomBytes(16).toString("hex") };
  const changed = await prisma.$queryRaw<Array<{ value: { day?: string; salt?: string } }>>`
    INSERT INTO "Setting" ("key", "value") VALUES (${SALT_KEY}, ${JSON.stringify(fresh)}::jsonb)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value" WHERE "Setting"."value"->>'day' IS DISTINCT FROM ${ymd}
    RETURNING "value"`;
  if (changed.length) await prisma.metricSeen.deleteMany({ where: { day: { lt: dayDate(addDays(ymd, -1)) } } });
  const v = changed[0]?.value ?? ((await prisma.setting.findUnique({ where: { key: SALT_KEY } }))?.value as { day?: string; salt?: string } | undefined);
  const salt = v?.day === ymd && v.salt ? v.salt : fresh.salt;
  saltCache = { day: ymd, salt };
  return salt;
}

export type MetricHit = { ip: string; ua: string | null; utm?: unknown };

/**
 * Отметить шаг воронки для посетителя: один раз в день на шаг. Корзина и оформление заодно отмечают визит (воронка не «расширяется»).
 * Роботы не считаются. Возвращает, посчитан ли шаг впервые за день.
 */
export async function recordMetric(step: MetricStep, hit: MetricHit, now = new Date()): Promise<boolean> {
  if (isBotAgent(hit.ua)) return false;
  const ymd = kyivYmd(now);
  const salt = await daySalt(ymd);
  const visitor = createHash("sha256").update(`${salt}|${hit.ip}|${hit.ua}`).digest("hex").slice(0, 16);
  const channel = channelOf(typeof hit.utm === "string" ? parseUtm(hit.utm) : hit.utm ?? null);
  const day = dayDate(ymd);
  let first = false;
  for (const s of step === "visit" ? (["visit"] as const) : ([step, "visit"] as const)) {
    const ins = await prisma.metricSeen.createMany({ data: [{ day, step: s, visitor }], skipDuplicates: true });
    if (!ins.count) continue;
    if (s === step) first = true;
    await prisma.$executeRaw`
      INSERT INTO "MetricDay" ("day", "step", "channel", "count") VALUES (${day}::date, ${s}, ${channel}, 1)
      ON CONFLICT ("day", "step", "channel") DO UPDATE SET "count" = "MetricDay"."count" + 1`;
  }
  return first;
}

type ChannelRow = {
  channel: MetricChannel;
  visitors: number; cart: number; checkout: number;
  orders: number; sold: number; revenue: number; newClients: number;
  spend: number; roas: number | null; cac: number | null; conversion: number | null;
};

async function slice(from: Date, to: Date, fromYmd: string, toYmd: string, adExpenses: Array<{ month: string; title: string; amount: number }>, days: string[]) {
  const [steps, orders, fin] = await Promise.all([
    prisma.metricDay.groupBy({ by: ["step", "channel"], where: { day: { gte: dayDate(fromYmd), lte: dayDate(toYmd) } }, _sum: { count: true } }),
    prisma.order.findMany({ where: { isTest: false, createdAt: { gte: from, lt: to } }, select: { ...orderSelect, clientId: true, utm: true } }),
    loadFinance(),
  ]);
  const stepOf = (step: MetricStep, ch?: MetricChannel) =>
    steps.filter((s) => s.step === step && (!ch || s.channel === ch)).reduce((a, s) => a + (s._sum.count ?? 0), 0);

  // новые покупатели: первый нетестовый заказ за всё время — в этом периоде
  const clientIds = [...new Set(orders.map((o) => o.clientId))];
  const before = clientIds.length
    ? await prisma.order.groupBy({ by: ["clientId"], where: { isTest: false, clientId: { in: clientIds }, createdAt: { lt: from } } })
    : [];
  const had = new Set(before.map((b) => b.clientId));
  const firstOrder = new Map<string, string>(); // клиент → id его первого заказа в периоде (канал нового покупателя — по нему)
  for (const o of [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) if (!had.has(o.clientId) && !firstOrder.has(o.clientId)) firstOrder.set(o.clientId, o.id);
  const newIds = new Set(firstOrder.values());

  const rows = orders.map((o) => ({ o, ch: channelOf(o.utm), lost: LOST.includes(o.status), total: o.total.toNumber() }));
  const sold = rows.filter((r) => !r.lost);
  const done = rows.filter((r) => r.o.status === "DONE");
  const profits = done.map((r) => profitOf(r.o, fin));
  const revenue = r2(sold.reduce((a, r) => a + r.total, 0));
  const spend = adSpendFor(adExpenses, days);
  const adRevenue = r2(sold.filter((r) => r.ch !== "none").reduce((a, r) => a + r.total, 0));
  const visitors = stepOf("visit");
  const online = rows.filter((r) => ONLINE(r.o.source)).length;
  const newClients = newIds.size;
  const repeatClients = clientIds.length - newClients;

  const channels: ChannelRow[] = METRIC_CHANNELS.map((ch) => {
    const mine = rows.filter((r) => r.ch === ch);
    const mineSold = mine.filter((r) => !r.lost);
    const rev = r2(mineSold.reduce((a, r) => a + r.total, 0));
    const nc = mine.filter((r) => newIds.has(r.o.id)).length;
    const sp = spend.byChannel[ch] ?? 0;
    const v = stepOf("visit", ch);
    return {
      channel: ch, visitors: v, cart: stepOf("cart", ch), checkout: stepOf("checkout", ch),
      orders: mine.length, sold: mineSold.length, revenue: rev, newClients: nc,
      spend: sp, roas: roas(rev, sp), cac: cac(sp, nc), conversion: rate(mine.filter((r) => ONLINE(r.o.source)).length, v),
    };
  }).filter((c) => c.visitors || c.orders || c.spend || c.channel === "none");

  return {
    visitors,
    cart: stepOf("cart"),
    checkout: stepOf("checkout"),
    orders: rows.length,
    online,
    manual: rows.length - online,
    conversion: rate(online, visitors),
    done: done.length,
    doneOnline: done.filter((r) => ONLINE(r.o.source)).length,
    doneSum: r2(done.reduce((a, r) => a + r.total, 0)),
    lost: rows.length - sold.length,
    inWork: sold.length - done.length,
    buyout: rate(done.length, rows.length),
    sold: sold.length,
    revenue,
    avg: sold.length ? r2(revenue / sold.length) : 0,
    gross: r2(profits.reduce((a, p) => a + p.profit, 0)),
    grossRevenue: r2(profits.reduce((a, p) => a + p.revenue, 0)),
    grossEstimated: profits.reduce((a, p) => a + p.estimated, 0),
    grossUnknown: profits.reduce((a, p) => a + p.unknown, 0),
    spend: spend.total,
    adRevenue,
    adSold: sold.filter((r) => r.ch !== "none").length,
    newClients,
    repeatClients,
    repeatShare: rate(repeatClients, clientIds.length),
    cac: cac(spend.total, newClients),
    roas: roas(adRevenue, spend.total),
    channels,
  };
}

export type MetricsSlice = Awaited<ReturnType<typeof slice>>;

/** Метрики за период и за такой же период перед ним (для стрелок), по дням, по каналам; с какого дня сайт считает посетителей. */
export async function metricsReport(p: Period) {
  const days = periodDays(p);
  const prevDays = Array.from({ length: days.length }, (_, i) => addDays(p.fromYmd, i - days.length));
  const months = [...new Set([...days, ...prevDays].map((d) => d.slice(0, 7)))];
  const adExpenses = (await prisma.expense.findMany({ where: { category: AD_EXPENSE_CATEGORY, month: { in: months } }, select: { month: true, title: true, amount: true } }))
    .map((e) => ({ ...e, amount: e.amount.toNumber() }));
  const [cur, prev, byDay, firstDay, everyone] = await Promise.all([
    slice(p.from, p.to, p.fromYmd, p.toYmd, adExpenses, days),
    slice(p.prevFrom, p.prevTo, prevDays[0] ?? p.fromYmd, prevDays.at(-1) ?? p.fromYmd, adExpenses, prevDays),
    prisma.metricDay.groupBy({ by: ["day"], where: { step: "visit", day: { gte: dayDate(p.fromYmd), lte: dayDate(p.toYmd) } }, _sum: { count: true } }),
    prisma.metricDay.findFirst({ orderBy: { day: "asc" }, select: { day: true } }),
    // повторные за всё время: покупатели с 2+ заказами (без тестовых, отмен и возвратов) из всех, кто покупал
    prisma.order.groupBy({ by: ["clientId"], where: { isTest: false, status: { notIn: ["CANCELLED", "RETURNED"] } }, _count: { _all: true } }),
  ]);
  const visits = new Map(byDay.map((d) => [d.day.toISOString().slice(0, 10), d._sum.count ?? 0]));
  const ordersByDay = new Map<string, number>();
  const orderDays = await prisma.order.findMany({ where: { isTest: false, createdAt: { gte: p.from, lt: p.to } }, select: { createdAt: true, source: true } });
  for (const o of orderDays) if (ONLINE(o.source)) ordersByDay.set(kyivYmd(o.createdAt), (ordersByDay.get(kyivYmd(o.createdAt)) ?? 0) + 1);
  const buyers = everyone.length;
  const repeaters = everyone.filter((c) => c._count._all >= 2).length;
  return {
    cur,
    prev,
    days: days.map((d) => ({ day: d, visitors: visits.get(d) ?? 0, orders: ordersByDay.get(d) ?? 0 })),
    countingSince: firstDay ? firstDay.day.toISOString().slice(0, 10) : null,
    allTime: { buyers, repeaters, share: rate(repeaters, buyers) },
    adChannels: AD_CHANNELS,
  };
}
