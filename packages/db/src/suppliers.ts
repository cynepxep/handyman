// «Поставщики и бренды» (/admin/suppliers): поставщики (у каждого свой фид, наценка, бренд по умолчанию), бренды и связи между ними.
// Связь многие ко многим (SupplierBrand): у поставщика несколько брендов, у бренда может быть несколько поставщиков.
// После переименования/объединения брендов вызывающий пересобирает поиск для затронутых товаров (reindexProducts).

import fs from "node:fs/promises";
import { prisma } from "./client";

export class SupplierUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierUserError";
  }
}

const clean = (s: string | null | undefined, max = 200) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ---------- поставщики ----------

export async function listSuppliers() {
  const rows = await prisma.supplier.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: {
      brands: { include: { brand: { select: { id: true, name: true } } } },
      _count: { select: { products: true } },
      importRuns: { where: { status: "DONE", undoneAt: null }, orderBy: { startedAt: "desc" }, take: 1, select: { id: true, startedAt: true } },
    },
  });
  return rows.map((s) => ({
    id: s.id, name: s.name, active: s.active, feedUrl: s.feedUrl, markupPct: s.markupPct, defaultBrand: s.defaultBrand, contact: s.contact, note: s.note,
    products: s._count.products,
    brands: s.brands.map((b) => b.brand).sort((a, b) => a.name.localeCompare(b.name)),
    lastImport: s.importRuns[0] ?? null,
  }));
}

export type SupplierInput = {
  name: string;
  contact?: string | null;
  note?: string | null;
  feedUrl?: string | null;
  defaultBrand?: string | null;
  markupPct?: number | null;
  active?: boolean;
};

function checkSupplier(input: SupplierInput) {
  const name = clean(input.name, 80);
  if (name.length < 2) throw new SupplierUserError("Укажите название поставщика.");
  const feedUrl = clean(input.feedUrl, 1000) || null;
  if (feedUrl && !/^https?:\/\//i.test(feedUrl)) throw new SupplierUserError("Ссылка на фид должна начинаться с http:// или https://");
  const m = input.markupPct;
  if (m != null && (!Number.isFinite(m) || m < -90 || m > 300)) throw new SupplierUserError("Наценка должна быть числом от -90 до 300 (или пустой, если наценки нет).");
  return {
    name, feedUrl, markupPct: m ?? null,
    contact: clean(input.contact, 300) || null,
    note: clean(input.note, 1000) || null,
    defaultBrand: clean(input.defaultBrand, 80) || null,
    active: input.active ?? true,
  };
}

async function nameTaken(name: string, exceptId?: string) {
  const other = await prisma.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  return !!other;
}

export async function createSupplier(input: SupplierInput): Promise<string> {
  const data = checkSupplier(input);
  if (await nameTaken(data.name)) throw new SupplierUserError(`Поставщик «${data.name}» уже есть.`);
  const s = await prisma.supplier.create({ data });
  return s.id;
}

export async function updateSupplier(id: string, input: SupplierInput) {
  const data = checkSupplier(input);
  if (await nameTaken(data.name, id)) throw new SupplierUserError(`Поставщик «${data.name}» уже есть.`);
  await prisma.supplier.update({ where: { id }, data });
}

/** Удалить можно только поставщика без товаров; его журнал загрузок и выбор категорий/брендов удаляются вместе с ним. */
export async function deleteSupplier(id: string) {
  const s = await prisma.supplier.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!s) return;
  if (s._count.products) {
    throw new SupplierUserError(`У поставщика ${s._count.products} товаров. Отмените его загрузки в «Импорте» или выключите поставщика («Работаем с ним» — снять).`);
  }
  const runs = await prisma.importRun.findMany({ where: { supplierId: id }, select: { feedFile: true } });
  for (const r of runs) if (r.feedFile) await fs.rm(r.feedFile, { force: true }).catch(() => {});
  await prisma.$transaction([prisma.importRun.deleteMany({ where: { supplierId: id } }), prisma.supplier.delete({ where: { id } })]);
}

/** Какие бренды возит поставщик — полный список отмеченных. */
export async function setSupplierBrands(supplierId: string, brandIds: string[]) {
  const ids = [...new Set(brandIds)];
  await prisma.$transaction([
    prisma.supplierBrand.deleteMany({ where: { supplierId, brandId: { notIn: ids } } }),
    prisma.supplierBrand.createMany({ data: ids.map((brandId) => ({ supplierId, brandId })), skipDuplicates: true }),
  ]);
}

// ---------- бренды ----------

export async function listBrands() {
  const rows = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    include: { suppliers: { include: { supplier: { select: { id: true, name: true } } } }, _count: { select: { products: true } } },
  });
  return rows.map((b) => ({
    id: b.id, name: b.name, products: b._count.products,
    suppliers: b.suppliers.map((s) => s.supplier).sort((a, c) => a.name.localeCompare(c.name)),
  }));
}

