// Финансы владельца (шаг 4.5): прибыль по заказу и за месяц, постоянные расходы, деньги в пути, настройки комиссий.
// Считается только по нетестовым заказам. Выручка месяца — заказы, ставшие «Выполнен» в этом месяце (по Киеву).
// Правила расчёта — @handyman/core/shop (finance.ts).

import { prisma, type Prisma } from "./client";
import {
  FINANCE_SETTING_KEY, kyivDayStart, normalizeFinance, orderProfit, shiftMonth,
  type FinanceSettings, type OrderProfit, type ProfitLine,
} from "@handyman/core/shop";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function loadFinance(): Promise<FinanceSettings> {
  return normalizeFinance((await prisma.setting.findUnique({ where: { key: FINANCE_SETTING_KEY } }))?.value);
}

export async function saveFinance(raw: unknown, who: string): Promise<FinanceSettings> {
  const value = normalizeFinance(raw);
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: FINANCE_SETTING_KEY }, update: { value: json(value) }, create: { key: FINANCE_SETTING_KEY, value: json(value) } }),
    prisma.auditLog.create({ data: { who, action: "finance.settings", details: json(value) } }),
  ]);
  return value;
}

const orderSelect = {
  id: true, no: true, total: true, payMode: true, shopDeliveryCost: true, status: true, doneAt: true, createdAt: true, source: true, recipientName: true,
  items: { select: { qty: true, unitPrice: true, unitCost: true, product: { select: { purchasePrice: true } } } },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

const linesOf = (o: OrderRow): ProfitLine[] =>
  o.items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice.toNumber(), unitCost: i.unitCost?.toNumber() ?? null, currentCost: i.product?.purchasePrice?.toNumber() ?? null }));

const profitOf = (o: OrderRow, s: FinanceSettings): OrderProfit =>
  orderProfit({ lines: linesOf(o), total: o.total.toNumber(), payMode: o.payMode, shopDeliveryCost: o.shopDeliveryCost.toNumber() }, s);

/** Прибыль одного заказа (для карточки заказа, право «Финансы»). */
export async function orderProfitOf(orderId: string): Promise<OrderProfit | null> {
  const [o, s] = await Promise.all([prisma.order.findUnique({ where: { id: orderId }, select: orderSelect }), loadFinance()]);
  return o ? profitOf(o, s) : null;
}

export type MonthReport = {
  month: string;
  orders: Array<{ id: string; no: string; name: string | null; doneAt: Date; source: string | null; profit: OrderProfit; lowMargin: boolean }>;
  totals: { revenue: number; cost: number; commission: number; delivery: number; gross: number; expenses: number; net: number; marginPct: number; count: number; avg: number; estimated: number; unknown: number };
  prev: { revenue: number; net: number };
  expenses: Array<{ id: string; category: string; title: string; amount: number; who: string; createdAt: Date }>;
  inTransit: { count: number; amount: number };
  inWork: { count: number; amount: number };
};

async function monthTotals(month: string, s: FinanceSettings) {
  const from = kyivDayStart(`${month}-01`);
  const to = kyivDayStart(`${shiftMonth(month, 1)}-01`);
  const [orders, exp] = await Promise.all([
    prisma.order.findMany({ where: { isTest: false, status: "DONE", doneAt: { gte: from, lt: to } }, select: orderSelect, orderBy: { doneAt: "desc" } }),
    prisma.expense.findMany({ where: { month }, orderBy: { createdAt: "asc" } }),
  ]);
  const rows = orders.map((o) => ({ o, p: profitOf(o, s) }));
  const sum = (f: (p: OrderProfit) => number) => r2(rows.reduce((a, x) => a + f(x.p), 0));
  const revenue = sum((p) => p.revenue);
  const gross = sum((p) => p.profit);
  const expenses = r2(exp.reduce((a, e) => a + e.amount.toNumber(), 0));
  return { rows, exp, revenue, gross, expenses, net: r2(gross - expenses), sum };
}

