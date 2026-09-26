// Финансы владельца (шаг 4.5): прибыль по заказу, прибыль за месяц, постоянные расходы — чистая логика без базы.
// Прибыль по заказу = выручка − закупка − комиссия за оплату − доставка за счёт магазина. Скидка уже внутри цены позиции.
// Закупка: снимок в строке заказа (OrderItem.unitCost) → закупочная цена товара сейчас → оценка «цена × (1 − дилерская скидка %)».
// Реклама по каналам — позже (Этап 7), когда появятся расходы на рекламу.

export const FINANCE_SETTING_KEY = "shop.finance";

export type FinanceSettings = {
  /** Комиссия за приём оплаты, % от суммы заказа — по способу оплаты (эквайринг, «частинами»…). */
  commissionPct: Record<"PREPAY" | "FULL" | "CARD" | "LATER", number>;
  /** Оценка закупки, если закупочная цена не вписана: цена продажи × (1 − скидка/100). 0 — не оценивать. */
  dealerDiscountPct: number;
  /** Ниже этой маржи (%) заказ помечается в отчёте. 0 — не следить. */
  minMarginPct: number;
};

export const DEFAULT_FINANCE: FinanceSettings = { commissionPct: { PREPAY: 0, FULL: 0, CARD: 0, LATER: 0 }, dealerDiscountPct: 0, minMarginPct: 0 };

const pct = (v: unknown, max: number) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n * 100) / 100)) : 0;
};

export function normalizeFinance(raw: unknown): FinanceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FinanceSettings> & Record<string, unknown>;
  const c = (r.commissionPct ?? {}) as Record<string, unknown>;
  return {
    commissionPct: { PREPAY: pct(c.PREPAY, 20), FULL: pct(c.FULL, 20), CARD: pct(c.CARD, 20), LATER: pct(c.LATER, 20) },
    dealerDiscountPct: pct(r.dealerDiscountPct, 90),
    minMarginPct: pct(r.minMarginPct, 90),
  };
}

export type ProfitLine = { qty: number; unitPrice: number; unitCost: number | null; currentCost: number | null };

export type OrderProfit = {
  revenue: number;
  cost: number;
  /** сколько позиций посчитано по оценке (дилерская скидка) и сколько — вообще без закупки */
  estimated: number;
  unknown: number;
  commission: number;
  delivery: number;
  profit: number;
  marginPct: number; // прибыль / выручка × 100
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Прибыль по одному заказу. Позиции без закупки (и без оценки) считаются с закупкой 0 — и видны как «без закупки». */
export function orderProfit(o: { lines: ProfitLine[]; total: number; payMode: string; shopDeliveryCost: number }, s: FinanceSettings): OrderProfit {
  let cost = 0;
  let estimated = 0;
  let unknown = 0;
  for (const l of o.lines) {
    const known = l.unitCost ?? l.currentCost;
    if (known != null) cost += known * l.qty;
    else if (s.dealerDiscountPct > 0) {
      cost += l.unitPrice * (1 - s.dealerDiscountPct / 100) * l.qty;
      estimated++;
    } else unknown++;
  }
  const commission = o.total * ((s.commissionPct as Record<string, number>)[o.payMode] ?? 0) / 100;
  const profit = o.total - cost - commission - o.shopDeliveryCost;
  return {
    revenue: r2(o.total), cost: r2(cost), estimated, unknown, commission: r2(commission), delivery: r2(o.shopDeliveryCost),
    profit: r2(profit), marginPct: o.total > 0 ? Math.round((profit / o.total) * 1000) / 10 : 0,
  };
}

// ---------- месяц ----------

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** «2026-09» → проверенный месяц; иначе текущий месяц по Киеву. */
export function normalizeMonth(v: string | undefined, now = new Date()): string {
  if (v && YM.test(v)) return v;
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }).slice(0, 7);
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export const monthRu = (ym: string) => `${MONTHS_RU[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// ---------- постоянные расходы ----------

export const EXPENSE_CATEGORIES = ["Аренда", "Зарплаты", "Сервисы и связь", "Бухгалтер и налоги", "Реклама", "Доставка", "Упаковка", "Другое"];

export function validateExpense(raw: Record<string, unknown>): { ok: true; value: { month: string; category: string; title: string; amount: number } } | { ok: false; error: string } {
  const month = String(raw.month ?? "");
  if (!YM.test(month)) return { ok: false, error: "Выберите месяц." };
  const category = EXPENSE_CATEGORIES.includes(String(raw.category)) ? String(raw.category) : "Другое";
  const title = String(raw.title ?? "").trim().slice(0, 120) || category;
  const amount = Number(String(raw.amount ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return { ok: false, error: "Сумма — число больше нуля." };
  return { ok: true, value: { month, category, title, amount: r2(amount) } };
}