async function brandNameTaken(name: string, exceptId?: string) {
  return !!(await prisma.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }));
}

export async function createBrand(rawName: string, supplierIds: string[] = []): Promise<string> {
  const name = clean(rawName, 80);
  if (name.length < 1) throw new SupplierUserError("Укажите название бренда.");
  if (await brandNameTaken(name)) throw new SupplierUserError(`Бренд «${name}» уже есть.`);
  const b = await prisma.brand.create({ data: { name } });
  if (supplierIds.length) await prisma.supplierBrand.createMany({ data: supplierIds.map((supplierId) => ({ supplierId, brandId: b.id })), skipDuplicates: true });
  return b.id;
}

/** Переименовать бренд. Возвращает товары, которым надо обновить поиск. */
export async function renameBrand(id: string, rawName: string): Promise<string[]> {
  const name = clean(rawName, 80);
  if (!name) throw new SupplierUserError("Укажите название бренда.");
  const cur = await prisma.brand.findUnique({ where: { id } });
  if (!cur) throw new SupplierUserError("Бренд не найден.");
  if (cur.name === name) return [];
  if (await brandNameTaken(name, id)) throw new SupplierUserError(`Бренд «${name}» уже есть. Чтобы соединить два бренда в один, нажмите «Объединить».`);
  await prisma.$transaction([
    prisma.brand.update({ where: { id }, data: { name } }),
    // бренд по умолчанию у поставщика хранится названием
    prisma.supplier.updateMany({ where: { defaultBrand: cur.name }, data: { defaultBrand: name } }),
  ]);
  return (await prisma.product.findMany({ where: { brandId: id }, select: { id: true } })).map((p) => p.id);
}

/** Какие поставщики возят бренд — полный список отмеченных. */
export async function setBrandSuppliers(brandId: string, supplierIds: string[]) {
  const ids = [...new Set(supplierIds)];
  await prisma.$transaction([
    prisma.supplierBrand.deleteMany({ where: { brandId, supplierId: { notIn: ids } } }),
    prisma.supplierBrand.createMany({ data: ids.map((supplierId) => ({ supplierId, brandId })), skipDuplicates: true }),
  ]);
}

/** Объединить бренд-дубль в основной: товары, поставщики и выбор при импорте переходят к основному, дубль удаляется. */
export async function mergeBrand(fromId: string, intoId: string): Promise<string[]> {
  if (fromId === intoId) throw new SupplierUserError("Выберите другой бренд.");
  const [from, into] = await Promise.all([prisma.brand.findUnique({ where: { id: fromId } }), prisma.brand.findUnique({ where: { id: intoId } })]);
  if (!from || !into) throw new SupplierUserError("Бренд не найден.");
  const ids = (await prisma.product.findMany({ where: { brandId: fromId }, select: { id: true } })).map((p) => p.id);
  const links = await prisma.supplierBrand.findMany({ where: { brandId: fromId }, select: { supplierId: true } });
  await prisma.$transaction([
    prisma.product.updateMany({ where: { brandId: fromId }, data: { brandId: intoId } }),
    prisma.feedBrandMap.updateMany({ where: { brandId: fromId }, data: { brandId: intoId } }),
    prisma.supplierBrand.createMany({ data: links.map((l) => ({ supplierId: l.supplierId, brandId: intoId })), skipDuplicates: true }),
    prisma.supplier.updateMany({ where: { defaultBrand: from.name }, data: { defaultBrand: into.name } }),
    prisma.brand.delete({ where: { id: fromId } }),
  ]);
  return ids;
}

/** Удалить можно только бренд без товаров. */
export async function deleteBrand(id: string) {
  const b = await prisma.brand.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!b) return;
  if (b._count.products) throw new SupplierUserError(`У бренда ${b._count.products} товаров. Перенесите их в другой бренд кнопкой «Объединить».`);
  await prisma.$transaction([
    prisma.supplier.updateMany({ where: { defaultBrand: b.name }, data: { defaultBrand: null } }),
    prisma.brand.delete({ where: { id } }),
  ]);
}

/** Поставить бренд сразу многим товарам (из списка «Товары»). Защищает поле от импорта, как ручная правка. */
export async function setProductsBrand(ids: string[], brandId: string | null, who: string): Promise<number> {
  if (brandId && !(await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } }))) throw new SupplierUserError("Бренд не найден.");
  const list = [...new Set(ids)].slice(0, 5000);
  if (!list.length) return 0;
  const res = await prisma.product.updateMany({ where: { id: { in: list } }, data: { brandId } });
  await prisma.productFieldLock.createMany({ data: list.map((productId) => ({ productId, fieldName: "brandId", lockedBy: who })), skipDuplicates: true });
  await prisma.auditLog.create({ data: { who, action: "product.bulkBrand", target: brandId ?? "—", details: { count: res.count } } });
  return res.count;
}
