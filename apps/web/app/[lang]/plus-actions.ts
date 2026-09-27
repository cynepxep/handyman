"use server";

// «Витрина+» (шаг 5.6): действия, которые вызывает браузер — отзыв/вопрос с фото, подписка «повідомити», «Передзвоніть мені», сравнение.
// Из браузера приходят только введённые данные и коды товаров; цены, наличие и характеристики сервер берёт сам.
import { headers } from "next/headers";
import { prisma } from "@handyman/db";
import {
  COMPARE_MAX, REVIEW_MAX_PHOTOS, REVIEW_MAX_PHOTO_BYTES, availableQty, cleanSkuList, compareRows, stockLevel, validateReview, type CompareRow, type StockLevel,
} from "@handyman/core/shop";
import { HIDDEN_CATEGORY_IDS } from "@handyman/core/catalog";
import { isShopLang, paths, shopHref, type ShopLang } from "@handyman/core/site";
import { PlusUserError, createReview, requestCallback, saveReviewPhoto, subscribeWatch, unsubscribeWatch } from "@handyman/db/storefront-plus";
import { photoStyleOn, pickImage } from "@handyman/db/photo-choice";
import { getShopContent } from "@/lib/shop/content";
import { getClient } from "@/lib/client-auth";

const langOf = (l: unknown): ShopLang => (isShopLang(l) ? l : "uk");
const ID = /^[a-z0-9]{8,40}$/;

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

// ---------- отзыв / вопрос ----------

export type ReviewResult = { ok: true; message: string } | { ok: false; message: string };

export async function reviewAction(lang: unknown, form: FormData): Promise<ReviewResult> {
  const l = langOf(lang);
  const { t } = await getShopContent(l);
  if (String(form.get("website") ?? "").trim()) return { ok: false, message: t("err.server") };
  const productId = String(form.get("productId") ?? "");
  if (!ID.test(productId)) return { ok: false, message: t("err.server") };
  const raw = { kind: form.get("kind"), name: form.get("name"), text: form.get("text"), rating: form.get("rating") };
  const pre = validateReview(raw);
  if (!pre.ok) return { ok: false, message: t(pre.error) };
  // фото — только у отзыва; проверяем количество и размер до обработки
  const files = pre.value.kind === "review" ? form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0) : [];
  const photoErr = t("review.err.photo", { n: REVIEW_MAX_PHOTOS });
  if (files.length > REVIEW_MAX_PHOTOS || files.some((f) => f.size > REVIEW_MAX_PHOTO_BYTES)) return { ok: false, message: photoErr };
  try {
    const photos: string[] = [];
    for (const f of files) photos.push(await saveReviewPhoto(Buffer.from(await f.arrayBuffer())));
    const client = await getClient();
    const r = await createReview({ productId, raw, photos, clientId: client?.id ?? null, lang: l, ip: await clientIp() });
    if (!r.ok) return { ok: false, message: t(r.error) };
    return { ok: true, message: t(r.kind === "question" ? "questions.form.done" : "reviews.form.done") };
  } catch (e) {
    if (e instanceof PlusUserError) return { ok: false, message: photoErr };
    console.error("[reviews] не сохранён", e);
    return { ok: false, message: t("err.server") };
  }
}

// ---------- «повідомити про зниження ціни / надходження» ----------

/** Вошёл через Telegram — подписываем сразу; иначе браузер открывает бота (ссылка t.me/…?start=wp_<товар>). */
export async function watchAction(productId: unknown, kind: unknown, on: unknown): Promise<{ ok: boolean; on: boolean }> {
  const id = String(productId ?? "");
  const k = kind === "STOCK" ? "STOCK" : "PRICE";
  const client = await getClient();
  if (!client?.tgId || !ID.test(id)) return { ok: false, on: false };
  if (on === true) {
    const r = await subscribeWatch(client.id, id, k);
    return { ok: r.ok, on: r.ok };
  }
  await unsubscribeWatch(client.id, id, k);
  return { ok: true, on: false };
}

// ---------- «Передзвоніть мені» ----------

const cbHits = new Map<string, number[]>();

export async function callbackAction(lang: unknown, form: { phone?: unknown; name?: unknown; productId?: unknown; website?: unknown }): Promise<{ ok: boolean; message: string }> {
  const l = langOf(lang);
  const { t } = await getShopContent(l);
  if (typeof form?.website === "string" && form.website.trim()) return { ok: false, message: t("err.server") };
  // не больше 3 заявок за 10 минут с одного адреса (в памяти сервера)
  const ip = await clientIp();
  const now = Date.now();
  const list = (cbHits.get(ip) ?? []).filter((ts) => now - ts < 10 * 60_000);
  if (list.length >= 3) return { ok: false, message: t("err.tooMany") };
  list.push(now);
  cbHits.set(ip, list);
  if (cbHits.size > 5000) cbHits.clear();
  try {
    const client = await getClient();
    const productId = typeof form.productId === "string" && ID.test(form.productId) ? form.productId : null;
    const r = await requestCallback({ phone: form.phone, name: form.name }, { productId, clientId: client?.id ?? null, lang: l });
    return r.ok ? { ok: true, message: t("callback.done", { phone: r.phone }) } : { ok: false, message: t(r.error) };
  } catch (e) {
    console.error("[callback] заявка не сохранена", e);
    return { ok: false, message: t("err.server") };
  }
}

// ---------- сравнение ----------

export type CompareItem = { sku: string; name: string; href: string; image: string | null; price: number; oldPrice: number | null; stock: StockLevel; brand: string | null };
export type CompareData = { items: CompareItem[]; rows: CompareRow[]; missing: string[] };

/** Товары для сравнения (до 4) с характеристиками. Скрытых/удалённых нет — они в `missing` (браузер уберёт их из списка). */
export async function compareAction(lang: unknown, skus: unknown): Promise<CompareData> {
  const l = langOf(lang);
  const list = cleanSkuList(skus, COMPARE_MAX);
  if (!list.length) return { items: [], rows: [], missing: [] };
  const [rows, styleOn] = await Promise.all([
    prisma.product.findMany({
      where: { sku: { in: list }, visible: true, categoryId: { notIn: HIDDEN_CATEGORY_IDS } },
      select: {
        sku: true, nameUk: true, nameRu: true, price: true, oldPrice: true, supplierAvailable: true, brand: { select: { name: true } },
        images: { take: 1, orderBy: { sort: "asc" }, select: { url: true, localUrl: true, styledUrl: true } },
        attributes: { orderBy: { sort: "asc" }, select: { key: true, value: true } },
        stockItems: { select: { onHand: true, reserved: true } },
      },
    }),
    photoStyleOn(),
  ]);
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const found = list.map((s) => bySku.get(s)).filter((r) => r != null);
  const items: CompareItem[] = found.map((r) => {
    const price = r.price.toNumber();
    const old = r.oldPrice?.toNumber() ?? null;
    return {
      sku: r.sku, name: l === "ru" && r.nameRu ? r.nameRu : r.nameUk, href: shopHref(l, paths.product(r.sku, r.nameUk)),
      image: r.images[0] ? pickImage(r.images[0], styleOn) : null, price, oldPrice: old && old > price ? old : null,
      stock: stockLevel(availableQty(r.stockItems), r.supplierAvailable), brand: r.brand?.name ?? null,
    };
  });
  return {
    items,
    rows: compareRows(found.map((r) => ({ attributes: r.attributes.map((a) => ({ name: a.key, value: a.value })) }))),
    missing: list.filter((s) => !bySku.has(s)),
  };
}
