// Ручная правка товаров: защита правленых полей от импорта, история цен, расхождения с ценой поставщика.
// Правила: docs/CATALOG-IMPORT.md, раздел «Ручные правки».

import { prisma, Prisma } from "./client";
import { LOCKABLE_FIELDS, sanitizeHtml, type LockableField } from "@handyman/core/catalog";

export class ProductUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductUserError";
  }
}

export type ProductEditInput = {
  nameUk: string;
  nameRu: string;
  descUk: string | null;
  descRu: string | null;
  price: number;
  oldPrice: number | null;
  /** Закупочная цена (наша). Импорт её не меняет; вводится вручную. */
  purchasePrice: number | null;
  visible: boolean;
  categoryId: string;
  brandId: string | null;
};

export type EditOptions = {
  who: string;
  /** Право prices.edit: без него цены менять нельзя. */
  canEditPrices: boolean;
};

const same = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 0.005);

/** Сохраняет ручную правку. Изменённые поля автоматически защищаются от перезаписи импортом. Возвращает список изменённых полей. */
export async function updateProductManual(productId: string, input: ProductEditInput, opts: EditOptions): Promise<string[]> {
  const nameUk = input.nameUk.trim();
  const nameRu = input.nameRu.trim();
  if (nameUk.length < 2) throw new ProductUserError("Название (укр.) не может быть пустым.");
  if (nameRu.length < 2) throw new ProductUserError("Название (рус.) не может быть пустым.");
  if (!Number.isFinite(input.price) || input.price <= 0) throw new ProductUserError("Цена должна быть больше нуля.");
  if (input.oldPrice != null && (!Number.isFinite(input.oldPrice) || input.oldPrice <= input.price)) {
    throw new ProductUserError("Старая цена должна быть больше текущей (или оставьте её пустой).");
  }
  if (input.purchasePrice != null && (!Number.isFinite(input.purchasePrice) || input.purchasePrice <= 0)) {
    throw new ProductUserError("Закупочная цена должна быть больше нуля (или оставьте её пустой).");
  }
  const price = Math.round(input.price * 100) / 100;
  const oldPrice = input.oldPrice == null ? null : Math.round(input.oldPrice * 100) / 100;
  const purchasePrice = input.purchasePrice == null ? null : Math.round(input.purchasePrice * 100) / 100;

  const cur = await prisma.product.findUnique({ where: { id: productId } });
  if (!cur) throw new ProductUserError("Товар не найден.");
  const cat = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
  if (!cat) throw new ProductUserError("Такой категории нет.");
  if (input.brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: input.brandId }, select: { id: true } });
    if (!brand) throw new ProductUserError("Такого бренда нет.");
  }

  // Описание — HTML, который потом показывается на сайте: пропускаем через ту же очистку, что и описания из фида.
  const descUk = sanitizeHtml(input.descUk) || null;
  const descRu = sanitizeHtml(input.descRu) || null;
  const changed = new Set<LockableField>();
  if (nameUk !== cur.nameUk) changed.add("nameUk");
  if (nameRu !== cur.nameRu) changed.add("nameRu");
  if (descUk !== cur.descUk) changed.add("descUk");
  if (descRu !== cur.descRu) changed.add("descRu");
  if (!same(price, cur.price.toNumber())) changed.add("price");
  if (!same(oldPrice, cur.oldPrice?.toNumber() ?? null)) changed.add("oldPrice");
  if (input.visible !== cur.visible) changed.add("visible");
  if (input.categoryId !== cur.categoryId) changed.add("categoryId");
  if ((input.brandId ?? null) !== cur.brandId) changed.add("brandId");
  // Закупочную цену импорт не трогает, поэтому защита (замок) ей не нужна.
  const purchaseChanged = !same(purchasePrice, cur.purchasePrice?.toNumber() ?? null);

  if (!opts.canEditPrices && (changed.has("price") || changed.has("oldPrice") || purchaseChanged)) {
    throw new ProductUserError("У вашей роли нет права менять цены.");
  }
  if (!changed.size && !purchaseChanged) return [];

  // Расхождение = цена защищена вручную и отличается от цены поставщика.
  const supplierPrice = cur.supplierPrice?.toNumber() ?? null;
  const priceLocked = changed.has("price") || (await prisma.productFieldLock.count({ where: { productId, fieldName: "price" } })) > 0;
  const priceConflict = priceLocked && supplierPrice != null && !same(price, supplierPrice);
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.product.update({
      where: { id: productId },
      data: { nameUk, nameRu, descUk, descRu, price, oldPrice, purchasePrice, visible: input.visible, categoryId: input.categoryId, brandId: input.brandId ?? null, priceConflict },
    }),
    prisma.auditLog.create({
      data: { who: opts.who, action: "product.edit", target: cur.sku, details: { fields: [...changed, ...(purchaseChanged ? ["purchasePrice"] : [])] } },
    }),
  ];
  for (const field of changed) {
    ops.push(
      prisma.productFieldLock.upsert({
        where: { productId_fieldName: { productId, fieldName: field } },
        update: { lockedBy: opts.who, lockedAt: new Date() },
        create: { productId, fieldName: field, lockedBy: opts.who },
      }),
    );
  }
  if (changed.has("price")) {
    ops.push(prisma.priceLog.create({ data: { productId, oldPrice: cur.price, newPrice: price, source: "MANUAL", who: opts.who } }));
  }
  await prisma.$transaction(ops);
  return [...changed, ...(purchaseChanged ? (["purchasePrice"] as const) : [])];
}

