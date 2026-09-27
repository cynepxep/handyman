// Витрина+ (шаг 5.6), работа с базой: совместимость «Підходить до» (группы, инструмент покупателя), отзывы и вопросы с модерацией и фото,
// «Повідомити про зниження ціни / надходження» (подписки и фоновая проверка), «Передзвоніть мені» (задача менеджерам).
// Правила (проверки, цены от количества, когда писать) — чистые функции в @handyman/core/shop.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { prisma, Prisma, type WatchKind } from "./client";
import {
  REVIEW_MAX_PHOTOS, availableQty, formatPhone, ratingSummary, stockLevel, validateCallback, validateReview, watchDue, type StockLevel,
} from "@handyman/core/shop";
import { HIDDEN_CATEGORY_IDS, slugify } from "@handyman/core/catalog";
import { fillText, paths, resolveTexts, shopHref } from "@handyman/core/site";
import { mediaFilePath } from "./media";
import { notifyClient, notifyManagers } from "./notify";
import { loadTextOverrides } from "./site-content";
import { reindexProducts, reindexSafely } from "./catalog-search";

export class PlusUserError extends Error {}

const money = (n: number) => `${n.toLocaleString("uk-UA", { maximumFractionDigits: 2 }).replace(/ /g, " ")} ₴`;
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Полный адрес страницы товара для сообщений в Telegram (без PUBLIC_URL — только название). */
function productUrl(sku: string, nameUk: string, lang: "uk" | "ru"): string {
  const base = process.env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}${shopHref(lang, paths.product(sku, nameUk))}` : "";
}

// ================= совместимость =================

export type CompatGroupRow = { id: string; key: string; label: string; labelRu: string | null; hosts: number; accessories: number };

export async function listCompatGroups(): Promise<CompatGroupRow[]> {
  const [groups, counts] = await Promise.all([
    prisma.compatibilityGroup.findMany({ orderBy: { label: "asc" } }),
    prisma.productCompatibility.groupBy({ by: ["groupId", "role"], _count: { _all: true } }),
  ]);
  const n = (id: string, role: "HOST" | "ACCESSORY") => counts.find((c) => c.groupId === id && c.role === role)?._count._all ?? 0;
  return groups.map((g) => ({ id: g.id, key: g.key, label: g.label, labelRu: g.labelRu, hosts: n(g.id, "HOST"), accessories: n(g.id, "ACCESSORY") }));
}

const cleanLabel = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

export async function createCompatGroup(label: unknown, labelRu: unknown, who: string): Promise<string> {
  const uk = cleanLabel(label);
  if (uk.length < 2) throw new PlusUserError("Укажите название группы, например «Диск 125 мм».");
  const base = slugify(uk).slice(0, 50) || "group";
  let key = base;
  for (let i = 2; await prisma.compatibilityGroup.findUnique({ where: { key } }); i++) key = `${base}-${i}`;
  const g = await prisma.compatibilityGroup.create({ data: { key, label: uk, labelRu: cleanLabel(labelRu) || null } });
  await prisma.auditLog.create({ data: { who, action: "compat.group.create", details: json({ key, label: uk }) } });
  return g.id;
}

export async function updateCompatGroup(id: string, label: unknown, labelRu: unknown, who: string): Promise<void> {
  const uk = cleanLabel(label);
  if (uk.length < 2) throw new PlusUserError("Укажите название группы.");
  await prisma.compatibilityGroup.update({ where: { id }, data: { label: uk, labelRu: cleanLabel(labelRu) || null } });
  await prisma.auditLog.create({ data: { who, action: "compat.group.edit", details: json({ id, label: uk }) } });
}

export async function deleteCompatGroup(id: string, who: string): Promise<void> {
  const ids = (await prisma.productCompatibility.findMany({ where: { groupId: id }, select: { productId: true } })).map((r) => r.productId);
  const g = await prisma.compatibilityGroup.delete({ where: { id } });
  await prisma.auditLog.create({ data: { who, action: "compat.group.delete", details: json({ key: g.key, label: g.label }) } });
  await reindexSafely(() => reindexProducts([...new Set(ids)]));
}

/** Добавить товары в группу по артикулам (через пробел, запятую или с новой строки). */
export async function addToCompatGroup(groupId: string, role: "HOST" | "ACCESSORY", rawSkus: unknown, who: string): Promise<{ added: number; notFound: string[] }> {
  const skus = [...new Set(String(rawSkus ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))].slice(0, 500);
  if (!skus.length) throw new PlusUserError("Впишите артикулы товаров.");
  const rows = await prisma.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } });
  const found = new Set(rows.map((r) => r.sku));
  const res = await prisma.productCompatibility.createMany({ data: rows.map((r) => ({ productId: r.id, groupId, role })), skipDuplicates: true });
  await prisma.auditLog.create({ data: { who, action: "compat.add", details: json({ groupId, role, skus: rows.map((r) => r.sku) }) } });
  await reindexSafely(() => reindexProducts(rows.map((r) => r.id)));
  return { added: res.count, notFound: skus.filter((s) => !found.has(s)) };
}

export async function removeFromCompatGroup(groupId: string, productId: string, role: "HOST" | "ACCESSORY", who: string): Promise<void> {
  await prisma.productCompatibility.deleteMany({ where: { groupId, productId, role } });
  await prisma.auditLog.create({ data: { who, action: "compat.remove", details: json({ groupId, productId, role }) } });
  await reindexSafely(() => reindexProducts([productId]));
}

export async function compatGroupDetail(id: string) {
  const g = await prisma.compatibilityGroup.findUnique({
    where: { id },
    include: { products: { include: { product: { select: { id: true, sku: true, nameUk: true, visible: true } } }, orderBy: { product: { nameUk: "asc" } } } },
  });
  if (!g) return null;
  const pick = (role: "HOST" | "ACCESSORY") => g.products.filter((p) => p.role === role).map((p) => p.product);
  return { id: g.id, key: g.key, label: g.label, labelRu: g.labelRu, hosts: pick("HOST"), accessories: pick("ACCESSORY") };
}

export type ProductCompat = { groupId: string; key: string; label: string; labelRu: string | null; role: "HOST" | "ACCESSORY" };

export async function compatOfProduct(productId: string): Promise<ProductCompat[]> {
  const rows = await prisma.productCompatibility.findMany({ where: { productId }, include: { group: true }, orderBy: { group: { label: "asc" } } });
  return rows.map((r) => ({ groupId: r.groupId, key: r.group.key, label: r.group.label, labelRu: r.group.labelRu, role: r.role }));
}

/**
 * «Мой инструмент» покупателя: инструменты (HOST в какой-нибудь группе), которые он заказывал (кроме отменённых и тестовых).
 * Кабинет «Мой инструмент» (шаг 5.5) добавит к этому списку инструмент, отмеченный вручную.
 */
export async function myToolGroups(clientId: string | null | undefined): Promise<{ keys: string[]; tools: string[] }> {
  if (!clientId) return { keys: [], tools: [] };
  const rows = await prisma.productCompatibility.findMany({
    where: { role: "HOST", product: { orderItems: { some: { order: { clientId, isTest: false, status: { notIn: ["CANCELLED", "RETURNED"] } } } } } },
    select: { group: { select: { key: true } }, product: { select: { nameUk: true } } },
  });
  return { keys: [...new Set(rows.map((r) => r.group.key))], tools: [...new Set(rows.map((r) => r.product.nameUk))] };
}

// ================= отзывы и вопросы =================

export const REVIEWS_PER_HOUR = 5;

/** Фото из отзыва: проверяем, что это картинка, поворачиваем по EXIF, уменьшаем до 1600 px, в WebP без метаданных (без GPS). */
export async function saveReviewPhoto(buf: Buffer): Promise<string> {
  let out: Buffer;
  try {
    const meta = await sharp(buf, { limitInputPixels: 40_000_000 }).metadata();
    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) throw new PlusUserError("format");
    out = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new PlusUserError("review.err.photo");
  }
  const h = createHash("sha1").update(out).digest("hex");
  const url = `/media/rv/${h.slice(0, 2)}/${h}.webp`;
  const file = mediaFilePath(url)!;
  if (!existsSync(/*turbopackIgnore: true*/ file)) {
    mkdirSync(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
    await writeFile(/*turbopackIgnore: true*/ file, out);
  }
  return url;
}

export type NewReview = {
  productId: string; raw: Record<string, unknown>; photos: string[]; clientId: string | null; lang: "uk" | "ru"; ip: string;
};

/** Отзыв или вопрос с сайта: в «ждёт проверки», менеджерам — сообщение. Ошибки — ключи текстов витрины. */
export async function createReview(p: NewReview): Promise<{ ok: true; kind: "review" | "question" } | { ok: false; error: string }> {
  const check = validateReview(p.raw);
  if (!check.ok) return check;
  const product = await prisma.product.findUnique({ where: { id: p.productId }, select: { id: true, sku: true, nameUk: true, visible: true, categoryId: true } });
  if (!product || !product.visible || HIDDEN_CATEGORY_IDS.includes(product.categoryId)) return { ok: false, error: "err.itemsGone" };
  const ipHash = createHash("sha256").update(`rv:${p.ip}`).digest("hex").slice(0, 32);
  const recent = await prisma.review.count({ where: { ipHash, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= REVIEWS_PER_HOUR) return { ok: false, error: "err.tooMany" };
  const v = check.value;
  const r = await prisma.review.create({
    data: {
      productId: product.id, kind: v.kind === "question" ? "QUESTION" : "REVIEW", rating: v.rating, name: v.name, text: v.text,
      photos: json(p.photos.slice(0, REVIEW_MAX_PHOTOS)), clientId: p.clientId, lang: p.lang === "ru" ? "RU" : "UK", ipHash,
    },
  });
  const head = v.kind === "question" ? "❓ Вопрос о товаре" : `⭐ Новый отзыв (${v.rating}/5)`;
  await notifyManagers(`${head}: ${product.nameUk} (${product.sku})\n${v.name}: ${v.text.slice(0, 500)}${p.photos.length ? `\n📷 фото: ${p.photos.length}` : ""}\nПроверить: админка → «Отзывы»`).catch(() => {});
  return { ok: true, kind: r.kind === "QUESTION" ? "question" : "review" };
}

export type PublicReview = {
  id: string; kind: "review" | "question"; rating: number | null; name: string; text: string; photos: string[]; answer: string | null;
  date: string; verified: boolean;
};

const photosOf = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && mediaFilePath(x) != null) : []);

/** Опубликованные отзывы и вопросы товара + средняя оценка. «Купував у нас» — если автор (кабинет) заказывал этот товар. */
export async function publishedReviews(productId: string, limit = 50) {
  const rows = await prisma.review.findMany({ where: { productId, status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, take: limit });
  const authors = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))];
  const buyers = new Set(
    authors.length
      ? (await prisma.order.findMany({
          where: { clientId: { in: authors }, isTest: false, status: { notIn: ["CANCELLED"] }, items: { some: { productId } } },
          select: { clientId: true },
        })).map((o) => o.clientId)
      : [],
  );
  const all = await prisma.review.findMany({ where: { productId, status: "PUBLISHED", kind: "REVIEW" }, select: { rating: true } });
  const items: PublicReview[] = rows.map((r) => ({
    id: r.id, kind: r.kind === "QUESTION" ? "question" : "review", rating: r.rating, name: r.name, text: r.text, photos: photosOf(r.photos),
    answer: r.answer, date: r.createdAt.toISOString(), verified: r.clientId != null && buyers.has(r.clientId),
  }));
  return { items, summary: ratingSummary(all.map((a) => a.rating ?? 0)) };
}

export type ReviewFilter = { status?: "PENDING" | "PUBLISHED" | "REJECTED"; kind?: "REVIEW" | "QUESTION"; page?: number };

export async function listReviewsAdmin(f: ReviewFilter) {
  const where: Prisma.ReviewWhereInput = { ...(f.status ? { status: f.status } : {}), ...(f.kind ? { kind: f.kind } : {}) };
  const perPage = 30;
  const page = Math.max(1, f.page ?? 1);
  const [total, rows, pending] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * perPage, take: perPage, include: { product: { select: { id: true, sku: true, nameUk: true } } } }),
    prisma.review.groupBy({ by: ["kind"], where: { status: "PENDING" }, _count: { _all: true } }),
  ]);
  return {
    total, page, pages: Math.max(1, Math.ceil(total / perPage)),
    rows: rows.map((r) => ({ ...r, photos: photosOf(r.photos) })),
    pending: { reviews: pending.find((p) => p.kind === "REVIEW")?._count._all ?? 0, questions: pending.find((p) => p.kind === "QUESTION")?._count._all ?? 0 },
  };
}

export async function pendingReviewsCount(): Promise<number> {
  return prisma.review.count({ where: { status: "PENDING" } });
}

export async function moderateReview(id: string, action: "publish" | "reject", who: string): Promise<void> {
  const status = action === "publish" ? "PUBLISHED" : "REJECTED";
  await prisma.review.update({ where: { id }, data: { status, moderatedBy: who, moderatedAt: new Date() } });
  await prisma.auditLog.create({ data: { who, action: `review.${action}`, details: json({ id }) } });
}

/**
 * Ответ магазина на отзыв/вопрос: сохраняется и публикуется вместе с ним (вопрос без ответа смысла не имеет).
 * Если автор вошёл в кабинет и подключил Telegram — ему приходит ответ в бота.
 */
export async function answerReview(id: string, rawAnswer: unknown, who: string, fetchImpl: typeof fetch = fetch): Promise<{ notified: boolean }> {
  const answer = String(rawAnswer ?? "").replace(/\r/g, "").trim().slice(0, 2000);
  const r = await prisma.review.findUnique({ where: { id }, include: { product: { select: { sku: true, nameUk: true, nameRu: true } } } });
  if (!r) throw new PlusUserError("Отзыв не найден.");
  const hadAnswer = Boolean(r.answer);
  await prisma.review.update({
    where: { id },
    data: { answer: answer || null, answeredBy: answer ? who : null, answeredAt: answer ? new Date() : null, ...(answer && r.status === "PENDING" ? { status: "PUBLISHED", moderatedBy: who, moderatedAt: new Date() } : {}) },
  });
  await prisma.auditLog.create({ data: { who, action: "review.answer", details: json({ id, answer: answer.slice(0, 200) }) } });
  if (!answer || hadAnswer || !r.clientId) return { notified: false };
  const c = await prisma.client.findUnique({ where: { id: r.clientId }, select: { tgId: true, tgStartedAt: true, lang: true } });
  if (!c?.tgId || !c.tgStartedAt) return { notified: false };
  const lang = r.lang === "RU" ? "ru" : "uk";
  const t = resolveTexts(await loadTextOverrides(), lang);
  const name = lang === "ru" && r.product.nameRu ? r.product.nameRu : r.product.nameUk;
  const text = fillText(t["bot.review.answer"], { name, answer, url: productUrl(r.product.sku, r.product.nameUk, lang) }).trim();
  const res = await notifyClient({ orderId: null, tgId: c.tgId, text, who }, fetchImpl);
  return { notified: res === "SENT" || res === "DEV" };
}

/** Удалить отзыв; его фото — если больше ни в одном отзыве не используются. */
export async function deleteReview(id: string, who: string): Promise<void> {
  const r = await prisma.review.delete({ where: { id } });
  await prisma.auditLog.create({ data: { who, action: "review.delete", details: json({ id, name: r.name, text: r.text.slice(0, 200) }) } });
  for (const url of photosOf(r.photos)) {
    const used = await prisma.review.count({ where: { photos: { array_contains: [url] } } });
    const file = mediaFilePath(url);
    if (!used && file) await unlink(/*turbopackIgnore: true*/ file).catch(() => {});
  }
}

// ================= «повідомити про зниження ціни / надходження» =================

async function productState(productId: string) {
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, nameUk: true, nameRu: true, price: true, visible: true, categoryId: true, supplierAvailable: true, stockItems: { select: { onHand: true, reserved: true } } },
  });
  if (!p) return null;
  return {
    ...p, price: p.price.toNumber(), visible: p.visible && !HIDDEN_CATEGORY_IDS.includes(p.categoryId),
    stock: stockLevel(availableQty(p.stockItems), p.supplierAvailable) as StockLevel,
  };
}

/** Подписаться (или обновить подписку: цена «от» — текущая). */
export async function subscribeWatch(clientId: string, productId: string, kind: WatchKind): Promise<{ ok: true; price: number; name: { uk: string; ru: string } } | { ok: false }> {
  const p = await productState(productId);
  if (!p || !p.visible) return { ok: false };
  await prisma.productWatch.upsert({
    where: { clientId_productId_kind: { clientId, productId, kind } },
    update: { basePrice: p.price, notifiedAt: null, createdAt: new Date() },
    create: { clientId, productId, kind, basePrice: p.price },
  });
  return { ok: true, price: p.price, name: { uk: p.nameUk, ru: p.nameRu } };
}

export async function unsubscribeWatch(clientId: string, productId: string, kind: WatchKind): Promise<void> {
  await prisma.productWatch.deleteMany({ where: { clientId, productId, kind } });
}

/** Активные подписки покупателя на этот товар. */
export async function watchesFor(clientId: string | null | undefined, productId: string): Promise<WatchKind[]> {
  if (!clientId) return [];
  return (await prisma.productWatch.findMany({ where: { clientId, productId, notifiedAt: null }, select: { kind: true } })).map((w) => w.kind);
}

/** Подписки покупателя (кабинет). */
export async function watchesOfClient(clientId: string) {
  const rows = await prisma.productWatch.findMany({
    where: { clientId, notifiedAt: null }, orderBy: { createdAt: "desc" }, take: 50,
    include: { product: { select: { id: true, sku: true, nameUk: true, nameRu: true, visible: true } } },
  });
  return rows.filter((r) => r.product.visible).map((r) => ({ id: r.id, kind: r.kind, basePrice: r.basePrice.toNumber(), product: r.product }));
}

/**
 * Фоновая проверка (раз в минуту из runJobs): цена ниже, чем при подписке / товар появился → сообщение в Telegram и подписка выполнена.
 * Покупателю без Telegram не пишем (подписка ждёт — он подключит бота). Отметка — до отправки, чтобы две копии сайта не написали дважды.
 */
export async function runWatches(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<number> {
  const rows = await prisma.productWatch.findMany({
    where: { notifiedAt: null, client: { tgId: { not: null }, tgStartedAt: { not: null } } },
    take: 500, orderBy: { createdAt: "asc" },
    include: { client: { select: { tgId: true, lang: true } } },
  });
  if (!rows.length) return 0;
  const ids = [...new Set(rows.map((r) => r.productId))];
  const states = new Map((await Promise.all(ids.map((id) => productState(id)))).filter((p) => p != null).map((p) => [p!.id, p!]));
  const overrides = await loadTextOverrides();
  const texts = { uk: resolveTexts(overrides, "uk"), ru: resolveTexts(overrides, "ru") };
  let sent = 0;
  for (const w of rows) {
    const p = states.get(w.productId);
    const base = w.basePrice.toNumber();
    if (!p || !watchDue(w.kind, base, p)) continue;
    const claim = await prisma.productWatch.updateMany({ where: { id: w.id, notifiedAt: null }, data: { notifiedAt: now } });
    if (!claim.count) continue;
    const lang = w.client.lang === "RU" ? "ru" : "uk";
    const t = texts[lang];
    const name = lang === "ru" && p.nameRu ? p.nameRu : p.nameUk;
    const url = productUrl(p.sku, p.nameUk, lang);
    const text = w.kind === "PRICE"
      ? fillText(t["bot.watch.price.done"], { name, old: money(base), price: money(p.price), url })
      : fillText(t["bot.watch.stock.done"], { name, price: money(p.price), url });
    await notifyClient({ orderId: null, tgId: w.client.tgId, text: text.trim(), who: "сайт: подписка" }, fetchImpl);
    sent++;
  }
  return sent;
}

// ================= «Передзвоніть мені» =================

/**
 * Заявка на звонок: задача «📞 Перезвонить» в разделе «Задачи» (срок — сейчас) и сообщение менеджерам.
 * Повтор с того же номера за 30 минут не создаёт новую задачу; больше 20 заявок за 10 минут со всего сайта — отказ (защита от потока).
 */
export async function requestCallback(raw: Record<string, unknown>, opts: { productId?: string | null; clientId?: string | null; lang: "uk" | "ru" }): Promise<{ ok: true; phone: string } | { ok: false; error: string }> {
  const check = validateCallback(raw);
  if (!check.ok) return check;
  const { phone, name, note } = check.value;
  const shown = formatPhone(phone);
  const now = Date.now();
  const dup = await prisma.task.findFirst({ where: { who: "сайт", done: false, title: { contains: shown }, createdAt: { gte: new Date(now - 30 * 60_000) } }, select: { id: true } });
  if (dup) return { ok: true, phone: shown };
  if ((await prisma.task.count({ where: { who: "сайт", createdAt: { gte: new Date(now - 10 * 60_000) } } })) >= 20) return { ok: false, error: "err.tooMany" };
  const product = opts.productId ? await prisma.product.findUnique({ where: { id: opts.productId }, select: { sku: true, nameUk: true } }) : null;
  const client = opts.clientId ? { id: opts.clientId } : await prisma.client.findUnique({ where: { phone }, select: { id: true } });
  const title = `📞 Перезвонить: ${name ? `${name}, ` : ""}${shown}${product ? ` — ${product.nameUk} (${product.sku})` : ""}${note ? ` · ${note}` : ""}${opts.lang === "ru" ? " · рус." : ""}`;
  // срок — сейчас, напоминание уже отправлено этим же сообщением (фоновые задачи не повторят)
  await prisma.task.create({ data: { title: title.slice(0, 300), dueAt: new Date(now), notifiedAt: new Date(now), who: "сайт", clientId: client?.id ?? null } });
  await notifyManagers(`📞 Просят перезвонить: ${name ? `${name}, ` : ""}${shown}${product ? `\nТовар: ${product.nameUk} (${product.sku})` : ""}${note ? `\n${note}` : ""}`).catch(() => {});
  return { ok: true, phone: shown };
}

// ================= опт и упаковка (админка, карточка товара) =================

const TIERS = ["START", "MASTER", "PRO", "LEGEND", "WHOLESALE"] as const;

export async function qtyRulesOf(productId: string) {
  const [breaks, packs] = await Promise.all([
    prisma.priceBreak.findMany({ where: { productId }, orderBy: [{ clientTier: "asc" }, { minQty: "asc" }] }),
    prisma.productPackaging.findMany({ where: { productId }, orderBy: { unitsPerPack: "asc" } }),
  ]);
  return {
    breaks: breaks.map((b) => ({ id: b.id, minQty: b.minQty, pricePerUnit: b.pricePerUnit.toNumber(), clientTier: b.clientTier })),
    packs: packs.map((p) => ({ id: p.id, unitLabel: p.unitLabel, unitsPerPack: p.unitsPerPack, packPrice: p.packPrice.toNumber() })),
  };
}

const posMoney = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
};
const posInt = (v: unknown, min: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= 100_000 ? n : null;
};

/** Оптовая цена: от N шт. — цена за штуку (для всех или только для уровня). Дороже обычной цены — ошибка (не сработает). */
export async function addPriceBreak(productId: string, raw: { minQty: unknown; price: unknown; tier: unknown }, who: string): Promise<void> {
  const minQty = posInt(raw.minQty, 2);
  const price = posMoney(raw.price);
  const tier = (TIERS as readonly string[]).includes(String(raw.tier)) ? (String(raw.tier) as (typeof TIERS)[number]) : null;
  if (!minQty) throw new PlusUserError("Количество — целое число от 2.");
  if (!price) throw new PlusUserError("Цена за штуку указана неверно.");
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { price: true } });
  if (!p) throw new PlusUserError("Товар не найден.");
  if (price >= p.price.toNumber()) throw new PlusUserError(`Оптовая цена должна быть ниже обычной (${money(p.price.toNumber())}).`);
  await prisma.priceBreak.deleteMany({ where: { productId, minQty, clientTier: tier } });
  await prisma.priceBreak.create({ data: { productId, minQty, pricePerUnit: price, clientTier: tier } });
  await prisma.auditLog.create({ data: { who, action: "product.qtyPrice.add", details: json({ productId, minQty, price, tier }) } });
}

/** Упаковка: N шт. за цену упаковки (например, «уп.» 10 шт. — 900 ₴). */
export async function addPackaging(productId: string, raw: { label: unknown; units: unknown; price: unknown }, who: string): Promise<void> {
  const units = posInt(raw.units, 2);
  const price = posMoney(raw.price);
  const label = String(raw.label ?? "").replace(/\s+/g, " ").trim().slice(0, 20) || "уп.";
  if (!units) throw new PlusUserError("Штук в упаковке — целое число от 2.");
  if (!price) throw new PlusUserError("Цена упаковки указана неверно.");
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { price: true } });
  if (!p) throw new PlusUserError("Товар не найден.");
  if (price / units >= p.price.toNumber()) throw new PlusUserError(`За штуку в упаковке выходит ${money(price / units)} — не дешевле обычной цены (${money(p.price.toNumber())}).`);
  await prisma.productPackaging.deleteMany({ where: { productId, unitsPerPack: units } });
  await prisma.productPackaging.create({ data: { productId, unitLabel: label, unitsPerPack: units, packPrice: price } });
  await prisma.auditLog.create({ data: { who, action: "product.pack.add", details: json({ productId, label, units, price }) } });
}

export async function deleteQtyRule(kind: "break" | "pack", id: string, who: string): Promise<void> {
  if (kind === "break") await prisma.priceBreak.deleteMany({ where: { id } });
  else await prisma.productPackaging.deleteMany({ where: { id } });
  await prisma.auditLog.create({ data: { who, action: `product.${kind}.delete`, details: json({ id }) } });
}
