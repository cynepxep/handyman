// Наш склад (шаг 4.4): доступный остаток, резерв под заказ, отгрузка, возврат; документы «Приход» и «Инвентаризация»; журнал; минимальный остаток.
// Правила — @handyman/core/shop (stock-ops.ts). Любое изменение остатка — строка StockMovement (кто, почему, по какому заказу/документу).

import { prisma, type Prisma } from "./client";
import {
  availableQty, isLowStock, isReleased, isShipped, orderStockState, type InventoryLine, type ReceivingLine,
} from "@handyman/core/shop";
import { reindexProducts, reindexSafely } from "./catalog-search";
import { notifyManagers } from "./notify";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

/** Наш основной склад в Одессе (из сида; в тестовой базе создаётся при первом обращении). */
export async function defaultWarehouseId(): Promise<string> {
  const w = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (w) return w.id;
  return (await prisma.warehouse.create({ data: { id: "default", name: "Одеса (основний склад)", isDefault: true } })).id;
}

/** Сколько можно продать с нашего склада, шт.: сумма по складам (на складе − в резерве). */
export async function ownStockOf(productIds: string[]): Promise<Map<string, number>> {
  const rows = productIds.length ? await prisma.stockItem.findMany({ where: { productId: { in: productIds } }, select: { productId: true, onHand: true, reserved: true } }) : [];
  const by = new Map<string, Array<{ onHand: number; reserved: number }>>();
  for (const r of rows) by.set(r.productId, [...(by.get(r.productId) ?? []), r]);
  return new Map([...by].map(([id, items]) => [id, availableQty(items)]));
}

/**
 * Установить физический остаток (правка в карточке товара). Изменение пишется в StockMovement, поиск обновляется.
 * `warehouseId` — какой магазин/склад (по умолчанию основной). Возвращает true, если остаток изменился.
 */
export async function setOwnStock(productId: string, qty: number, who: string, warehouseId?: string, opts: { reindex?: boolean } = {}): Promise<boolean> {
  const target = Math.max(0, Math.min(100_000, Math.floor(qty)));
  warehouseId ??= await defaultWarehouseId();
  const cur = await prisma.stockItem.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  const delta = target - (cur?.onHand ?? 0);
  if (delta === 0) return false;
  await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      create: { productId, warehouseId, onHand: target },
      update: { onHand: target },
    });
    await tx.stockMovement.create({ data: { stockItemId: item.id, delta, reason: "ADJUSTMENT", who } });
    await tx.auditLog.create({ data: { who, action: "stock.set", target: productId, details: json({ onHand: target, delta, warehouseId }) } });
  });
  if (opts.reindex !== false) await reindexSafely(() => reindexProducts([productId]));
  return true;
}

// ---------- заказ и склад ----------

export type LowStockHit = { productId: string; sku: string; name: string; available: number; minStock: number };

/**
 * Зарезервировать под заказ то, что есть на нашем складе (сколько доступно, не больше). Возвращает товары, у которых изменился
 * доступный остаток, и те, что при этом «перешли» порог минимального остатка (для уведомления менеджеру).
 */
export async function reserveForOrder(tx: Prisma.TransactionClient, orderId: string, lines: Array<{ productId: string | null; qty: number }>): Promise<{ changed: string[]; low: LowStockHit[] }> {
  const changed: string[] = [];
  const low: LowStockHit[] = [];
  for (const l of lines) {
    if (!l.productId || l.qty <= 0) continue;
    const items = await tx.stockItem.findMany({ where: { productId: l.productId }, orderBy: { onHand: "desc" } });
    const before = availableQty(items);
    if (before <= 0) continue;
    let need = l.qty;
    let took = 0;
    for (const it of items) {
      if (need <= 0) break;
      const free = it.onHand - it.reserved;
      const take = Math.min(need, free);
      if (take <= 0) continue;
      // защита от гонки: резерв проходит, только если свободного всё ещё хватает
      const upd = await tx.$executeRaw`UPDATE "StockItem" SET "reserved" = "reserved" + ${take} WHERE "id" = ${it.id} AND "onHand" - "reserved" >= ${take}`;
      if (upd === 0) continue;
      await tx.stockMovement.create({ data: { stockItemId: it.id, delta: take, reason: "RESERVE", refOrderId: orderId } });
      need -= take;
      took += take;
    }
    if (!took) continue;
    changed.push(l.productId);
    const p = await tx.product.findUnique({ where: { id: l.productId }, select: { sku: true, nameUk: true, minStock: true } });
    const after = before - took;
    if (p && isLowStock(after, p.minStock) && !isLowStock(before, p.minStock)) low.push({ productId: l.productId, sku: p.sku, name: p.nameUk, available: after, minStock: p.minStock });
  }
  return { changed: [...new Set(changed)], low };
}

