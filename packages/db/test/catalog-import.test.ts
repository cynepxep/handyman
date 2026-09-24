// Интеграционный тест импорта на отдельной базе handyman_test (Docker: pnpm infra:up).
// Если базы нет — тесты пропускаются с пояснением, остальные проверки от Docker не зависят.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

const SKU = "000237651"; // Пила ланцюгова Vitals Master AKZ 1815gk BL Premium, цена в фиде 1599

let dbReady = false;
let prisma: typeof import("../src/client").prisma;
let imp: typeof import("../src/catalog-import");
let supplierId = "";

async function previewAndApply(source: { kind: "file"; name: string; bytes: Uint8Array }, approved: string[] = []) {
  const runId = await imp.startPreview({ supplierId, source, who: "test" });
  await imp.startApply({ runId, approvedSkus: approved, who: "test" });
  return waitDone(imp, runId);
}
const summaryOf = (run: { summary: unknown } | null) => run!.summary as Record<string, number>;

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  ({ prisma, imp, supplierId } = s);
  dbReady = true;
});

after(async () => {
  if (dbReady) await prisma.$disconnect();
  cleanup();
});

test("проверка ничего не записывает в каталог и показывает, что изменится", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const runId = await imp.startPreview({ supplierId, source: file(sampleText), who: "test" });
  const run = await imp.getRun(runId);
  assert.equal(run!.status, "PREVIEW");
  const s = summaryOf(run);
  assert.equal(s.created, 19);
  assert.equal(s.skipped, 4);
  assert.equal(await prisma.product.count(), 0);
  const report = run!.report as { tree: { key: string; count: number; decision: { kind: string } }[]; newCategories: string[] };
  assert.ok(report.tree.some((r) => r.key === "Архів продукції" && r.decision.kind === "skip"));
  assert.deepEqual(report.newCategories, ["Зварювальне обладнання"]);
  // применяем именно эту проверку
  await imp.startApply({ runId, approvedSkus: [], who: "test" });
  const done = await waitDone(imp, runId);
  assert.equal(done.status, "DONE", done.error ?? "");
  assert.equal(summaryOf(done).created, 19);
  assert.equal(summaryOf(done).errors, 0);
  await assert.rejects(() => imp.startApply({ runId, approvedSkus: [], who: "test" }), /уже применили/);
});

test("после первого импорта: товары, картинки, характеристики, категории, бренд", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  assert.equal(await prisma.product.count(), 19);
  const p = await prisma.product.findUniqueOrThrow({
    where: { sku: SKU },
    include: { images: true, attributes: { orderBy: { sort: "asc" } }, brand: true, category: { include: { parent: true } } },
  });
  assert.equal(p.price.toNumber(), 1599);
  assert.equal(p.oldPrice?.toNumber(), 1909);
  assert.equal(p.supplierPrice?.toNumber(), 1599);
  assert.equal(p.supplierAvailable, true);
  assert.equal(p.source, "FEED");
  assert.equal(p.articleCode, "237651");
  assert.equal(p.brand?.name, "Vitals");
  assert.equal(p.images.length, 2);
  assert.equal(p.attributes.length, 9);
  assert.equal(p.attributes[0].key, "Тип двигуна"); // порядок как в фиде
  assert.equal(p.category.id, "ak-seriya-m-type-18-sadovo-parkova-tekhnika");
  assert.equal(p.category.parent?.id, "ak-seriya-m-type-18");
  assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: "ak-seriya-m-type-18" } })).parentId, "ak");
  assert.ok(await prisma.category.findUnique({ where: { id: "zvaryuvalne-obladnannya" } }), "создана категория из корня фида");
  assert.equal(await prisma.product.count({ where: { supplierAvailable: false } }), 3); // «Под заказ»: два дрель-шуруповёрта и сварочный аппарат
});

test("повторный импорт: 0 изменений, историй цен нет", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const run = await previewAndApply(file(sampleText));
  const s = summaryOf(run);
  assert.equal(run.status, "DONE");
  assert.equal(s.created, 0);
  assert.equal(s.updated, 0);
  assert.equal(s.unchanged, 19);
  assert.equal(await prisma.priceLog.count(), 0);
  assert.equal(await prisma.product.count(), 19);
});

