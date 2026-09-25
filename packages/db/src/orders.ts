// Заказы: корзина (цены с сервера), оформление, «Купити в 1 клік», статусы, свой склад.
// Деньги считает только сервер: цены берутся из базы, а не из браузера (правило №1; как createOrder старого магазина).
// Правила (суммы, телефон, проверка формы) — чистые функции в @handyman/core/shop; здесь — база, склад, уведомление.

import { randomBytes } from "node:crypto";
import { prisma, type Prisma, type OrderStatus } from "./client";
import {
  CHECKOUT_SETTING_KEY, ORDER_STATUS_RU, cleanCart, computeTotals, formatPhone, normalizePhone, orderNumber, parseCheckoutSettings, stockLevel, validateCheckout,
  type CartLineInput, type CheckoutErrors, type CheckoutSettings, type DeliveryChoice, type PayChoice, type StockLevel,
} from "@handyman/core/shop";
import { HIDDEN_CATEGORY_IDS } from "@handyman/core/catalog";
import { reindexProducts, reindexSafely } from "./catalog-search";
import { notifyManagers } from "./notify";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;

// ---------- склад ----------

/** Наш основной склад в Одессе (из сида; в тестовой базе создаётся при первом обращении). */
export async function defaultWarehouseId(): Promise<string> {
  const w = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (w) return w.id;
  return (await prisma.warehouse.create({ data: { id: "default", name: "Одеса (основний склад)", isDefault: true } })).id;
}

/** Остаток на нашем складе, шт. (сумма по складам). */
export async function ownStockOf(productIds: string[]): Promise<Map<string, number>> {
  const rows = productIds.length ? await prisma.stockItem.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, _sum: { onHand: true } }) : [];
  return new Map(rows.map((r) => [r.productId, r._sum.onHand ?? 0]));
}

/** Установить остаток на нашем складе (правка в админке). Изменение пишется в StockMovement, поиск обновляется. */
export async function setOwnStock(productId: string, qty: number, who: string): Promise<void> {
  const target = Math.max(0, Math.min(100_000, Math.floor(qty)));
  const warehouseId = await defaultWarehouseId();
  const cur = await prisma.stockItem.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  const delta = target - (cur?.onHand ?? 0);
  if (delta === 0) return;
  await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      create: { productId, warehouseId, onHand: target },
      update: { onHand: target },
    });
    await tx.stockMovement.create({ data: { stockItemId: item.id, delta, reason: "ADJUSTMENT", who } });
    await tx.auditLog.create({ data: { who, action: "stock.set", target: productId, details: json({ onHand: target, delta }) } });
  });
  await reindexSafely(() => reindexProducts([productId]));
}

// ---------- настройки оформления ----------

export async function loadCheckoutSettings(): Promise<CheckoutSettings> {
  const row = await prisma.setting.findUnique({ where: { key: CHECKOUT_SETTING_KEY } });
  return parseCheckoutSettings(row?.value);
}

export async function saveCheckoutSettings(value: CheckoutSettings, who: string): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: CHECKOUT_SETTING_KEY }, update: { value: json(value) }, create: { key: CHECKOUT_SETTING_KEY, value: json(value) } }),
    prisma.auditLog.create({ data: { who, action: "shop.checkout.edit", details: json(value) } }),
  ]);
}

// ---------- корзина ----------

export type QuoteLine = {
  productId: string;
  sku: string;
  nameUk: string;
  nameRu: string;
  price: number;
  oldPrice: number | null;
  image: string | null;
  stock: StockLevel;
  qty: number;
};

/** Корзина по данным базы: актуальные цены и наличие. Товары, которых больше нет (скрыты, удалены), — в `missing`. */
export async function quoteCart(rawItems: unknown): Promise<{ lines: QuoteLine[]; missing: string[] }> {
  const items = cleanCart(rawItems);
  if (!items.length) return { lines: [], missing: [] };
  const rows = await prisma.product.findMany({
    where: { sku: { in: items.map((i) => i.sku) }, visible: true, categoryId: { notIn: HIDDEN_CATEGORY_IDS } },
    select: {
      id: true, sku: true, nameUk: true, nameRu: true, price: true, oldPrice: true, supplierAvailable: true,
      images: { take: 1, orderBy: { sort: "asc" }, select: { url: true } },
    },
  });
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const own = await ownStockOf(rows.map((r) => r.id));
  const lines: QuoteLine[] = [];
  const missing: string[] = [];
  for (const it of items) {
    const r = bySku.get(it.sku);
    if (!r) {
      missing.push(it.sku);
      continue;
    }
    const price = r.price.toNumber();
    const old = r.oldPrice?.toNumber() ?? null;
    lines.push({
      productId: r.id, sku: r.sku, nameUk: r.nameUk, nameRu: r.nameRu, price, oldPrice: old && old > price ? old : null,
      image: r.images[0]?.url ?? null, stock: stockLevel(own.get(r.id) ?? 0, r.supplierAvailable), qty: it.qty,
    });
  }
  return { lines, missing };
}