async function orderMoves(tx: Prisma.TransactionClient | typeof prisma, orderId: string) {
  const moves = await tx.stockMovement.findMany({ where: { refOrderId: orderId }, include: { stockItem: { select: { productId: true } } } });
  const productOf = new Map(moves.map((m) => [m.stockItemId, m.stockItem.productId]));
  return { state: orderStockState(moves), productOf };
}

/** Что заказ держит на нашем складе: по товару — сколько в резерве и сколько уже списано (для карточки заказа и комплектовочного листа). */
export async function orderReservations(orderId: string): Promise<Map<string, { reserved: number; sold: number }>> {
  const { state, productOf } = await orderMoves(prisma, orderId);
  const by = new Map<string, { reserved: number; sold: number }>();
  for (const [stockItemId, s] of state) {
    const pid = productOf.get(stockItemId)!;
    const cur = by.get(pid) ?? { reserved: 0, sold: 0 };
    by.set(pid, { reserved: cur.reserved + s.reserved, sold: cur.sold + s.sold });
  }
  return by;
}

/** Отгрузка: зарезервированное под заказ списывается со склада. */
async function shipOrder(tx: Prisma.TransactionClient, orderId: string, who: string): Promise<string[]> {
  const { state, productOf } = await orderMoves(tx, orderId);
  const changed: string[] = [];
  for (const [stockItemId, s] of state) {
    if (s.reserved <= 0) continue;
    await tx.$executeRaw`UPDATE "StockItem" SET "onHand" = GREATEST("onHand" - ${s.reserved}, 0), "reserved" = GREATEST("reserved" - ${s.reserved}, 0) WHERE "id" = ${stockItemId}`;
    await tx.stockMovement.createMany({
      data: [
        { stockItemId, delta: -s.reserved, reason: "SALE", refOrderId: orderId, who },
        { stockItemId, delta: -s.reserved, reason: "UNRESERVE", refOrderId: orderId, who },
      ],
    });
    changed.push(productOf.get(stockItemId)!);
  }
  return changed;
}

/** Отмена/возврат: резерв снимается, уже списанное (отправленное) возвращается на склад. Повтор ничего не добавляет. */
async function releaseOrder(tx: Prisma.TransactionClient, orderId: string, who: string): Promise<string[]> {
  const { state, productOf } = await orderMoves(tx, orderId);
  const changed: string[] = [];
  for (const [stockItemId, s] of state) {
    if (s.reserved > 0) {
      await tx.$executeRaw`UPDATE "StockItem" SET "reserved" = GREATEST("reserved" - ${s.reserved}, 0) WHERE "id" = ${stockItemId}`;
      await tx.stockMovement.create({ data: { stockItemId, delta: -s.reserved, reason: "UNRESERVE", refOrderId: orderId, who } });
    }
    if (s.sold > 0) {
      await tx.stockItem.update({ where: { id: stockItemId }, data: { onHand: { increment: s.sold } } });
      await tx.stockMovement.create({ data: { stockItemId, delta: s.sold, reason: "RETURN", refOrderId: orderId, who } });
    }
    if (s.reserved > 0 || s.sold > 0) changed.push(productOf.get(stockItemId)!);
  }
  return changed;
}

/**
 * Склад при смене статуса заказа: отмена/возврат — снять резерв и вернуть отправленное; отправлен/выполнен — списать резерв;
 * вернули из отмены в работу — зарезервировать снова (сколько есть).
 */
export async function applyOrderStock(tx: Prisma.TransactionClient, orderId: string, from: string, to: string, who: string): Promise<{ changed: string[]; low: LowStockHit[] }> {
  if (from === to) return { changed: [], low: [] };
  if (isReleased(to)) return { changed: isReleased(from) ? [] : await releaseOrder(tx, orderId, who), low: [] };
  let changed: string[] = [];
  let low: LowStockHit[] = [];
  if (isReleased(from)) {
    const items = await tx.orderItem.findMany({ where: { orderId }, select: { productId: true, qty: true } });
    ({ changed, low } = await reserveForOrder(tx, orderId, items));
  }
  if (isShipped(to) && !isShipped(from)) changed = [...changed, ...(await shipOrder(tx, orderId, who))];
  return { changed: [...new Set(changed)], low };
}

