// Витрина+ (шаг 5.6) — чистая логика без базы: цена от количества (опт и упаковка), проверка отзыва/вопроса и заявки «Передзвоніть мені»,
// когда пора сообщить о снижении цены или поступлении, таблица сравнения товаров, код группы совместимости.
// Деньги считает только сервер: сюда приходят цены из базы.

import type { StockLevel } from "./stock";
import type { TierKey } from "./loyalty";
import { normalizePhone } from "./order";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- опт и упаковка ----------

/** Строка «Опт»: от `minQty` штук — `pricePerUnit` за штуку; `clientTier` — только для покупателей этого уровня (например, «Опт»). */
export type BreakRow = { minQty: number; pricePerUnit: number; clientTier: TierKey | null };
/** Упаковка: `unitsPerPack` штук за `packPrice` (например, 10 кругов за 900 ₴). */
export type PackRow = { unitLabel: string; unitsPerPack: number; packPrice: number };
/** Цена от количества: от `minQty` шт. — `unitPrice` за штуку. `pack` — если это цена упаковки. */
export type QtyPrice = { minQty: number; unitPrice: number; pack?: { label: string; units: number; price: number } };

/**
 * Лестница цен товара для покупателя: оптовые цены (общие и его уровня) и упаковки. Упаковка работает как опт: взяли 10 шт. —
 * цена за штуку как в упаковке. Оставляем только то, что дешевле обычной цены, и только если с ростом количества цена падает.
 */
export function qtyPrices(base: number, breaks: BreakRow[], packs: PackRow[], tier: TierKey | null = null): QtyPrice[] {
  const all: QtyPrice[] = [];
  for (const b of breaks) {
    if (b.clientTier && b.clientTier !== tier) continue;
    const minQty = Math.floor(b.minQty);
    if (minQty >= 2 && b.pricePerUnit > 0 && b.pricePerUnit < base) all.push({ minQty, unitPrice: round2(b.pricePerUnit) });
  }
  for (const p of packs) {
    const units = Math.floor(p.unitsPerPack);
    if (units < 2 || !(p.packPrice > 0)) continue;
    const unitPrice = round2(p.packPrice / units);
    if (unitPrice < base) all.push({ minQty: units, unitPrice, pack: { label: p.unitLabel.trim() || "уп.", units, price: round2(p.packPrice) } });
  }
  // одинаковое количество — берём дешевле; дальше — только если цена ниже, чем у меньшего количества
  all.sort((a, b) => a.minQty - b.minQty || a.unitPrice - b.unitPrice);
  const out: QtyPrice[] = [];
  for (const q of all) {
    const prev = out[out.length - 1];
    if (prev && prev.minQty === q.minQty) continue;
    if (prev && q.unitPrice >= prev.unitPrice) continue;
    out.push(q);
  }
  return out;
}

/** Цена за штуку при этом количестве. */
export function unitPriceAt(base: number, tiers: QtyPrice[], qty: number): number {
  let price = base;
  for (const t of tiers) if (qty >= t.minQty && t.unitPrice < price) price = t.unitPrice;
  return price;
}

/** Следующая ступенька (подсказка в корзине «ще 3 шт. — і по 85 ₴»). */
export const nextQtyPrice = (tiers: QtyPrice[], qty: number): QtyPrice | null => tiers.find((t) => t.minQty > qty) ?? null;

// ---------- отзывы и вопросы ----------

export const REVIEW_MAX_PHOTOS = 3;
export const REVIEW_MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export type ReviewKindInput = "review" | "question";
export type ReviewInput = { kind: ReviewKindInput; name: string; text: string; rating: number | null };
/** Ошибки — ключи текстов витрины. */
export type ReviewCheck = { ok: true; value: ReviewInput } | { ok: false; error: string };

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

/** Проверка отзыва/вопроса с сайта: имя, текст, оценка 1–5 у отзыва; ссылки (больше одной) — признак рекламы. */
export function validateReview(raw: Record<string, unknown>): ReviewCheck {
  const kind: ReviewKindInput = raw.kind === "question" ? "question" : "review";
  const name = clean(raw.name, 60).replace(/\n/g, " ");
  const text = clean(raw.text, 2000);
  const rating = kind === "review" ? Math.floor(Number(raw.rating)) : null;
  if (name.length < 2) return { ok: false, error: "review.err.name" };
  if (text.length < 5) return { ok: false, error: "review.err.text" };
  if (kind === "review" && !(rating != null && rating >= 1 && rating <= 5)) return { ok: false, error: "review.err.rating" };
  if ((text.match(/https?:\/\/|www\./gi) ?? []).length > 1) return { ok: false, error: "review.err.links" };
  return { ok: true, value: { kind, name, text, rating } };
}

/** Средняя оценка (до десятых) и сколько отзывов на каждую звезду (индекс 0 — одна звезда). */
export function ratingSummary(ratings: number[]): { avg: number; count: number; dist: number[] } {
  const valid = ratings.filter((r) => Number.isInteger(r) && r >= 1 && r <= 5);
  const dist = [0, 0, 0, 0, 0];
  for (const r of valid) dist[r - 1]++;
  const avg = valid.length ? Math.round((valid.reduce((a, r) => a + r, 0) / valid.length) * 10) / 10 : 0;
  return { avg, count: valid.length, dist };
}

// ---------- «Передзвоніть мені» ----------

export type CallbackCheck = { ok: true; value: { phone: string; name: string; note: string } } | { ok: false; error: string };

export function validateCallback(raw: Record<string, unknown>): CallbackCheck {
  const phone = normalizePhone(String(raw.phone ?? ""));
  if (!phone) return { ok: false, error: "errPhone" };
  return { ok: true, value: { phone, name: clean(raw.name, 60).replace(/\n/g, " "), note: clean(raw.note, 300).replace(/\n/g, " ") } };
}

// ---------- «Повідомити про зниження ціни / надходження» ----------

export type WatchKindKey = "PRICE" | "STOCK";

/** Пора ли написать покупателю: цена стала ниже, чем при подписке / товар появился (у нас или у поставщика). */
export function watchDue(kind: WatchKindKey, basePrice: number, cur: { price: number; stock: StockLevel; visible: boolean }): boolean {
  if (!cur.visible) return false;
  if (kind === "PRICE") return cur.price < basePrice - 0.005;
  return cur.stock !== "order";
}

// ---------- сравнение ----------

export const COMPARE_MAX = 4;

export type CompareRow = { name: string; values: Array<string | null>; same: boolean };

/** Таблица характеристик для сравнения: строки в порядке первого появления, `same` — у всех одинаково (кнопка «Лише відмінності»). */
export function compareRows(items: Array<{ attributes: Array<{ name: string; value: string }> }>): CompareRow[] {
  const order: string[] = [];
  const maps = items.map((it) => {
    const m = new Map<string, string>();
    for (const a of it.attributes) {
      const k = a.name.trim();
      if (!k || m.has(k)) continue;
      m.set(k, a.value.trim());
      if (!order.includes(k)) order.push(k);
    }
    return m;
  });
  return order.map((name) => {
    const values = maps.map((m) => m.get(name) ?? null);
    const norm = values.map((v) => (v ?? "").toLowerCase().replace(/\s+/g, " "));
    return { name, values, same: norm.every((v) => v === norm[0]) };
  });
}

/** Артикулы для сравнения из браузера: строки, без повторов, не больше 4. */
export function cleanSkuList(raw: unknown, max = COMPARE_MAX): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string").map((s) => s.trim().slice(0, 60)).filter(Boolean))].slice(0, max);
}