// ---------- создание заказа ----------

const PAY_DB = { prepay: "PREPAY", full: "FULL", card: "CARD", later: "LATER" } as const;
const DELIVERY_DB = { np: "NOVA_POSHTA", pickup: "PICKUP", courier: "COURIER_ODESA" } as const;
const PAY_RU: Record<keyof typeof PAY_DB, string> = { prepay: "предоплата", full: "полная оплата на сайте", card: "по реквизитам", later: "уточнить" };
const NP_RU: Record<string, string> = { warehouse: "отделение", postomat: "почтомат", address: "адрес" };

export type PlaceResult = { ok: true; no: string; accessKey: string; total: number; dueNow: number } | { ok: false; errors: CheckoutErrors };
export type PlaceOptions = { lang: "uk" | "ru"; isTest?: boolean };

async function nextSeq(tx: Prisma.TransactionClient): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ n: number }>>`SELECT nextval(pg_get_serial_sequence('"Order"', 'seq'))::int AS n`;
  return row.n;
}

/** Найти покупателя по телефону или создать; имя заполняем, если его ещё не было. */
async function upsertClient(tx: Prisma.TransactionClient, phone: string, name: string, lang: "uk" | "ru") {
  const found = await tx.client.findUnique({ where: { phone } });
  if (found) {
    if (!found.name?.trim() && name) await tx.client.update({ where: { id: found.id }, data: { name } });
    return found.id;
  }
  return (await tx.client.create({ data: { phone, name: name || null, lang: lang === "ru" ? "RU" : "UK" } })).id;
}

/** Списать свой склад под заказ (сколько есть, не больше). Возвращает товары, у которых изменился остаток. */
async function takeOwnStock(tx: Prisma.TransactionClient, orderId: string, lines: QuoteLine[]): Promise<string[]> {
  const changed: string[] = [];
  for (const l of lines) {
    if (l.stock !== "local") continue;
    const items = await tx.stockItem.findMany({ where: { productId: l.productId, onHand: { gt: 0 } }, orderBy: { onHand: "desc" } });
    let need = l.qty;
    for (const it of items) {
      if (need <= 0) break;
      const take = Math.min(need, it.onHand);
      const upd = await tx.stockItem.updateMany({ where: { id: it.id, onHand: { gte: take } }, data: { onHand: { decrement: take } } });
      if (upd.count === 0) continue;
      await tx.stockMovement.create({ data: { stockItemId: it.id, delta: -take, reason: "SALE", refOrderId: orderId } });
      need -= take;
      changed.push(l.productId);
    }
  }
  return [...new Set(changed)];
}

async function createOrderRecord(p: {
  lines: QuoteLine[];
  pay: PayChoice | "later";
  delivery: DeliveryChoice | "to_confirm";
  settings: CheckoutSettings;
  phone: string;
  name: string;
  lang: "uk" | "ru";
  isTest: boolean;
  source: "site" | "one_click";
  city?: string | null;
  address?: string | null;
  npType?: string | null;
  npPoint?: string | null;
  comment?: string | null;
  noCallback?: boolean;
  history: string;
}) {
  const totals = computeTotals(p.lines, p.pay, p.settings);
  const accessKey = randomBytes(12).toString("base64url");
  const created = await prisma.$transaction(async (tx) => {
    const clientId = await upsertClient(tx, p.phone, p.name, p.lang);
    const seq = await nextSeq(tx);
    const order = await tx.order.create({
      data: {
        seq, no: orderNumber(seq), clientId, status: "NEW",
        payMode: PAY_DB[p.pay], delivery: p.delivery === "to_confirm" ? "TO_CONFIRM" : DELIVERY_DB[p.delivery],
        subtotal: totals.subtotal, discountPct: totals.discountPct, total: totals.total, dueNow: totals.dueNow,
        city: p.city ?? null, address: p.address ?? null, npWarehouseRef: p.npPoint ?? null, deliveryType: p.npType ?? null,
        comment: p.comment ?? null, noCallback: p.noCallback ?? false, isTest: p.isTest,
        recipientName: p.name, recipientPhone: p.phone, source: p.source, lang: p.lang === "ru" ? "RU" : "UK", accessKey,
        items: { create: p.lines.map((l, i) => ({ productId: l.productId, sku: l.sku, name: l.nameUk, qty: l.qty, unitPrice: totals.unitPrices[i] })) },
        history: { create: { text: p.history + (p.isTest ? " (ТЕСТОВЫЙ: заказ сотрудника)" : "") } },
      },
    });
    const changed = await takeOwnStock(tx, order.id, p.lines);
    return { order, changed };
  });
  if (created.changed.length) await reindexSafely(() => reindexProducts(created.changed));
  return { order: created.order, totals, accessKey };
}