/** Перенести несколько товаров в другую категорию (например, из «Нераспределённых»). Категория защищается от импорта. */
export async function moveProductsToCategory(productIds: string[], categoryId: string, who: string): Promise<number> {
  const ids = [...new Set(productIds)].filter(Boolean);
  if (!ids.length) throw new ProductUserError("Не выбрано ни одного товара.");
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, nameUk: true } });
  if (!cat) throw new ProductUserError("Такой категории нет.");
  const found = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, categoryId: true } });
  const toMove = found.filter((p) => p.categoryId !== categoryId);
  if (!toMove.length) return 0;
  await prisma.$transaction([
    prisma.product.updateMany({ where: { id: { in: toMove.map((p) => p.id) } }, data: { categoryId } }),
    ...toMove.map((p) =>
      prisma.productFieldLock.upsert({
        where: { productId_fieldName: { productId: p.id, fieldName: "categoryId" } },
        update: { lockedBy: who, lockedAt: new Date() },
        create: { productId: p.id, fieldName: "categoryId", lockedBy: who },
      }),
    ),
    prisma.auditLog.create({ data: { who, action: "product.move", target: categoryId, details: { count: toMove.length, skus: toMove.slice(0, 50).map((p) => p.sku) } } }),
  ]);
  return toMove.length;
}

/** Принять цену поставщика вместо ручной: цена = цене поставщика, защита цены снимается. */
export async function acceptSupplierPrice(productId: string, who: string): Promise<void> {
  const cur = await prisma.product.findUnique({ where: { id: productId } });
  if (!cur) throw new ProductUserError("Товар не найден.");
  if (cur.supplierPrice == null) throw new ProductUserError("У этого товара нет цены поставщика.");
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.product.update({ where: { id: productId }, data: { price: cur.supplierPrice, priceConflict: false } }),
    prisma.productFieldLock.deleteMany({ where: { productId, fieldName: "price" } }),
    prisma.auditLog.create({ data: { who, action: "product.accept-supplier-price", target: cur.sku, details: { from: cur.price.toNumber(), to: cur.supplierPrice.toNumber() } } }),
  ];
  if (!same(cur.price.toNumber(), cur.supplierPrice.toNumber())) {
    ops.push(prisma.priceLog.create({ data: { productId, oldPrice: cur.price, newPrice: cur.supplierPrice, source: "SUPPLIER", who } }));
  }
  await prisma.$transaction(ops);
}

/** Снять защиту с поля: при следующем импорте оно снова возьмётся из фида. */
export async function unlockField(productId: string, field: string, who: string): Promise<void> {
  if (!(LOCKABLE_FIELDS as readonly string[]).includes(field)) throw new ProductUserError("Неизвестное поле.");
  const cur = await prisma.product.findUnique({ where: { id: productId }, select: { sku: true } });
  if (!cur) throw new ProductUserError("Товар не найден.");
  await prisma.$transaction([
    prisma.productFieldLock.deleteMany({ where: { productId, fieldName: field } }),
    prisma.auditLog.create({ data: { who, action: "product.unlock", target: cur.sku, details: { field } } }),
  ]);
}
