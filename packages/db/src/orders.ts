// Заказы: корзина (цены с сервера), оформление, «Купити в 1 клік», статусы, свой склад.
// Деньги считает только сервер: цены берутся из базы, а не из браузера (правило №1; как createOrder старого магазина).
// Правила (суммы, телефон, проверка формы) — чистые функции в @handyman/core/shop; здесь — база, склад, уведомление.

import { randomBytes } from "node:crypto";
import { prisma, type Prisma, type OrderStatus } from "./client";
import {
  ACTION_STATUSES, CANCEL_REASON_RU, SELLER_SETTING_KEY, kyivDayStart, needsCancelReason, parseSeller,
  type ManualOrderInput, type OrderFilters, type SellerDetails,
} from "@handyman/core/shop";
import {
  CHECKOUT_SETTING_KEY, ORDER_STATUS_RU, cleanCart, computeTotals, formatPhone, normalizePhone, orderNumber, parseCheckoutSettings, stockLevel, validateCheckout,
  type CartLineInput, type CheckoutErrors, type CheckoutSettings, type DeliveryChoice, type PayChoice, type StockLevel,
} from "@handyman/core/shop";
import { HIDDEN_CATEGORY_IDS } from "@handyman/core/catalog";
import { reindexProducts, reindexSafely } from "./catalog-search";
import { notifyManagers } from "./notify";
import { npPointByRef } from "./novaposhta";
import { photoStyleOn, pickImage } from "./photo-choice";
import { recalcClient } from "./clients";
import { applyOrderStock, notifyLowStock, ownStockOf, reserveForOrder } from "./stock";

// склад переехал в stock.ts (шаг 4.4); старые импорты из orders продолжают работать
export { defaultWarehouseId, ownStockOf, setOwnStock } from "./stock";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;

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
      images: { take: 1, orderBy: { sort: "asc" }, select: { url: true, localUrl: true, styledUrl: true } },
    },
  });
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const [own, styleOn] = await Promise.all([ownStockOf(rows.map((r) => r.id)), photoStyleOn()]);
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
      image: r.images[0] ? pickImage(r.images[0], styleOn) : null, stock: stockLevel(own.get(r.id) ?? 0, r.supplierAvailable), qty: it.qty,
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

async function createOrderRecord(p: {
  lines: QuoteLine[];
  pay: PayChoice | "later";
  delivery: DeliveryChoice | "to_confirm";
  settings: CheckoutSettings;
  phone: string;
  name: string;
  lang: "uk" | "ru";
  isTest: boolean;
  source: "site" | "one_click" | "manual";
  createdBy?: string | null;
  city?: string | null;
  address?: string | null;
  npType?: string | null;
  npPoint?: string | null;
  npCityRef?: string | null;
  npPointRef?: string | null;
  pickupWarehouseId?: string | null;
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
        npCityRef: p.npCityRef ?? null, npPointRef: p.npPointRef ?? null, pickupWarehouseId: p.pickupWarehouseId ?? null,
        comment: p.comment ?? null, noCallback: p.noCallback ?? false, isTest: p.isTest,
        recipientName: p.name, recipientPhone: p.phone, source: p.source, createdBy: p.createdBy ?? null, lang: p.lang === "ru" ? "RU" : "UK", accessKey,
        items: { create: p.lines.map((l, i) => ({ productId: l.productId, sku: l.sku, name: l.nameUk, qty: l.qty, unitPrice: totals.unitPrices[i] })) },
        history: { create: { text: p.history + (p.isTest ? " (ТЕСТОВЫЙ: заказ сотрудника)" : "") } },
      },
    });
    // резерв на нашем складе (шаг 4.4): товар остаётся на полке, но покупателям его «доступно» меньше
    const { changed, low } = await reserveForOrder(tx, order.id, p.lines.filter((l) => l.stock === "local"));
    return { order, changed, low };
  });
  if (created.changed.length) await reindexSafely(() => reindexProducts(created.changed));
  if (!p.isTest) await notifyLowStock(created.low);
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

  // самовывоз: точка из списка магазинов (одна — выбирается сама)
  let pickup: { id: string; cityUk: string; addressUk: string } | null = null;
  if (v.delivery === "pickup") {
    const list = await prisma.warehouse.findMany({ where: { isPickup: true }, orderBy: [{ sort: "asc" }, { isDefault: "desc" }], select: { id: true, cityUk: true, addressUk: true } });
    pickup = list.find((w) => w.id === v.pickupId) ?? (list.length === 1 ? list[0] : null);
    if (!pickup && list.length > 1) return { ok: false, errors: { pickup: "err.pickup" } };
  }
  // Нова Пошта: отделение выбрано из справочника — сверяем код и берём точное название
  let npPoint = v.npPoint ?? null;
  let npPointRef: string | null = null;
  if (v.delivery === "np" && v.npCityRef && v.npPointRef) {
    const found = await npPointByRef(v.npCityRef, v.npPointRef);
    if (found) {
      npPoint = found.uk;
      npPointRef = found.ref;
    }
  }

  const { order, totals, accessKey } = await createOrderRecord({
    lines, pay: v.pay, delivery: v.delivery, settings, phone: v.phone, name, lang: opts.lang, isTest: opts.isTest ?? false, source: "site",
    city: v.delivery === "np" ? v.city : v.delivery === "courier" ? "Одеса" : pickup?.cityUk ?? null,
    address: v.delivery === "courier" ? v.address : pickup?.addressUk ?? null,
    npType: v.delivery === "np" ? v.npType : null, npPoint: v.delivery === "np" ? npPoint : null,
    npCityRef: v.delivery === "np" ? (v.npCityRef ?? null) : null, npPointRef,
    pickupWarehouseId: pickup?.id ?? null,
    comment: v.comment ?? null, noCallback: v.noCallback, history: "Заказ создан на сайте",
  });
  const delivery =
    v.delivery === "np" ? `Нова Пошта: ${v.city}, ${npPointRef ? npPoint : `${NP_RU[v.npType ?? "warehouse"]} ${npPoint}`}`
    : v.delivery === "pickup" ? `Самовывоз${pickup ? `: ${pickup.cityUk}, ${pickup.addressUk}` : " из магазина"}`
    : `Курьер по Одессе: ${v.address}`;
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