/** Отчёт за месяц: заказы с прибылью, итоги, постоянные расходы, сравнение с прошлым месяцем, деньги в пути. */
export async function monthReport(month: string): Promise<MonthReport> {
  const s = await loadFinance();
  const [cur, prev, transit, work] = await Promise.all([
    monthTotals(month, s),
    monthTotals(shiftMonth(month, -1), s),
    // отправлены, но остаток ещё не получен (наложенный платёж Новой Почты и т. п.)
    prisma.order.findMany({ where: { isTest: false, status: "SHIPPED" }, select: { total: true, dueNow: true, paidAmount: true } }),
    prisma.order.aggregate({ where: { isTest: false, status: { in: ["NEW", "NO_ANSWER", "AWAITING_SUPPLIER", "PAID", "PACKED"] } }, _sum: { total: true }, _count: true }),
  ]);
  const transitDue = transit.map((o) => Math.max(0, o.total.toNumber() - Math.max(o.dueNow.toNumber(), o.paidAmount.toNumber()))).filter((x) => x > 0.005);
  const count = cur.rows.length;
  return {
    month,
    orders: cur.rows.map(({ o, p }) => ({ id: o.id, no: o.no, name: o.recipientName, doneAt: o.doneAt ?? o.createdAt, source: o.source, profit: p, lowMargin: s.minMarginPct > 0 && p.marginPct < s.minMarginPct })),
    totals: {
      revenue: cur.revenue, cost: cur.sum((p) => p.cost), commission: cur.sum((p) => p.commission), delivery: cur.sum((p) => p.delivery),
      gross: cur.gross, expenses: cur.expenses, net: cur.net, marginPct: cur.revenue > 0 ? Math.round((cur.gross / cur.revenue) * 1000) / 10 : 0,
      count, avg: count ? r2(cur.revenue / count) : 0,
      estimated: cur.rows.reduce((a, x) => a + x.p.estimated, 0), unknown: cur.rows.reduce((a, x) => a + x.p.unknown, 0),
    },
    prev: { revenue: prev.revenue, net: prev.net },
    expenses: cur.exp.map((e) => ({ id: e.id, category: e.category, title: e.title, amount: e.amount.toNumber(), who: e.who, createdAt: e.createdAt })),
    inTransit: { count: transitDue.length, amount: r2(transitDue.reduce((a, x) => a + x, 0)) },
    inWork: { count: work._count, amount: work._sum.total?.toNumber() ?? 0 },
  };
}

export async function addExpense(v: { month: string; category: string; title: string; amount: number }, who: string): Promise<void> {
  const e = await prisma.expense.create({ data: { ...v, who } });
  await prisma.auditLog.create({ data: { who, action: "finance.expense.add", target: e.id, details: json(v) } });
}

export async function deleteExpense(id: string, who: string): Promise<void> {
  const e = await prisma.expense.findUnique({ where: { id } });
  if (!e) return;
  await prisma.$transaction([
    prisma.expense.delete({ where: { id } }),
    prisma.auditLog.create({ data: { who, action: "finance.expense.delete", target: id, details: json({ title: e.title, amount: e.amount.toNumber(), month: e.month }) } }),
  ]);
}

/** Скопировать постоянные расходы прошлого месяца в этот (аренда и зарплаты обычно повторяются). Возвращает сколько добавлено. */
export async function copyExpensesFromPrev(month: string, who: string): Promise<number> {
  const prev = await prisma.expense.findMany({ where: { month: shiftMonth(month, -1) } });
  if (!prev.length) return 0;
  await prisma.expense.createMany({ data: prev.map((e) => ({ month, category: e.category, title: e.title, amount: e.amount, who })) });
  await prisma.auditLog.create({ data: { who, action: "finance.expense.copy", details: json({ month, count: prev.length }) } });
  return prev.length;
}

/** Доставка за счёт магазина по заказу (бесплатная доставка покупателю, курьер) — уменьшает прибыль заказа. */
export async function setOrderDeliveryCost(orderId: string, amount: number, who: string): Promise<void> {
  const v = r2(Math.max(0, Math.min(100_000, amount)));
  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { shopDeliveryCost: v } }),
    prisma.orderHistory.create({ data: { orderId, text: `Доставка за счёт магазина: ${v} ₴ (${who})` } }),
  ]);
}