/** Сообщить менеджерам, что товары заканчиваются (после резерва под заказ). Ошибки отправки не мешают заказу. */
export async function notifyLowStock(low: LowStockHit[]): Promise<void> {
  if (!low.length) return;
  const text = ["⚠️ Заканчивается на складе:", ...low.map((l) => `• ${l.name} (${l.sku}) — доступно ${l.available} шт., минимум ${l.minStock}`)].join("\n");
  await notifyManagers(text).catch((e) => console.error("[stock] уведомление не сохранено", e));
}

// ---------- документы ----------

async function productsBySku(skus: string[]) {
  const rows = await prisma.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true, nameUk: true } });
  return new Map(rows.map((r) => [r.sku, r]));
}

/** «Приход»: товар пришёл на склад. Остаток растёт, закупочная цена (если указана) записывается в товар. */
export async function receiveStock(p: { warehouseId?: string; supplier: string; note: string; lines: ReceivingLine[] }, who: string): Promise<{ ok: true; docId: string; seq: number } | { ok: false; error: string }> {
  const warehouseId = p.warehouseId || (await defaultWarehouseId());
  const bySku = await productsBySku(p.lines.map((l) => l.sku));
  const missing = p.lines.filter((l) => !bySku.has(l.sku)).map((l) => l.sku);
  if (missing.length) return { ok: false, error: `Не найдены товары: ${missing.join(", ")}.` };
  const doc = await prisma.$transaction(async (tx) => {
    const d = await tx.stockDoc.create({ data: { kind: "receiving", warehouseId, supplier: p.supplier || null, note: p.note || null, who } });
    for (const l of p.lines) {
      const productId = bySku.get(l.sku)!.id;
      const item = await tx.stockItem.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        create: { productId, warehouseId, onHand: l.qty },
        update: { onHand: { increment: l.qty } },
      });
      await tx.stockMovement.create({ data: { stockItemId: item.id, delta: l.qty, reason: "RECEIVING", docId: d.id, unitCost: l.unitCost, who } });
      if (l.unitCost != null) await tx.product.update({ where: { id: productId }, data: { purchasePrice: l.unitCost } });
    }
    await tx.auditLog.create({ data: { who, action: "stock.receive", target: d.id, details: json({ lines: p.lines.length, pieces: p.lines.reduce((s, l) => s + l.qty, 0) }) } });
    return d;
  });
  await reindexSafely(() => reindexProducts([...bySku.values()].map((x) => x.id)));
  return { ok: true, docId: doc.id, seq: doc.seq };
}

/** «Инвентаризация»: вписали, сколько насчитали; разница с учётом пишется в журнал как корректировка. */
export async function inventoryStock(p: { warehouseId?: string; note: string; lines: InventoryLine[] }, who: string): Promise<{ ok: true; docId: string; seq: number; diffs: number } | { ok: false; error: string }> {
  const warehouseId = p.warehouseId || (await defaultWarehouseId());
  const bySku = await productsBySku(p.lines.map((l) => l.sku));
  const missing = p.lines.filter((l) => !bySku.has(l.sku)).map((l) => l.sku);
  if (missing.length) return { ok: false, error: `Не найдены товары: ${missing.join(", ")}.` };
  const changed: string[] = [];
  const doc = await prisma.$transaction(async (tx) => {
    const d = await tx.stockDoc.create({ data: { kind: "inventory", warehouseId, note: p.note || null, who } });
    for (const l of p.lines) {
      const productId = bySku.get(l.sku)!.id;
      const cur = await tx.stockItem.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
      const delta = l.counted - (cur?.onHand ?? 0);
      if (delta === 0) continue;
      const item = await tx.stockItem.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        create: { productId, warehouseId, onHand: l.counted },
        update: { onHand: l.counted },
      });
      await tx.stockMovement.create({ data: { stockItemId: item.id, delta, reason: "ADJUSTMENT", docId: d.id, who } });
      changed.push(productId);
    }
    await tx.auditLog.create({ data: { who, action: "stock.inventory", target: d.id, details: json({ lines: p.lines.length, diffs: changed.length }) } });
    return d;
  });
  if (changed.length) await reindexSafely(() => reindexProducts(changed));
  return { ok: true, docId: doc.id, seq: doc.seq, diffs: changed.length };
}

// ---------- списки для админки ----------

export type StockRow = {
  productId: string; sku: string; name: string; onHand: number; reserved: number; available: number; minStock: number;
  purchasePrice: number | null; price: number; low: boolean;
};