export type ListOrdersOptions = Partial<Omit<OrderFilters, "page">> & { page?: number; perPage?: number };

/** Список заказов с фильтрами (шаг 4.3): статус или «требуют действия», источник, оплата, доставка, даты (по Киеву), тестовые. */
export async function listOrders(opts: ListOrdersOptions = {}) {
  const perPage = opts.perPage ?? 40;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim() ?? "";
  const phone = q ? normalizePhone(q) : null;
  const created: Prisma.DateTimeFilter = {
    ...(opts.from ? { gte: kyivDayStart(opts.from) } : {}),
    ...(opts.to ? { lt: kyivDayStart(opts.to, true) } : {}),
  };
  const where: Prisma.OrderWhereInput = {
    ...(opts.status === "action"
      ? { status: { in: [...ACTION_STATUSES] } }
      : opts.status && (ORDER_STATUSES as string[]).includes(opts.status) ? { status: opts.status as OrderStatus } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.pay ? { payMode: opts.pay as Prisma.OrderWhereInput["payMode"] } : {}),
    ...(opts.delivery ? { delivery: opts.delivery as Prisma.OrderWhereInput["delivery"] } : {}),
    ...(opts.from || opts.to ? { createdAt: created } : {}),
    ...(opts.test === "hide" ? { isTest: false } : opts.test === "only" ? { isTest: true } : {}),
    ...(q
      ? { OR: [{ no: { contains: q.toUpperCase() } }, { recipientName: { contains: q, mode: "insensitive" } }, ...(phone ? [{ recipientPhone: phone }] : [{ recipientPhone: { contains: q.replace(/\D/g, "") || q } }])] }
      : {}),
  };
  const [total, rows, sum, action] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, include: { _count: { select: { items: true } } } }),
    prisma.order.aggregate({ where: { ...where, isTest: false, status: { notIn: ["CANCELLED", "RETURNED"] } }, _sum: { total: true } }),
    prisma.order.count({ where: { status: { in: [...ACTION_STATUSES] }, isTest: false } }),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / perPage)), rows, sum: sum._sum.total?.toNumber() ?? 0, actionCount: action };
}

