// Аналитика (шаг А1): включатель «Аналитика включена», ID кабинетов для витрины, событие покупки — один раз на заказ.
// ID (GTM, GA4, Google Ads, Meta, TikTok) хранятся в «Интеграциях» (поле `analytics.*`, читаются через secret()), включатель —
// в Setting «analytics.settings» (по умолчанию выключено). Чистая логика (товары события, «слать ли покупку», метки) — core/src/shop/analytics.ts.
import { analyticsIdError, purchaseDecision, type AnalyticsIds, type PurchaseDecision, type PurchaseLine } from "@handyman/core/shop";
import { prisma, Prisma } from "./client";
import { secret } from "./integrations";

const SETTINGS_KEY = "analytics.settings";

export type AnalyticsSettings = { enabled: boolean; at: string | null; by: string | null };

export async function loadAnalyticsSettings(): Promise<AnalyticsSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const v = (row?.value ?? {}) as Partial<AnalyticsSettings>;
  return { enabled: v.enabled === true, at: typeof v.at === "string" ? v.at : null, by: typeof v.by === "string" ? v.by : null };
}

/** Включить/выключить аналитику на витрине (только владелец; запись в «Журнал»). */
export async function saveAnalyticsSettings(enabled: boolean, who: string): Promise<void> {
  const value: AnalyticsSettings = { enabled, at: new Date().toISOString(), by: who };
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } }),
    prisma.auditLog.create({ data: { who, action: "analytics.toggle", details: { enabled } } }),
  ]);
  analyticsChanged();
}

/** `on` — грузить контейнер GTM на витрине; `enabled` — включатель (покупка с сервера, шаг А3, работает и без GTM). */
export type AnalyticsConfig = { on: boolean; enabled: boolean; ids: AnalyticsIds };

let memo: { at: number; v: AnalyticsConfig } | null = null;
const TTL = 30_000;
/** Сбросить запомненное (после сохранения ID или включателя, в тестах). */
export const analyticsChanged = () => {
  memo = null;
};

/**
 * Что грузить на витрине: `on` — включатель и верный ID контейнера GTM (иначе ничего не грузится). Читается на каждой странице,
 * поэтому запоминается на 30 секунд (как ключи «Интеграций»).
 */
export async function analyticsConfig(): Promise<AnalyticsConfig> {
  if (memo && Date.now() - memo.at < TTL) return memo.v;
  const [settings, gtmId, ga4Id, adsConversionId, adsPurchaseLabel, metaPixelId, tiktokPixelId] = await Promise.all([
    loadAnalyticsSettings(),
    secret("analytics.gtmId"), secret("analytics.ga4Id"), secret("analytics.adsConversionId"), secret("analytics.adsPurchaseLabel"),
    secret("analytics.metaPixelId"), secret("analytics.tiktokPixelId"),
  ]);
  // значение из .env не проходило проверку формы — неверный ID просто не используем
  const ok = (field: keyof AnalyticsIds, v: string) => (v && !analyticsIdError(field, v) ? v : "");
  const ids: AnalyticsIds = {
    gtmId: ok("gtmId", gtmId), ga4Id: ok("ga4Id", ga4Id), adsConversionId: ok("adsConversionId", adsConversionId),
    adsPurchaseLabel: ok("adsPurchaseLabel", adsPurchaseLabel), metaPixelId: ok("metaPixelId", metaPixelId), tiktokPixelId: ok("tiktokPixelId", tiktokPixelId),
  };
  const v = { on: settings.enabled && Boolean(ids.gtmId), enabled: settings.enabled, ids };
  memo = { at: Date.now(), v };
  return v;
}

export type PurchaseClaim =
  | { send: true; no: string; lines: Array<PurchaseLine & { categoryId: string | null }> }
  | { send: false; reason: Exclude<PurchaseDecision, { send: true }>["reason"] | "not_found" };

/**
 * Событие покупки для страницы «Дякуємо»: отдаётся **один раз** — флаг `Order.analyticsAt` ставится тем же запросом
 * (одновременные запросы не получат его дважды). Только по номеру И ключу из ссылки. Тестовые, «подозрительные»
 * и открытые из браузера с админкой — без события (флаг не ставится). Цены — из заказа (после всех скидок).
 */
export async function claimPurchase(no: string, key: string, opts: { staff?: boolean } = {}): Promise<PurchaseClaim> {
  if (!key || key.length < 8) return { send: false, reason: "not_found" };
  const o = await prisma.order.findUnique({
    where: { no },
    select: {
      id: true, no: true, accessKey: true, isTest: true, suspicious: true, analyticsAt: true,
      items: { select: { sku: true, name: true, qty: true, unitPrice: true, product: { select: { categoryId: true, brand: { select: { name: true } } } } } },
    },
  });
  if (!o || !o.accessKey || o.accessKey !== key) return { send: false, reason: "not_found" };
  const d = purchaseDecision({ isTest: o.isTest, suspicious: o.suspicious, analyticsAt: o.analyticsAt, staff: opts.staff });
  if (!d.send) return d;
  const took = await prisma.order.updateMany({ where: { id: o.id, analyticsAt: null }, data: { analyticsAt: new Date() } });
  if (took.count !== 1) return { send: false, reason: "sent" };
  return {
    send: true,
    no: o.no,
    lines: o.items.map((i) => ({
      sku: i.sku, name: i.name, qty: i.qty, unitPrice: i.unitPrice.toNumber(), brand: i.product?.brand?.name ?? null, categoryId: i.product?.categoryId ?? null,
    })),
  };
}

/** Метки для записи в заказ (Prisma JSON). */
export const utmJson = (u: object | null | undefined) => (u ? (u as Prisma.InputJsonValue) : undefined);