function managerText(o: { no: string; isTest: boolean }, head: string, body: string[]) {
  return [`${o.isTest ? "🧪 ТЕСТ · " : ""}${head} ${o.no}`, ...body.filter(Boolean)].join("\n");
}

/** Оформление заказа с сайта. Ошибки — ключи текстов витрины. */
export async function placeOrder(raw: Record<string, unknown>, opts: PlaceOptions): Promise<PlaceResult> {
  const settings = await loadCheckoutSettings();
  const quote = await quoteCart(raw.items);
  if (quote.missing.length) return { ok: false, errors: { items: "err.itemsGone" } };
  const check = validateCheckout(raw, settings, quote.lines.map((l) => l.stock));
  if (!check.ok) return check;
  const v = check.value;
  // количество — как в корзине после очистки (cleanCart), цены — из базы
  const qtyBySku = new Map(v.items.map((i) => [i.sku, i.qty]));
  const lines = quote.lines.map((l) => ({ ...l, qty: qtyBySku.get(l.sku) ?? l.qty }));
  const name = `${v.lastName} ${v.firstName}`.trim();
  const { order, totals, accessKey } = await createOrderRecord({
    lines, pay: v.pay, delivery: v.delivery, settings, phone: v.phone, name, lang: opts.lang, isTest: opts.isTest ?? false, source: "site",
    city: v.delivery === "np" ? v.city : v.delivery === "courier" ? "Одеса" : null,
    address: v.delivery === "courier" ? v.address : null,
    npType: v.delivery === "np" ? v.npType : null, npPoint: v.delivery === "np" ? v.npPoint : null,
    comment: v.comment ?? null, noCallback: v.noCallback, history: "Заказ создан на сайте",
  });
  const delivery = v.delivery === "np" ? `Нова Пошта: ${v.city}, ${NP_RU[v.npType ?? "warehouse"]} ${v.npPoint}` : v.delivery === "pickup" ? "Самовывоз из магазина" : `Курьер по Одессе: ${v.address}`;
  await notifyManagers(managerText(order, "🆕 Новый заказ", [
    `${name}, ${formatPhone(v.phone)}${v.noCallback ? " (просит не звонить)" : ""}`,
    delivery,
    `Оплата: ${PAY_RU[v.pay]}. Сумма ${money(totals.total)}, сейчас ${money(totals.dueNow)}`,
    ...lines.map((l) => `• ${l.nameUk} × ${l.qty}${l.stock === "order" ? " — ПОД ЗАКАЗ" : l.stock === "local" ? " — со склада" : ""}`),
    v.comment ? `Комментарий: ${v.comment}` : "",
  ]), order.id).catch((e) => console.error("[orders] уведомление не сохранено", e));
  return { ok: true, no: order.no, accessKey, total: totals.total, dueNow: totals.dueNow };
}

/** «Купити в 1 клік»: товар, телефон, имя (необязательно). Доставку и оплату уточнит менеджер. */
export async function placeOneClick(
  raw: { sku?: unknown; qty?: unknown; phone?: unknown; name?: unknown },
  opts: PlaceOptions,
): Promise<{ ok: true; no: string; accessKey: string } | { ok: false; error: string }> {
  const phone = normalizePhone(String(raw.phone ?? ""));
  if (!phone) return { ok: false, error: "errPhone" };
  const items: CartLineInput[] = cleanCart([{ sku: raw.sku, qty: raw.qty ?? 1 }]);
  const quote = await quoteCart(items);
  if (!quote.lines.length) return { ok: false, error: "err.itemsGone" };
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const settings = await loadCheckoutSettings();
  const { order } = await createOrderRecord({
    lines: quote.lines, pay: "later", delivery: "to_confirm", settings, phone, name, lang: opts.lang, isTest: opts.isTest ?? false,
    source: "one_click", history: "Заказ «Купить в 1 клик»: перезвонить, уточнить доставку и оплату",
  });
  const l = quote.lines[0];
  await notifyManagers(managerText(order, "⚡ Купить в 1 клик", [
    `${name || "Без имени"}, ${formatPhone(phone)} — перезвонить`,
    `• ${l.nameUk} × ${l.qty} = ${money(l.price * l.qty)}${l.stock === "order" ? " — ПОД ЗАКАЗ" : ""}`,
  ]), order.id).catch((e) => console.error("[orders] уведомление не сохранено", e));
  return { ok: true, no: order.no, accessKey: order.accessKey ?? "" };
}