/** Заказ по звонку: менеджер вносит телефон, товары и доставку; цены — из базы (как на сайте). */
export async function placeManualOrder(v: ManualOrderInput, who: string): Promise<{ ok: true; id: string; no: string } | { ok: false; error: string }> {
  const quote = await quoteCart(v.items);
  if (quote.missing.length) return { ok: false, error: `Товар не найден или скрыт: ${quote.missing.join(", ")}.` };
  const settings = await loadCheckoutSettings();
  const pickup = v.delivery === "pickup" ? await prisma.warehouse.findFirst({ where: { isPickup: true }, orderBy: [{ isDefault: "desc" }, { sort: "asc" }] }) : null;
  const { order } = await createOrderRecord({
    lines: quote.lines, pay: v.pay, delivery: v.delivery, settings, phone: v.phone, name: v.name, lang: "uk", isTest: v.isTest,
    source: "manual", createdBy: who,
    city: v.delivery === "np" ? v.city : v.delivery === "courier" ? "Одеса" : pickup?.cityUk ?? null,
    address: v.delivery === "courier" ? v.address : pickup?.addressUk ?? null,
    npType: v.delivery === "np" ? "warehouse" : null, npPoint: v.delivery === "np" ? v.npPoint : null,
    pickupWarehouseId: pickup?.id ?? null, comment: v.comment || null,
    history: `Заказ создан менеджером по звонку (${who})`,
  });
  await prisma.auditLog.create({ data: { who, action: "order.manual", target: order.id, details: json({ no: order.no, items: v.items.length }) } });
  return { ok: true, id: order.id, no: order.no };
}

// ---------- реквизиты продавца (счёт) ----------

export async function loadSeller(): Promise<SellerDetails> {
  return parseSeller((await prisma.setting.findUnique({ where: { key: SELLER_SETTING_KEY } }))?.value);
}

export async function saveSeller(v: SellerDetails, who: string): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: SELLER_SETTING_KEY }, update: { value: json(v) }, create: { key: SELLER_SETTING_KEY, value: json(v) } }),
    prisma.auditLog.create({ data: { who, action: "shop.seller.edit" } }),
  ]);
}

export const getOrderDetail = (id: string) =>
  prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { id: true, supplierAvailable: true } } } }, history: { orderBy: { ts: "asc" } }, client: true,
      outboxEntries: { where: { audience: "manager" }, orderBy: { createdAt: "asc" } }, pickupWarehouse: { select: { name: true } },
    },
  });

/**
 * Сменить статус (и/или добавить заметку). Для «Отменён» и «Возврат» — причина из CANCEL_REASONS (если не указана — «Другое»);
 * при уходе из отмены причина стирается. Склад (шаг 4.4): отмена снимает резерв и возвращает отправленное, «Отправлен»/«Выполнен»
 * списывает резерв, возврат из отмены в работу резервирует снова.
 */
export async function setOrderStatus(orderId: string, status: OrderStatus, who: string, note?: string, cancelReason?: string): Promise<{ ok: boolean; error?: string }> {
  if (!ORDER_STATUSES.includes(status)) return { ok: false, error: "Неизвестный статус." };
  const reason = needsCancelReason(status) ? (cancelReason && CANCEL_REASON_RU[cancelReason] ? cancelReason : "other") : null;
  const res = await prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, clientId: true, cancelReason: true, isTest: true } });
    if (!o) return null;
    const reasonChanged = reason !== null && reason !== o.cancelReason;
    if (o.status === status && !note && !reasonChanged) return { changed: [], low: [], isTest: o.isTest };
    await tx.order.update({ where: { id: orderId }, data: { status, cancelReason: reason } });
    const head = o.status !== status ? `Статус: ${ORDER_STATUS_RU[status] ?? status}${reason ? ` (причина: ${CANCEL_REASON_RU[reason]})` : ""}` : reasonChanged ? `Причина: ${CANCEL_REASON_RU[reason!]}` : "Заметка";
    await tx.orderHistory.create({ data: { orderId, text: `${head} (${who})${note ? ` — ${note.slice(0, 300)}` : ""}` } });
    await tx.auditLog.create({ data: { who, action: "order.status", target: orderId, details: json({ from: o.status, to: status }) } });
    if (o.status !== status && (o.status === "DONE" || status === "DONE")) await recalcClient(tx, o.clientId); // сумма покупок и уровень
    return { ...(await applyOrderStock(tx, orderId, o.status, status, who)), isTest: o.isTest };
  });
  if (res === null) return { ok: false, error: "Заказ не найден." };
  if (res.changed.length) await reindexSafely(() => reindexProducts(res.changed));
  if (!res.isTest) await notifyLowStock(res.low);
  return { ok: true };
}

export async function setOrderTtn(orderId: string, ttn: string, who: string): Promise<void> {
  const clean = ttn.replace(/\s/g, "").slice(0, 40);
  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { ttn: clean || null } }),
    prisma.orderHistory.create({ data: { orderId, text: `ТТН: ${clean || "—"} (${who})` } }),
  ]);
}
