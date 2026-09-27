// Кабинет покупателя (Этап 5, шаг 5.5): общая корзина сайт ↔ Mini App, «Обране», «Мій інструмент».
// Всё только для вошедшего покупателя (clientId из его сессии); у гостя корзина и избранное живут в браузере.
import { UNSORTED_ID, extractFacets } from "@handyman/core/catalog";
import { MAX_FAVORITES, MAX_TOOLS, cleanCart, isToolCategory, mergeCartSync, type CartLineInput } from "@handyman/core/shop";
import { prisma, type Prisma } from "./client";
import { photoStyleOn, pickImage } from "./photo-choice";

// ---------- общая корзина ----------

export type SyncedCart = { lines: CartLineInput[]; version: number };

export async function getCart(clientId: string): Promise<SyncedCart> {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { cart: true, cartVersion: true } });
  return { lines: cleanCart(c?.cart ?? []), version: c?.cartVersion ?? 0 };
}

/**
 * Встреча корзины браузера с корзиной на сервере (правило — mergeCartSync). Строка клиента блокируется на время записи,
 * чтобы сайт и Mini App, открытые одновременно, не затёрли друг друга.
 */
export async function syncCart(clientId: string, input: { local: unknown; baseVersion: unknown; dirty: unknown }): Promise<SyncedCart | null> {
  const baseVersion = Number.isInteger(input.baseVersion) && (input.baseVersion as number) >= 0 ? (input.baseVersion as number) : 0;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ cart: unknown; cartVersion: number }>>`SELECT "cart", "cartVersion" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`;
    if (!rows.length) return null;
    const server = cleanCart(rows[0].cart ?? []);
    const r = mergeCartSync({ server, serverVersion: rows[0].cartVersion, local: cleanCart(input.local), baseVersion, dirty: input.dirty === true });
    if (!r.save) return { lines: r.lines, version: rows[0].cartVersion };
    const saved = await tx.client.update({
      where: { id: clientId },
      data: { cart: r.lines as unknown as Prisma.InputJsonValue, cartVersion: { increment: 1 }, cartUpdatedAt: new Date() },
      select: { cartVersion: true },
    });
    return { lines: r.lines, version: saved.cartVersion };
  });
}

// ---------- «Обране» ----------

const shopVisible = { visible: true, categoryId: { not: UNSORTED_ID } } satisfies Prisma.ProductWhereInput;

/** Артикулы избранного, новые сверху (скрытые товары не показываются, но и не удаляются — вдруг вернутся). */
export async function favoriteSkus(clientId: string): Promise<string[]> {
  const rows = await prisma.clientFavorite.findMany({
    where: { clientId, product: shopVisible }, orderBy: { createdAt: "desc" }, take: MAX_FAVORITES, select: { product: { select: { sku: true } } },
  });
  return rows.map((r) => r.product.sku);
}

/** Добавить/убрать из избранного. false — нет такого товара или список переполнен. */
export async function setFavorite(clientId: string, sku: string, on: boolean): Promise<boolean> {
  const p = await prisma.product.findUnique({ where: { sku: String(sku).slice(0, 40) }, select: { id: true } });
  if (!p) return false;
  if (!on) {
    await prisma.clientFavorite.deleteMany({ where: { clientId, productId: p.id } });
    return true;
  }
  if ((await prisma.clientFavorite.count({ where: { clientId } })) >= MAX_FAVORITES) return false;
  await prisma.clientFavorite.createMany({ data: [{ clientId, productId: p.id }], skipDuplicates: true });
  return true;
}

/** При входе: избранное гостя из браузера переносится в кабинет; ответ — полный список. */
export async function mergeFavorites(clientId: string, skus: unknown): Promise<string[]> {
  const list = Array.isArray(skus) ? [...new Set(skus.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 40))].slice(0, MAX_FAVORITES) : [];
  if (list.length) {
    const have = await prisma.clientFavorite.count({ where: { clientId } });
    const products = await prisma.product.findMany({ where: { sku: { in: list } }, select: { id: true } });
    const data = products.slice(0, Math.max(0, MAX_FAVORITES - have)).map((p) => ({ clientId, productId: p.id }));
    if (data.length) await prisma.clientFavorite.createMany({ data, skipDuplicates: true });
  }
  return favoriteSkus(clientId);
}

// ---------- «Мій інструмент» ----------

export type MyTool = {
  sku: string; nameUk: string; nameRu: string; categoryId: string; image: string | null; source: "manual" | "order"; facets: Record<string, string[]>;
};

const OWNED_STATUSES = ["SHIPPED", "DONE"] as const;

