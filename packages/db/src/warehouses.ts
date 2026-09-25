// Магазины и склады: список, правка в админке, точки самовывоза для оформления заказа, остатки товара по точкам.
// Правила формы — @handyman/core/shop (warehouse.ts), график — @handyman/core/site (schedule.ts).

import { prisma, type Prisma } from "./client";
import { parseSchedule } from "@handyman/core/site";
import { toPickupPoint, type PickupPoint, type WarehouseInput } from "@handyman/core/shop";
import { reindexProducts, reindexSafely } from "./catalog-search";
import { setOwnStock } from "./orders";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

export type WarehouseRow = Awaited<ReturnType<typeof listWarehouses>>[number];

/** Все точки по порядку (сначала основной склад). */
export async function listWarehouses() {
  const rows = await prisma.warehouse.findMany({ orderBy: [{ sort: "asc" }, { isDefault: "desc" }, { name: "asc" }] });
  const sums = await prisma.stockItem.groupBy({ by: ["warehouseId"], where: { onHand: { gt: 0 } }, _count: { _all: true }, _sum: { onHand: true } });
  const byId = new Map(sums.map((s) => [s.warehouseId, { products: s._count._all, pieces: s._sum.onHand ?? 0 }]));
  return rows.map((w) => ({ ...w, schedule: parseSchedule(w.schedule), stock: byId.get(w.id) ?? { products: 0, pieces: 0 } }));
}

/** Точки самовывоза на языке сайта (для оформления заказа). */
export async function pickupPoints(lang: "uk" | "ru"): Promise<PickupPoint[]> {
  const rows = await prisma.warehouse.findMany({ where: { isPickup: true }, orderBy: [{ sort: "asc" }, { isDefault: "desc" }, { name: "asc" }] });
  return rows.map((w) => toPickupPoint({ ...w, schedule: parseSchedule(w.schedule) }, lang));
}

/** Создать (id не задан) или изменить точку. */
export async function saveWarehouse(id: string | null, v: WarehouseInput, who: string): Promise<string> {
  const data = {
    name: v.name, cityUk: v.cityUk, cityRu: v.cityRu, addressUk: v.addressUk, addressRu: v.addressRu,
    isPickup: v.isPickup, sort: v.sort, schedule: json(v.schedule),
  };
  const w = id ? await prisma.warehouse.update({ where: { id }, data }) : await prisma.warehouse.create({ data });
  await prisma.auditLog.create({ data: { who, action: id ? "warehouse.edit" : "warehouse.create", target: w.id, details: json({ name: v.name, isPickup: v.isPickup }) } });
  return w.id;
}

/** Удалить можно только пустую точку: не основную, без товаров на остатке и без заказов на самовывоз. */
export async function deleteWarehouse(id: string, who: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = await prisma.warehouse.findUnique({ where: { id }, include: { _count: { select: { pickupOrders: true } } } });
  if (!w) return { ok: false, error: "Точка не найдена." };
  if (w.isDefault) return { ok: false, error: "Основной склад удалить нельзя (его можно переименовать)." };
  const stock = await prisma.stockItem.count({ where: { warehouseId: id, onHand: { gt: 0 } } });
  if (stock) return { ok: false, error: `Здесь ещё есть товары на остатке (${stock} поз.). Сначала обнулите остатки.` };
  if (w._count.pickupOrders) return { ok: false, error: "Из этой точки уже забирали заказы — удалить нельзя. Снимите галочку «Самовывоз», чтобы скрыть её." };
  const items = await prisma.stockItem.findMany({ where: { warehouseId: id }, select: { id: true } });
  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { stockItemId: { in: items.map((i) => i.id) } } }),
    prisma.stockItem.deleteMany({ where: { warehouseId: id } }),
    prisma.warehouse.delete({ where: { id } }),
    prisma.auditLog.create({ data: { who, action: "warehouse.delete", target: id, details: json({ name: w.name }) } }),
  ]);
  return { ok: true };
}

/** Остатки товара по точкам (для карточки товара в админке). */
export async function stockByWarehouse(productId: string) {
  const [ws, items] = await Promise.all([
    prisma.warehouse.findMany({ orderBy: [{ sort: "asc" }, { isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, cityUk: true } }),
    prisma.stockItem.findMany({ where: { productId }, select: { warehouseId: true, onHand: true } }),
  ]);
  const qty = new Map(items.map((i) => [i.warehouseId, i.onHand]));
  return ws.map((w) => ({ ...w, onHand: qty.get(w.id) ?? 0 }));
}

/** Сохранить остатки товара по нескольким точкам сразу; поиск обновляется один раз. */
export async function setStockLevels(productId: string, levels: Array<{ warehouseId: string; qty: number }>, who: string): Promise<boolean> {
  let changed = false;
  for (const l of levels) if (await setOwnStock(productId, l.qty, who, l.warehouseId, { reindex: false })) changed = true;
  if (changed) await reindexSafely(() => reindexProducts([productId]));
  return changed;
}