// ---------- страница «Дякуємо» ----------

/** Заказ для страницы «Дякуємо»: только по номеру И ключу из ссылки; без личных данных. */
export async function orderForThanks(no: string, key: string) {
  if (!key || key.length < 8) return null;
  const o = await prisma.order.findUnique({
    where: { no },
    select: { no: true, accessKey: true, payMode: true, delivery: true, total: true, dueNow: true, source: true, createdAt: true, _count: { select: { items: true } } },
  });
  if (!o || !o.accessKey || o.accessKey !== key) return null;
  return {
    no: o.no, payMode: o.payMode, delivery: o.delivery, total: o.total.toNumber(), dueNow: o.dueNow.toNumber(),
    later: Math.round((o.total.toNumber() - o.dueNow.toNumber()) * 100) / 100, source: o.source, items: o._count.items,
  };
}

// ---------- заказы в админке ----------

export const ORDER_STATUSES: OrderStatus[] = ["NEW", "NO_ANSWER", "AWAITING_SUPPLIER", "PAID", "PACKED", "SHIPPED", "DONE", "CANCELLED", "RETURNED"];

export async function listOrders(opts: { status?: string; q?: string; page?: number; perPage?: number } = {}) {
  const perPage = opts.perPage ?? 40;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim() ?? "";
  const phone = q ? normalizePhone(q) : null;
  const where: Prisma.OrderWhereInput = {
    ...(opts.status && (ORDER_STATUSES as string[]).includes(opts.status) ? { status: opts.status as OrderStatus } : {}),
    ...(q
      ? { OR: [{ no: { contains: q.toUpperCase() } }, { recipientName: { contains: q, mode: "insensitive" } }, ...(phone ? [{ recipientPhone: phone }] : [{ recipientPhone: { contains: q.replace(/\D/g, "") || q } }])] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, include: { _count: { select: { items: true } } } }),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / perPage)), rows };
}

export const getOrderDetail = (id: string) =>
  prisma.order.findUnique({
    where: { id },
    include: { items: { include: { product: { select: { id: true, supplierAvailable: true } } } }, history: { orderBy: { ts: "asc" } }, client: true, outboxEntries: { orderBy: { createdAt: "asc" } } },
  });

/** Вернуть на склад то, что было списано под заказ (при отмене). Повторная отмена ничего не добавляет. */
async function returnOwnStock(tx: Prisma.TransactionClient, orderId: string): Promise<string[]> {
  const moves = await tx.stockMovement.findMany({ where: { refOrderId: orderId }, include: { stockItem: { select: { productId: true } } } });
  const balance = new Map<string, { productId: string; qty: number }>();
  for (const m of moves) {
    const cur = balance.get(m.stockItemId) ?? { productId: m.stockItem.productId, qty: 0 };
    cur.qty += m.reason === "SALE" ? -m.delta : m.reason === "RETURN" ? -m.delta : 0; // SALE: delta<0 → +, RETURN: delta>0 → −
    balance.set(m.stockItemId, cur);
  }
  const changed: string[] = [];
  for (const [stockItemId, { productId, qty }] of balance) {
    if (qty <= 0) continue;
    await tx.stockItem.update({ where: { id: stockItemId }, data: { onHand: { increment: qty } } });
    await tx.stockMovement.create({ data: { stockItemId, delta: qty, reason: "RETURN", refOrderId: orderId } });
    changed.push(productId);
  }
  return changed;
}

export async function setOrderStatus(orderId: string, status: OrderStatus, who: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  if (!ORDER_STATUSES.includes(status)) return { ok: false, error: "Неизвестный статус." };
  const changed = await prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!o) return null;
    if (o.status === status && !note) return [];
    await tx.order.update({ where: { id: orderId }, data: { status } });
    await tx.orderHistory.create({ data: { orderId, text: `${o.status !== status ? `Статус: ${ORDER_STATUS_RU[status] ?? status}` : "Заметка"} (${who})${note ? ` — ${note.slice(0, 300)}` : ""}` } });
    await tx.auditLog.create({ data: { who, action: "order.status", target: orderId, details: json({ from: o.status, to: status }) } });
    return status === "CANCELLED" || status === "RETURNED" ? returnOwnStock(tx, orderId) : [];
  });
  if (changed === null) return { ok: false, error: "Заказ не найден." };
  if (changed.length) await reindexSafely(() => reindexProducts(changed));
  return { ok: true };
}

export async function setOrderTtn(orderId: string, ttn: string, who: string): Promise<void> {
  const clean = ttn.replace(/\s/g, "").slice(0, 40);
  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { ttn: clean || null } }),
    prisma.orderHistory.create({ data: { orderId, text: `ТТН: ${clean || "—"} (${who})` } }),
  ]);
}