/** Инструмент из полученных заказов попадает в список сам (кроме тех, что покупатель убрал). */
export async function syncOrderTools(clientId: string): Promise<number> {
  const items = await prisma.orderItem.findMany({
    where: { order: { clientId, isTest: false, status: { in: [...OWNED_STATUSES] } }, productId: { not: null } },
    select: { productId: true, product: { select: { categoryId: true } } },
  });
  const ids = [...new Set(items.filter((i) => i.product && isToolCategory(i.product.categoryId)).map((i) => i.productId as string))].slice(0, MAX_TOOLS);
  if (!ids.length) return 0;
  const r = await prisma.clientTool.createMany({ data: ids.map((productId) => ({ clientId, productId, source: "order" })), skipDuplicates: true });
  return r.count;
}

export async function listTools(clientId: string): Promise<MyTool[]> {
  await syncOrderTools(clientId);
  const [rows, styleOn] = await Promise.all([
    prisma.clientTool.findMany({
      where: { clientId, hidden: false, product: shopVisible },
      orderBy: { createdAt: "desc" },
      take: MAX_TOOLS,
      select: {
        source: true,
        product: {
          select: {
            sku: true, nameUk: true, nameRu: true, categoryId: true,
            attributes: { select: { key: true, value: true } },
            images: { take: 1, orderBy: { sort: "asc" }, select: { url: true, localUrl: true, styledUrl: true } },
            category: { select: { nameUk: true, parent: { select: { nameUk: true, parent: { select: { nameUk: true } } } } } },
          },
        },
      },
    }),
    photoStyleOn(),
  ]);
  return rows.map(({ source, product: p }) => {
    const chain = [p.category.parent?.parent?.nameUk, p.category.parent?.nameUk, p.category.nameUk].filter((x): x is string => Boolean(x));
    return {
      sku: p.sku, nameUk: p.nameUk, nameRu: p.nameRu, categoryId: p.categoryId, source: source === "order" ? "order" : "manual",
      image: p.images[0] ? pickImage(p.images[0], styleOn) : null,
      facets: extractFacets(p.attributes.map((a) => ({ name: a.key, value: a.value })), chain),
    };
  });
}

/** Отметка на странице товара: «Це мій інструмент». false — не инструмент, нет товара или список полон. */
export async function setTool(clientId: string, sku: string, on: boolean): Promise<boolean> {
  const p = await prisma.product.findUnique({ where: { sku: String(sku).slice(0, 40) }, select: { id: true, categoryId: true } });
  if (!p || !isToolCategory(p.categoryId)) return false;
  if (!on) {
    await prisma.clientTool.updateMany({ where: { clientId, productId: p.id }, data: { hidden: true } });
    return true;
  }
  const existing = await prisma.clientTool.findUnique({ where: { clientId_productId: { clientId, productId: p.id } }, select: { id: true } });
  if (existing) {
    await prisma.clientTool.update({ where: { id: existing.id }, data: { hidden: false } });
    return true;
  }
  if ((await prisma.clientTool.count({ where: { clientId, hidden: false } })) >= MAX_TOOLS) return false;
  await prisma.clientTool.create({ data: { clientId, productId: p.id, source: "manual" } });
  return true;
}

export async function isMyTool(clientId: string, productId: string): Promise<boolean> {
  return (await prisma.clientTool.count({ where: { clientId, productId, hidden: false } })) > 0;
}

// ---------- слияние двух карточек одного человека ----------

/** Перенести избранное, инструменты и корзину из карточки-дубля (вызывается внутри транзакции слияния). */
export async function moveCabinet(tx: Prisma.TransactionClient, fromId: string, toId: string): Promise<void> {
  const favs = await tx.clientFavorite.findMany({ where: { clientId: fromId }, select: { productId: true, createdAt: true } });
  if (favs.length) await tx.clientFavorite.createMany({ data: favs.map((f) => ({ ...f, clientId: toId })), skipDuplicates: true });
  const tools = await tx.clientTool.findMany({ where: { clientId: fromId }, select: { productId: true, source: true, hidden: true, createdAt: true } });
  if (tools.length) await tx.clientTool.createMany({ data: tools.map((t) => ({ ...t, clientId: toId })), skipDuplicates: true });
  const [from, to] = await Promise.all([
    tx.client.findUnique({ where: { id: fromId }, select: { cart: true } }),
    tx.client.findUnique({ where: { id: toId }, select: { cart: true } }),
  ]);
  const fromCart = cleanCart(from?.cart ?? []);
  if (fromCart.length) {
    const merged = mergeCartSync({ server: cleanCart(to?.cart ?? []), serverVersion: 1, local: fromCart, baseVersion: 0, dirty: true });
    await tx.client.update({ where: { id: toId }, data: { cart: merged.lines as unknown as Prisma.InputJsonValue, cartVersion: { increment: 1 }, cartUpdatedAt: new Date() } });
  }
}