test("ручная цена защищена: цена остаётся, товар в расхождениях, цена поставщика запомнена", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const p = await prisma.product.findUniqueOrThrow({ where: { sku: SKU } });
  await prisma.product.update({ where: { id: p.id }, data: { price: 1700 } });
  await prisma.productFieldLock.create({ data: { productId: p.id, fieldName: "price", lockedBy: "test" } });
  const run = await previewAndApply(file(sampleText));
  assert.equal(summaryOf(run).conflicts, 1);
  const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(after.price.toNumber(), 1700);
  assert.equal(after.priceConflict, true);
  assert.equal(after.supplierPrice?.toNumber(), 1599);
  assert.equal(await prisma.priceLog.count(), 0);
  // владелец принял цену поставщика: снимаем блокировку и ставим цену → расхождение исчезает при следующем импорте
  await prisma.productFieldLock.deleteMany({ where: { productId: p.id } });
  const run2 = await previewAndApply(file(sampleText));
  const fixed = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(fixed.price.toNumber(), 1599);
  assert.equal(fixed.priceConflict, false);
  assert.equal(summaryOf(run2).priceChanged, 1);
  const log = await prisma.priceLog.findMany({ where: { productId: p.id } });
  assert.equal(log.length, 1);
  assert.equal(log[0].source, "IMPORT");
  assert.equal(log[0].oldPrice.toNumber(), 1700);
  assert.equal(log[0].newPrice.toNumber(), 1599);
});

test("скачок цены больше 30% ждёт подтверждения", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const p = await prisma.product.findUniqueOrThrow({ where: { sku: SKU } });
  await prisma.product.update({ where: { id: p.id }, data: { price: 1000 } }); // фид 1599 = +59,9%
  const held = await previewAndApply(file(sampleText));
  assert.equal(summaryOf(held).needConfirm, 1);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).price.toNumber(), 1000);
  const ok = await previewAndApply(file(sampleText), [SKU]);
  assert.equal(summaryOf(ok).priceChanged, 1);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).price.toNumber(), 1599);
});

test("товар пропал из фида: остаётся на сайте как «Под заказ»", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const withoutOne = sampleText.replace(/<item id="992486">[\s\S]*?<\/item>/, "");
  assert.notEqual(withoutOne, sampleText);
  const run = await previewAndApply(file(withoutOne));
  assert.equal(summaryOf(run).missing, 1);
  const p = await prisma.product.findUniqueOrThrow({ where: { sku: SKU } });
  assert.equal(p.supplierAvailable, false);
  assert.equal(p.visible, true);
  assert.ok(p.missingFromFeedSince);
  // вернулся
  await previewAndApply(file(sampleText));
  const back = await prisma.product.findUniqueOrThrow({ where: { sku: SKU } });
  assert.equal(back.supplierAvailable, true);
  assert.equal(back.missingFromFeedSince, null);
});

test("выбор владельца: «не загружать» ветку и новый выбор категории запоминаются", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  await imp.saveMapping(supplierId, { "Зварювальне обладнання": { kind: "skip" }, "Архів продукції": { kind: "category", categoryId: "acc" } });
  const run = await previewAndApply(file(sampleText));
  const s = summaryOf(run);
  assert.equal(s.created, 4); // архив теперь загружается
  assert.equal(s.missing, 1); // сварочный аппарат больше не загружается → недоступен
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { sku: "000237593" } })).supplierAvailable, false);
  assert.ok(await prisma.product.findUnique({ where: { sku: "000223813" } }));
  await imp.saveMapping(supplierId, { "Зварювальне обладнання": { kind: "auto" } });
  assert.equal(await prisma.feedCategoryMap.count({ where: { supplierId, path: "Зварювальне обладнання" } }), 0);
  await assert.rejects(() => imp.saveMapping(supplierId, { X: { kind: "category", categoryId: "нет-такой" } }), /не найдена/);
});

test("товар без категории попадает в «Нераспределённые», а не теряется", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const item = '<item id="9001"><vendorCode>NOCAT-1</vendorCode><name>Товар без категории</name><price>50</price><available>true</available></item>';
  const run = await previewAndApply(file(sampleText.replace("</items>", `${item}</items>`)));
  assert.equal(summaryOf(run).created, 1);
  const p = await prisma.product.findUniqueOrThrow({ where: { sku: "NOCAT-1" } });
  assert.equal(p.categoryId, "unsorted");
  const cat = await prisma.category.findUniqueOrThrow({ where: { id: "unsorted" } });
  assert.equal(cat.parentId, null);
  assert.match(cat.nameRu, /Нераспределённые/);
});

test("веб-страница вместо XML: понятная ошибка, запуск не создаётся", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const before = await prisma.importRun.count();
  await assert.rejects(() => imp.startPreview({ supplierId, source: file("<html><body>Just a moment...</body></html>"), who: "test" }), /веб-страница/);
  assert.equal(await prisma.importRun.count(), before);
  await assert.rejects(() => imp.fetchFeedBytes("http://localhost:3000/x"), /обычным адресом/);
});