/** Остатки нашего склада: товары, которые лежат, в резерве или под наблюдением (минимальный остаток). */
export async function listStock(opts: { q?: string; warehouseId?: string; low?: boolean; page?: number; perPage?: number } = {}) {
  const perPage = opts.perPage ?? 50;
  const q = opts.q?.trim() ?? "";
  const itemWhere: Prisma.StockItemWhereInput = { ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}), OR: [{ onHand: { gt: 0 } }, { reserved: { gt: 0 } }] };
  const products = await prisma.product.findMany({
    where: {
      OR: [{ stockItems: { some: itemWhere } }, { minStock: { gt: 0 } }],
      ...(q ? { AND: [{ OR: [{ sku: { contains: q } }, { nameUk: { contains: q, mode: "insensitive" } }, { nameRu: { contains: q, mode: "insensitive" } }] }] } : {}),
    },
    select: {
      id: true, sku: true, nameUk: true, minStock: true, purchasePrice: true, price: true,
      stockItems: { where: opts.warehouseId ? { warehouseId: opts.warehouseId } : {}, select: { onHand: true, reserved: true } },
    },
    orderBy: { nameUk: "asc" },
  });
  let rows: StockRow[] = products.map((p) => {
    const onHand = p.stockItems.reduce((s, i) => s + i.onHand, 0);
    const reserved = p.stockItems.reduce((s, i) => s + i.reserved, 0);
    const available = availableQty(p.stockItems);
    return {
      productId: p.id, sku: p.sku, name: p.nameUk, onHand, reserved, available, minStock: p.minStock,
      purchasePrice: p.purchasePrice?.toNumber() ?? null, price: p.price.toNumber(), low: isLowStock(available, p.minStock),
    };
  });
  const totals = {
    products: rows.filter((r) => r.onHand > 0).length,
    pieces: rows.reduce((s, r) => s + r.onHand, 0),
    reserved: rows.reduce((s, r) => s + r.reserved, 0),
    value: Math.round(rows.reduce((s, r) => s + r.onHand * (r.purchasePrice ?? 0), 0) * 100) / 100,
    retail: Math.round(rows.reduce((s, r) => s + r.onHand * r.price, 0) * 100) / 100,
    noCost: rows.filter((r) => r.onHand > 0 && r.purchasePrice == null).length,
    low: rows.filter((r) => r.low).length,
  };
  if (opts.low) rows = rows.filter((r) => r.low);
  rows.sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name, "uk"));
  const page = Math.max(1, opts.page ?? 1);
  return { total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / perPage)), rows: rows.slice((page - 1) * perPage, page * perPage), totals };
}

/** Товары, которые заканчиваются (для главной админки и сводки). */
export async function lowStockList(limit = 20): Promise<StockRow[]> {
  return (await listStock({ low: true, perPage: limit })).rows;
}

/** Журнал движений склада: по товару, причине, документу. */
export async function listMoves(opts: { productId?: string; reason?: string; docId?: string; page?: number; perPage?: number } = {}) {
  const perPage = opts.perPage ?? 50;
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.StockMovementWhereInput = {
    ...(opts.productId ? { stockItem: { productId: opts.productId } } : {}),
    ...(opts.reason ? { reason: opts.reason as Prisma.StockMovementWhereInput["reason"] } : {}),
    ...(opts.docId ? { docId: opts.docId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage,
      include: { stockItem: { select: { product: { select: { id: true, sku: true, nameUk: true } }, warehouse: { select: { name: true } } } }, doc: { select: { seq: true, kind: true } } },
    }),
  ]);
  const orderIds = [...new Set(rows.map((r) => r.refOrderId).filter((x): x is string => Boolean(x)))];
  const orders = orderIds.length ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, no: true } }) : [];
  const noOf = new Map(orders.map((o) => [o.id, o.no]));
  return { total, page, pages: Math.max(1, Math.ceil(total / perPage)), rows: rows.map((r) => ({ ...r, orderNo: r.refOrderId ? noOf.get(r.refOrderId) ?? null : null })) };
}

export const listStockDocs = (limit = 30) =>
  prisma.stockDoc.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { _count: { select: { movements: true } } } });

/** Минимальный остаток и закупочная цена товара (из списка склада). */
export async function setStockSettings(productId: string, p: { minStock: number; purchasePrice: number | null }, who: string): Promise<void> {
  const minStock = Math.max(0, Math.min(100_000, Math.floor(p.minStock) || 0));
  await prisma.$transaction([
    prisma.product.update({ where: { id: productId }, data: { minStock, purchasePrice: p.purchasePrice } }),
    prisma.auditLog.create({ data: { who, action: "stock.settings", target: productId, details: json({ minStock, purchasePrice: p.purchasePrice }) } }),
  ]);
}
