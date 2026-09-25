"use server";

import { redirect } from "next/navigation";
import { prisma } from "@handyman/db";
import { acceptSupplierPrice, moveProductsToCategory, ProductUserError, setProductFlag, unlockField, updateProductManual } from "@handyman/db/catalog-products";
import { reindexProducts, reindexSafely } from "@handyman/db/catalog-search";
import { setStockLevels, stockByWarehouse } from "@handyman/db/warehouses";
import { requirePermission } from "@/lib/auth";
import { parseMoney } from "@/lib/catalog";
import { catalogChanged } from "@/lib/shop/cache";

const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

async function run(page: string, fn: () => Promise<string>): Promise<never> {
  let message: string;
  let kind: "ok" | "error" = "ok";
  try {
    message = await fn();
    catalogChanged(); // видимость, категория, остатки — счётчики разделов на сайте
  } catch (e) {
    kind = "error";
    message = e instanceof ProductUserError ? e.message : `Непредвиденная ошибка: ${e instanceof Error ? e.message : String(e)}`;
    if (!(e instanceof ProductUserError)) console.error("[products]", e);
  }
  redirect(withParam(page, kind, message));
}

export async function saveProductAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  const canEditPrices = (session.permissions as string[]).includes("prices.edit");
  return run(`/admin/products/${id}`, async () => {
    const price = canEditPrices ? parseMoney(formData.get("price")) : undefined;
    const oldPrice = canEditPrices ? parseMoney(formData.get("oldPrice")) : undefined;
    if (price !== undefined && (price === null || Number.isNaN(price))) throw new ProductUserError("Цена указана неверно.");
    if (oldPrice !== undefined && oldPrice !== null && Number.isNaN(oldPrice)) throw new ProductUserError("Старая цена указана неверно.");
    // Без права prices.edit поля цен на форме недоступны: подставляем текущие значения.
    const purchase = canEditPrices ? parseMoney(formData.get("purchasePrice")) : undefined;
    if (purchase !== undefined && purchase !== null && Number.isNaN(purchase)) throw new ProductUserError("Закупочная цена указана неверно.");
    const cur = await prisma.product.findUnique({ where: { id }, select: { price: true, oldPrice: true, purchasePrice: true } });
    if (!cur) throw new ProductUserError("Товар не найден.");
    const changed = await updateProductManual(
      id,
      {
        nameUk: String(formData.get("nameUk") ?? ""),
        nameRu: String(formData.get("nameRu") ?? ""),
        descUk: String(formData.get("descUk") ?? "") || null,
        descRu: String(formData.get("descRu") ?? "") || null,
        price: price ?? cur.price.toNumber(),
        oldPrice: oldPrice === undefined ? (cur.oldPrice?.toNumber() ?? null) : oldPrice,
        purchasePrice: purchase === undefined ? (cur.purchasePrice?.toNumber() ?? null) : purchase,
        visible: formData.get("visible") === "on",
        categoryId: String(formData.get("categoryId") ?? ""),
        brandId: String(formData.get("brandId") ?? "") || null,
      },
      { who: session.username, canEditPrices },
    );
    if (changed.length) await reindexSafely(() => reindexProducts([id]));
    // закупочная цена импортом не меняется, поэтому в «защищённые» поля не входит
    const locked = changed.filter((f) => f !== "purchasePrice").length;
    if (!changed.length) return "Изменений нет.";
    return locked ? `Сохранено. Изменённые поля теперь защищены от перезаписи импортом (${locked}).` : "Сохранено.";
  });
}

/** Перенести отмеченные в списке товары в выбранную категорию. */
export async function moveProductsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.edit");
  const back = String(formData.get("back") ?? "/admin/products");
  const safeBack = back.startsWith("/admin/products") ? back : "/admin/products";
  return run(safeBack, async () => {
    const ids = formData.getAll("ids").map(String);
    const categoryId = String(formData.get("categoryId") ?? "");
    if (!categoryId) throw new ProductUserError("Выберите категорию, в которую переносить.");
    const moved = await moveProductsToCategory(ids, categoryId, session.username);
    if (moved) await reindexSafely(() => reindexProducts(ids));
    return moved ? `Перенесено товаров: ${moved}.` : "Эти товары уже в выбранной категории.";
  });
}

export async function acceptPriceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("prices.edit");
  const id = String(formData.get("id"));
  return run(`/admin/products/${id}`, async () => {
    await acceptSupplierPrice(id, session.username);
    await reindexSafely(() => reindexProducts([id]));
    return "Цена поставщика принята, защита цены снята.";
  });
}

export async function unlockFieldAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  return run(`/admin/products/${id}`, async () => {
    await unlockField(id, String(formData.get("field")), session.username);
    return "Защита снята: при следующем импорте поле возьмётся из фида.";
  });
}

/** Остаток на нашем складе в Одессе: товар с остатком > 0 на сайте — «В наявності в Одесі» и выше в списках. */
export async function setOwnStockAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  return run(`/admin/products/${id}`, async () => {
    // поля stock.<код точки>: остаток в каждом магазине/складе
    const levels: Array<{ warehouseId: string; qty: number }> = [];
    for (const [k, v] of formData.entries()) {
      if (!k.startsWith("stock.") || typeof v !== "string") continue;
      const raw = v.replace(/\s/g, "");
      const qty = Number(raw);
      if (!/^\d+$/.test(raw) || qty > 100_000) throw new ProductUserError("Остаток — целое число штук от 0 до 100 000.");
      levels.push({ warehouseId: k.slice(6), qty });
    }
    const known = new Set((await stockByWarehouse(id)).map((w) => w.id));
    if (!levels.length || levels.some((l) => !known.has(l.warehouseId))) throw new ProductUserError("Склад не найден — обновите страницу.");
    await setStockLevels(id, levels, session.username);
    const total = levels.reduce((a, l) => a + l.qty, 0);
    return total > 0 ? `Остаток сохранён: всего ${total} шт. — на сайте «В наявності».` : "Остаток обнулён.";
  });
}

/** «Хит» / «Новинка» в карточке товара (две галочки). */
export async function setFlagsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  return run(`/admin/products/${id}`, async () => {
    const changed = [
      ...(await setProductFlag([id], "isHit", formData.get("isHit") === "on", session.username)),
      ...(await setProductFlag([id], "isNew", formData.get("isNew") === "on", session.username)),
    ];
    if (changed.length) await reindexSafely(() => reindexProducts([id]));
    return changed.length ? "Отметки сохранены — на сайте уже видно." : "Ничего не изменилось.";
  });
}

/** Массово из списка товаров: у каждой кнопки своё mark = hit:on | hit:off | new:on | new:off (привязано через bind). */
export async function markProductsAction(mark: string, formData: FormData): Promise<void> {
  const session = await requirePermission("products.edit");
  const back = String(formData.get("back") || "/admin/products");
  const ids = formData.getAll("ids").map(String);
  const [what, value] = String(mark ?? "").split(":");
  return run(back, async () => {
    if (what !== "hit" && what !== "new") throw new ProductUserError("Непонятная кнопка.");
    const changed = await setProductFlag(ids, what === "hit" ? "isHit" : "isNew", value === "on", session.username);
    if (changed.length) await reindexSafely(() => reindexProducts(changed));
    const name = what === "hit" ? "«Хит»" : "«Новинка»";
    return value === "on" ? `Отметка ${name} поставлена: ${changed.length} шт.` : `Отметка ${name} снята: ${changed.length} шт.`;
  });
}
