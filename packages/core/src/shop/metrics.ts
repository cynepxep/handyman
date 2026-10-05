// Метрики магазина (воронка, деньги, реклама) для «Отчёты → Метрики». Чистая логика без базы и сети (её же импортирует браузер —
// модуль входит в `@handyman/core/shop`, поэтому без node:crypto).
// Посетителей, корзины и начатые оформления сайт считает сам, без cookies: уникальность — по суточному отпечатку (адрес + браузер
// + соль дня, db/src/metrics.ts), отпечатки живут 2 дня. Канал визита и заказа — по рекламным меткам (кука hm_utm, Order.utm).

import { parseUtm, type Utm } from "./analytics";

/** Шаги воронки, которые считает сайт (заказы и выкуп — из базы заказов). */
export const METRIC_STEPS = ["visit", "cart", "checkout"] as const;
export type MetricStep = (typeof METRIC_STEPS)[number];
export const isMetricStep = (s: unknown): s is MetricStep => typeof s === "string" && (METRIC_STEPS as readonly string[]).includes(s);

/** Каналы: реклама Google, Meta (Facebook/Instagram), TikTok, другие метки (рассылка, блогер…) и «без меток» (поиск, закладки, мессенджеры). */
export const METRIC_CHANNELS = ["google", "meta", "tiktok", "other", "none"] as const;
export type MetricChannel = (typeof METRIC_CHANNELS)[number];
export const AD_CHANNELS: readonly MetricChannel[] = ["google", "meta", "tiktok", "other"];
export const METRIC_CHANNEL_RU: Record<MetricChannel, string> = {
  google: "Google Ads",
  meta: "Facebook / Instagram",
  tiktok: "TikTok",
  other: "Другие метки (utm)",
  none: "Без рекламы",
};

const has = (s: string | undefined, re: RegExp) => !!s && re.test(s.toLowerCase());

/** Канал по меткам рекламного перехода (кука hm_utm или Order.utm). Клик-идентификатор важнее utm_source. */
export function channelOf(raw: Utm | unknown | null): MetricChannel {
  const u = raw && typeof raw === "object" && !Array.isArray(raw) ? parseUtm(raw) : null;
  if (!u) return "none";
  if (u.gclid || u.gbraid || u.wbraid) return "google";
  if (u.fbclid) return "meta";
  if (u.ttclid) return "tiktok";
  const src = u.utm_source;
  if (has(src, /google|adwords|youtube/)) return "google";
  if (has(src, /facebook|instagram|^fb$|^ig$|meta/)) return "meta";
  if (has(src, /tiktok/)) return "tiktok";
  return src || u.utm_medium || u.utm_campaign ? "other" : "none";
}

/** Канал расхода на рекламу — по названию строки в «Финансы → Расходы» (категория «Реклама»): «Google Ads», «Instagram», «TikTok»… */
export function spendChannelOf(title: string): Exclude<MetricChannel, "none"> {
  const t = title.toLowerCase();
  if (/google|гугл|adwords|youtube|ютуб/.test(t)) return "google";
  if (/facebook|instagram|meta|фейсбук|фб|инстаграм|інстаграм|инста|інста/.test(t)) return "meta";
  if (/tik\s*tok|тик\s*ток|тік\s*ток/.test(t)) return "tiktok";
  return "other";
}

/** Категория расходов, которая считается рекламой (из EXPENSE_CATEGORIES). */
export const AD_EXPENSE_CATEGORY = "Реклама";

const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Расход на рекламу за дни периода: месячная сумма делится поровну на дни месяца (расходы вносятся по месяцам, а период — любые дни).
 * `days` — дни периода YYYY-MM-DD (periodDays). Результат — по каналам и всего, до копейки.
 */
export function adSpendFor(expenses: Array<{ month: string; title: string; amount: number }>, days: string[]): { total: number; byChannel: Record<string, number> } {
  const perMonth = new Map<string, number>();
  for (const d of days) perMonth.set(d.slice(0, 7), (perMonth.get(d.slice(0, 7)) ?? 0) + 1);
  const byChannel: Record<string, number> = {};
  let total = 0;
  for (const e of expenses) {
    const n = perMonth.get(e.month);
    if (!n || !(e.amount > 0)) continue;
    const part = (e.amount * n) / daysInMonth(e.month);
    const ch = spendChannelOf(e.title);
    byChannel[ch] = (byChannel[ch] ?? 0) + part;
    total += part;
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  for (const k of Object.keys(byChannel)) byChannel[k] = r2(byChannel[k]);
  return { total: r2(total), byChannel };
}

/** Доля в процентах с одним знаком; нечего делить — null («—»). */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** CAC — сколько стоил один новый покупатель: расход на рекламу / новые покупатели. Нет расхода или покупателей — null. */
export function cac(spend: number, newClients: number): number | null {
  return spend > 0 && newClients > 0 ? Math.round((spend / newClients) * 100) / 100 : null;
}

/** ROAS — сколько гривен продаж принесла одна гривна рекламы: выручка с рекламы / расход. Нет расхода — null. */
export function roas(revenue: number, spend: number): number | null {
  return spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null;
}

/** Похоже на робота (поисковик, проверка сайта, предпросмотр ссылки) — визит не считаем. Пустой браузер — тоже. */
export function isBotAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 20) return true;
  return /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|telegrambot|whatsapp|curl|wget|python|httpclient|monitor|uptime|scan/i.test(ua);
}
