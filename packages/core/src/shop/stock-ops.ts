// Склад (шаг 4.4): доступный остаток, резерв под заказ, приход и инвентаризация — чистая логика без базы.
// Модель: StockItem.onHand — физически лежит; StockItem.reserved — отложено под заказы. Доступно покупателям = onHand − reserved.
// Жизнь товара в заказе (по движениям StockMovement с refOrderId):
//   заказ создан      → RESERVE +n           (reserved += n)
//   отправлен/выполнен → SALE −n, UNRESERVE −n (onHand −= n, reserved −= n)
//   отменён до отправки → UNRESERVE −n       (reserved −= n)
//   возврат после отправки → RETURN +n        (onHand += n)
// Старые заказы (до шага 4.4) списывали сразу SALE при оформлении — их отмена по-прежнему возвращает товар (RETURN).

export type StockCell = { onHand: number; reserved: number };

/** Сколько можно продать: сумма по складам max(0, onHand − reserved). */
export function availableQty(items: StockCell[]): number {
  return items.reduce((s, i) => s + Math.max(0, i.onHand - i.reserved), 0);
}

export type MoveLite = { stockItemId: string; delta: number; reason: string };

/** Состояние заказа на складе по его движениям: сколько ещё в резерве и сколько уже списано (продано и не возвращено) — по каждой ячейке. */
export function orderStockState(moves: MoveLite[]): Map<string, { reserved: number; sold: number }> {
  const m = new Map<string, { reserved: number; sold: number }>();
  for (const mv of moves) {
    const cur = m.get(mv.stockItemId) ?? { reserved: 0, sold: 0 };
    if (mv.reason === "RESERVE" || mv.reason === "UNRESERVE") cur.reserved += mv.delta;
    else if (mv.reason === "SALE" || mv.reason === "RETURN") cur.sold -= mv.delta;
    m.set(mv.stockItemId, cur);
  }
  for (const v of m.values()) {
    v.reserved = Math.max(0, v.reserved);
    v.sold = Math.max(0, v.sold);
  }
  return m;
}

/** Статусы, при которых товар физически ушёл со склада. */
export const SHIPPED_STATUSES = ["SHIPPED", "DONE"] as const;
/** Статусы, при которых заказ больше не держит товар. */
export const RELEASED_STATUSES = ["CANCELLED", "RETURNED"] as const;
export const isShipped = (s: string) => (SHIPPED_STATUSES as readonly string[]).includes(s);
export const isReleased = (s: string) => (RELEASED_STATUSES as readonly string[]).includes(s);

/** Товар заканчивается: следим (minStock > 0) и доступно не больше порога. */
export const isLowStock = (available: number, minStock: number) => minStock > 0 && available <= minStock;

// ---------- документы: приход и инвентаризация ----------

export type ReceivingLine = { sku: string; qty: number; unitCost: number | null };
export type InventoryLine = { sku: string; counted: number };

const parseLines = (raw: unknown): unknown[] => {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const cost = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
};

/** Строки прихода: артикул, количество 1–100 000, закупочная цена (необязательно). Повторы одного товара складываются. */
export function validateReceiving(raw: { lines?: unknown; supplier?: unknown; note?: unknown }): { ok: true; lines: ReceivingLine[]; supplier: string; note: string } | { ok: false; error: string } {
  const by = new Map<string, ReceivingLine>();
  for (const it of parseLines(raw.lines) as Array<Record<string, unknown>>) {
    const sku = String(it?.sku ?? "").trim().slice(0, 64);
    const qty = Math.floor(Number(it?.qty) || 0);
    if (!sku || qty <= 0) continue;
    if (qty > 100_000) return { ok: false, error: `Слишком большое количество у ${sku}.` };
    const prev = by.get(sku);
    by.set(sku, { sku, qty: (prev?.qty ?? 0) + qty, unitCost: cost(it?.unitCost) ?? prev?.unitCost ?? null });
  }
  if (!by.size) return { ok: false, error: "Добавьте хотя бы один товар с количеством." };
  return { ok: true, lines: [...by.values()], supplier: String(raw.supplier ?? "").trim().slice(0, 120), note: String(raw.note ?? "").trim().slice(0, 500) };
}

/** Строки инвентаризации: артикул и сколько насчитали (0 и больше). Пустые поля пропускаются — эти товары не трогаем. */
export function validateInventory(raw: { lines?: unknown; note?: unknown }): { ok: true; lines: InventoryLine[]; note: string } | { ok: false; error: string } {
  const by = new Map<string, InventoryLine>();
  for (const it of parseLines(raw.lines) as Array<Record<string, unknown>>) {
    const sku = String(it?.sku ?? "").trim().slice(0, 64);
    if (!sku || it?.counted === "" || it?.counted === null || it?.counted === undefined) continue;
    const counted = Number(it.counted);
    if (!Number.isInteger(counted) || counted < 0 || counted > 100_000) return { ok: false, error: `Количество у ${sku} — целое число от 0.` };
    by.set(sku, { sku, counted });
  }
  if (!by.size) return { ok: false, error: "Впишите фактическое количество хотя бы у одного товара." };
  return { ok: true, lines: [...by.values()], note: String(raw.note ?? "").trim().slice(0, 500) };
}

export const MOVE_REASON_RU: Record<string, string> = {
  IMPORT: "Загрузка", SALE: "Продажа (списание)", RETURN: "Возврат на склад", ADJUSTMENT: "Корректировка / инвентаризация",
  RECEIVING: "Приход", RESERVE: "Резерв под заказ", UNRESERVE: "Снят резерв",
};
