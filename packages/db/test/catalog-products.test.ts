// Ручная правка товаров на отдельной базе handyman_test: защита полей от импорта, история цен, расхождения.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

const SKU = "000237651"; // цена в фиде 1599

let dbReady = false;
let prisma: typeof import("../src/client").prisma;
let imp: typeof import("../src/catalog-import");
let prod: typeof import("../src/catalog-products");
let supplierId = "";
let productId = "";

async function reimport() {
  const runId = await imp.startPreview({ supplierId, source: file(sampleText), who: "test" });
  await imp.startApply({ runId, approvedSkus: [], who: "test" });
  return waitDone(imp, runId);
}
const editInput = async (over: Partial<import("../src/catalog-products").ProductEditInput> = {}) => {
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  return {
    nameUk: p.nameUk, nameRu: p.nameRu, descUk: p.descUk, descRu: p.descRu, price: p.price.toNumber(),
    oldPrice: p.oldPrice?.toNumber() ?? null, purchasePrice: p.purchasePrice?.toNumber() ?? null,
    visible: p.visible, categoryId: p.categoryId, brandId: p.brandId, ...over,
  };
};
const locks = async () => (await prisma.productFieldLock.findMany({ where: { productId } })).map((l) => l.fieldName).sort();

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  ({ prisma, imp, prod, supplierId } = s);
  await reimport();
  productId = (await prisma.product.findUniqueOrThrow({ where: { sku: SKU } })).id;
  dbReady = true;
});

after(async () => {
  if (dbReady) await prisma.$disconnect();
  cleanup();
});

test("правка без изменений ничего не делает", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  assert.deepEqual(await prod.updateProductManual(productId, await editInput(), { who: "m", canEditPrices: true }), []);
  assert.deepEqual(await locks(), []);
});

test("правка названия и видимости защищает эти поля от импорта", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const changed = await prod.updateProductManual(productId, await editInput({ nameUk: "Моя пила", visible: false }), { who: "manager", canEditPrices: false });
  assert.deepEqual(changed.sort(), ["nameUk", "visible"]);
  assert.deepEqual(await locks(), ["nameUk", "visible"]);
  await reimport();
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(p.nameUk, "Моя пила");
  assert.equal(p.visible, false);
  const audit = await prisma.auditLog.findFirst({ where: { action: "product.edit", who: "manager" } });
  assert.deepEqual(audit?.details, { fields: ["nameUk", "visible"] });
});

test("без права на цены менять цену нельзя", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  await assert.rejects(async () => prod.updateProductManual(productId, await editInput({ price: 1700 }), { who: "manager", canEditPrices: false }), /нет права менять цены/);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).price.toNumber(), 1599);
});

test("ручная цена: история цен, защита, расхождение с поставщиком, импорт цену не трогает", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  await prod.updateProductManual(productId, await editInput({ price: 1700 }), { who: "owner", canEditPrices: true });
  let p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(p.price.toNumber(), 1700);
  assert.equal(p.priceConflict, true);
  assert.ok((await locks()).includes("price"));
  const log = await prisma.priceLog.findMany({ where: { productId } });
  assert.deepEqual(log.map((l) => [l.source, l.oldPrice.toNumber(), l.newPrice.toNumber(), l.who]), [["MANUAL", 1599, 1700, "owner"]]);
  await reimport();
  p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(p.price.toNumber(), 1700);
  assert.equal(p.priceConflict, true);
  assert.equal(p.supplierPrice?.toNumber(), 1599);
});

test("«принять цену поставщика»: цена возвращается, защита цены снимается", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  await prod.acceptSupplierPrice(productId, "owner");
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(p.price.toNumber(), 1599);
  assert.equal(p.priceConflict, false);
  assert.ok(!(await locks()).includes("price"));
  const log = await prisma.priceLog.findMany({ where: { productId }, orderBy: { ts: "asc" } });
  assert.deepEqual(log.map((l) => l.source), ["MANUAL", "SUPPLIER"]);
  assert.equal(log[1].newPrice.toNumber(), 1599);
});

test("снятие защиты: поле снова берётся из фида при импорте", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  await prod.unlockField(productId, "nameUk", "owner");
  await prod.unlockField(productId, "visible", "owner");
  await assert.rejects(() => prod.unlockField(productId, "sku", "owner"), /Неизвестное поле/);
  await reimport();
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  assert.match(p.nameUk, /Пила ланцюгова акумуляторна Vitals Master AKZ 1815gk BL Premium/);
  // видимость импорт не меняет никогда, поле просто перестало быть защищённым
  assert.equal(p.visible, false);
});

test("закупочная цена: только с правом на цены, без замка и истории цен, импорт её не трогает", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  await assert.rejects(async () => prod.updateProductManual(productId, await editInput({ purchasePrice: 1200 }), { who: "manager", canEditPrices: false }), /нет права менять цены/);
  const logsBefore = await prisma.priceLog.count({ where: { productId } });
  const changed = await prod.updateProductManual(productId, await editInput({ purchasePrice: 1200 }), { who: "owner", canEditPrices: true });
  assert.deepEqual(changed, ["purchasePrice"]);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).purchasePrice?.toNumber(), 1200);
  assert.ok(!(await locks()).includes("purchasePrice"));
  assert.equal(await prisma.priceLog.count({ where: { productId } }), logsBefore);
  await reimport();
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).purchasePrice?.toNumber(), 1200);
  // очистить можно; ноль и минус — нельзя
  await assert.rejects(async () => prod.updateProductManual(productId, await editInput({ purchasePrice: 0 }), { who: "owner", canEditPrices: true }), /Закупочная цена/);
  await prod.updateProductManual(productId, await editInput({ purchasePrice: null }), { who: "owner", canEditPrices: true });
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).purchasePrice, null);
});

test("массовый перенос в другую категорию: категория защищается от импорта", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const other = await prisma.product.findFirstOrThrow({ where: { sku: { not: SKU } } });
  assert.equal(await prod.moveProductsToCategory([productId, other.id, productId], "acc", "owner"), 2);
  for (const id of [productId, other.id]) {
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id } })).categoryId, "acc");
    assert.ok((await prisma.productFieldLock.findMany({ where: { productId: id } })).some((l) => l.fieldName === "categoryId"));
  }
  await reimport();
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).categoryId, "acc");
  assert.equal(await prod.moveProductsToCategory([productId], "acc", "owner"), 0); // уже там
  await assert.rejects(() => prod.moveProductsToCategory([], "acc", "owner"), /Не выбрано/);
  await assert.rejects(() => prod.moveProductsToCategory([productId], "нет-такой", "owner"), /категории нет/);
});

test("проверки ввода: понятные сообщения", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const opts = { who: "owner", canEditPrices: true };
  await assert.rejects(async () => prod.updateProductManual(productId, await editInput({ nameUk: " " }), opts), /Название \(укр\.\)/);
  await assert.rejects(async () => prod.updateProductManual(productId, await editInput({ price: 0 }), opts), /Цена должна быть больше нуля/);
  await assert.rejects(async () => prod.updateProductManual(productId, await editInput({ oldPrice: 100 }), opts), /Старая цена/);
  await assert.rejects(async () => prod.updateProductManual(productId, await editInput({ categoryId: "нет" }), opts), /категории нет/);
  await assert.rejects(async () => prod.updateProductManual("no-such-id", await editInput(), opts), /не найден/);
});
