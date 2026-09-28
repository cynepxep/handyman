// Несколько поставщиков, бренды при импорте и отмена загрузки — на базе handyman_test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let dbReady = false;
let prisma: typeof import("../src/client").prisma;
let imp: typeof import("../src/catalog-import");
let undo: typeof import("../src/import-undo");
let sup: typeof import("../src/suppliers");
let vitalsId = "";
let milId = "";

/** Фид второго поставщика: два бренда в теге vendor, один товар без бренда. */
const milFeed = (extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="2026-09-28"><shop><currency id="UAH" rate="1"/>
<categories><category id="1">Акумуляторний інструмент</category><category id="2" parentId="1">Дрилі-шуруповерти</category></categories>
<offers>
  <offer id="1" available="true"><vendorCode>MW-001</vendorCode><name>Дриль-шуруповерт Milwaukee M18 FPD3</name><price>12000</price><categoryId>2</categoryId><vendor>MILWAUKEE</vendor><picture>https://example.com/1.jpg</picture></offer>
  <offer id="2" available="true"><vendorCode>MW-002</vendorCode><name>Гайковерт Milwaukee M18 FID3</name><price>9000</price><categoryId>2</categoryId><vendor>Milwaukee</vendor></offer>
  <offer id="3" available="true"><vendorCode>DW-001</vendorCode><name>Дриль DeWALT DCD796</name><price>7000</price><categoryId>2</categoryId><vendor>DeWALT</vendor></offer>
  <offer id="4" available="false"><vendorCode>NB-001</vendorCode><name>Біта PH2</name><price>50</price><categoryId>2</categoryId></offer>
  ${extra}
</offers></shop></yml_catalog>`;

async function load(supplierId: string, text: string, prep?: (runId: string) => Promise<void>) {
  const runId = await imp.startPreview({ supplierId, source: file(text), who: "test" });
  if (prep) await prep(runId);
  await imp.startApply({ runId, approvedSkus: [], who: "test" });
  const run = await waitDone(imp, runId);
  assert.equal(run.status, "DONE", run.error ?? "");
  return runId;
}

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  ({ prisma, imp } = s);
  vitalsId = s.supplierId;
  undo = await import("../src/import-undo");
  sup = await import("../src/suppliers");
  dbReady = true;
});

after(async () => {
  if (dbReady) await prisma.$disconnect();
  cleanup();
});

test("второй поставщик: бренды из фида, свой выбор «не загружать», Vitals не трогается", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  await load(vitalsId, sampleText);
  const vitalsCount = await prisma.product.count({ where: { supplierId: vitalsId } });
  assert.equal(vitalsCount, 19);

  milId = await sup.createSupplier({ name: "Мілвокі-Україна", defaultBrand: "Milwaukee" });
  await assert.rejects(() => sup.createSupplier({ name: "мілвокі-україна" }), /уже есть/);

  const runId = await imp.startPreview({ supplierId: milId, source: file(milFeed()), who: "test" });
  let run = await imp.getRun(runId);
  const rep = run!.report as import("../src/catalog-import").ImportReport;
  assert.deepEqual(rep.brands!.map((b) => [b.key, b.count, b.suggested.kind]), [["milwaukee", 2, "new"], ["dewalt", 1, "new"], ["(без бренду)", 1, "new"]]);
  assert.equal(rep.brands![0].name, "MILWAUKEE");
  assert.equal(rep.supplierProducts, 0);
  assert.equal(await prisma.brand.count({ where: { name: { in: ["MILWAUKEE", "Milwaukee", "DeWALT"] } } }), 0, "проверка брендов не создаёт");

  // владелец: DeWALT не загружать, товары без бренда — тоже Milwaukee (бренд поставщика по умолчанию — подсказка)
  await imp.saveBrandMapping(milId, { dewalt: { kind: "skip" } });
  await imp.refreshPreview(runId);
  run = await imp.getRun(runId);
  assert.equal((run!.summary as { created: number }).created, 3);
  await imp.startApply({ runId, approvedSkus: [], who: "test" });
  run = await waitDone(imp, runId);
  assert.equal(run.status, "DONE", run.error ?? "");

  const mil = await prisma.product.findMany({ where: { supplierId: milId }, include: { brand: true }, orderBy: { sku: "asc" } });
  assert.deepEqual(mil.map((p) => [p.sku, p.brand?.name]), [["MW-001", "MILWAUKEE"], ["MW-002", "MILWAUKEE"], ["NB-001", "MILWAUKEE"]]);
  assert.equal(await prisma.product.count({ where: { sku: "DW-001" } }), 0);
  // товары Vitals не стали «пропавшими»: у каждого поставщика свой каталог
  assert.equal(await prisma.product.count({ where: { supplierId: vitalsId, missingFromFeedSince: { not: null } } }), 0);
  const links = await prisma.supplierBrand.findMany({ where: { supplierId: milId }, include: { brand: true } });
  assert.deepEqual(links.map((l) => l.brand.name), ["MILWAUKEE"]);
  assert.equal((await imp.listRuns()).length, 2, "в журнале все поставщики");
});

test("отмена загрузки: созданные удаляются (заказанные — скрываются), прежние значения возвращаются", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  // Ошибка владельца: файл Milwaukee загружен как Vitals. Товары Vitals стали «Под заказ», у одного товара сменилась цена.
  await prisma.product.update({ where: { sku: "000237651" }, data: { price: 1599 } });
  const wrongFeed = milFeed(`<offer id="9" available="true"><vendorCode>000237651</vendorCode><name>Пила ланцюгова Vitals Master AKZ 1815gk BL Premium</name><price>1700</price><categoryId>2</categoryId></offer>`)
    .replace(/MW-00/g, "WR-00").replace("DW-001", "WR-DW").replace("NB-001", "WR-NB");
  const runId = await load(vitalsId, wrongFeed);
  const run = await imp.getRun(runId);
  const s = run!.summary as { created: number; missing: number };
  assert.equal(s.created, 4);
  assert.ok(s.missing >= 15, "товары Vitals стали «пропавшими»");
  const saw = await prisma.product.findUniqueOrThrow({ where: { sku: "000237651" } });
  assert.equal(saw.price.toNumber(), 1700);

  // пока есть более поздняя загрузка — старую не отменить
  const info = await undo.undoInfo(runId);
  assert.ok(info.can && !info.legacy && info.created === 4);

  // один созданный товар уже успели заказать — его не удаляем, а скрываем
  const wr = await prisma.product.findUniqueOrThrow({ where: { sku: "WR-001" } });
  const client = await prisma.client.create({ data: { phone: "+380500000077", name: "Тест" } });
  const order = await prisma.order.create({
    data: {
      no: "HM-T1", clientId: client.id, payMode: "LATER", delivery: "TO_CONFIRM", subtotal: 1, total: 1, dueNow: 0,
      items: { create: { productId: wr.id, sku: wr.sku, name: wr.nameUk, qty: 1, unitPrice: 1 } },
    },
  });
  // у одного «испорченного» товара поле уже поменяли после загрузки — его отмена не трогает
  const other = await prisma.product.findFirstOrThrow({ where: { supplierId: vitalsId, missingFromFeedSince: { not: null } } });
  const touched = new Date("2026-01-01T00:00:00Z");
  await prisma.product.update({ where: { id: other.id }, data: { missingFromFeedSince: touched } });

  const out = await undo.undoImport(runId, "test");
  assert.equal(out.legacy, false);
  assert.equal(out.deleted + out.hidden, 4);
  assert.equal(out.hidden, 1);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: wr.id } })).visible, false, "заказанный товар скрыт, а не удалён");
  assert.ok(out.restored >= 15);
  assert.ok(out.keptChanged >= 1);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { sku: "000237651" } })).price.toNumber(), 1599, "цена вернулась");
  const stillMissing = await prisma.product.findMany({ where: { supplierId: vitalsId, missingFromFeedSince: { not: null } } });
  assert.deepEqual(stillMissing.map((p) => [p.id, p.missingFromFeedSince?.toISOString()]), [[other.id, touched.toISOString()]]);
  await prisma.product.update({ where: { id: other.id }, data: { missingFromFeedSince: null } });
  assert.equal(await prisma.product.count({ where: { sku: { in: ["WR-002", "WR-DW", "WR-NB"] } } }), 0);
  const log = await prisma.priceLog.findFirst({ where: { product: { sku: "000237651" } }, orderBy: { ts: "desc" } });
  assert.equal(log?.newPrice.toNumber(), 1599);

  const again = await undo.undoInfo(runId);
  assert.ok(!again.can && /уже отменена/.test(again.reason));
  await assert.rejects(() => undo.undoImport(runId, "test"), /уже отменена/);
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.product.delete({ where: { id: wr.id } });
  // запись отменённой загрузки можно убрать из журнала
  await undo.deleteRunRecord(runId, "test");
  assert.equal(await prisma.importRun.count({ where: { id: runId } }), 0);
});

test("отменить можно только последнюю загрузку поставщика; повтор без изменений не мешает; проверку — только убрать", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const first = (await imp.listRuns(milId))[0].id;
  // повтор того же файла ничего не меняет: отменять нечего, запись можно убрать, первую он не блокирует
  const same = await load(milId, milFeed());
  const si = await undo.undoInfo(same);
  assert.ok(!si.can && si.deletable && /отменять нечего/.test(si.reason));
  assert.ok((await undo.undoInfo(first)).can);
  await undo.deleteRunRecord(same, "test");
  // а загрузка с новой ценой блокирует более раннюю, и её запись без отмены не убрать
  const second = await load(milId, milFeed().replace("<price>12000</price>", "<price>12500</price>"));
  const info = await undo.undoInfo(first);
  assert.ok(!info.can && /Сначала отмените более позднюю/.test(info.reason));
  await assert.rejects(() => undo.deleteRunRecord(second, "test"), /Сначала нажмите «Отменить загрузку»/);
  const out = await undo.undoImport(second, "test");
  assert.equal(out.restored, 1);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { sku: "MW-001" } })).price.toNumber(), 12000);
  assert.ok((await undo.undoInfo(first)).can, "после отмены поздней — ранняя снова отменяется");
  await undo.deleteRunRecord(second, "test");
  const preview = await imp.startPreview({ supplierId: milId, source: file(milFeed()), who: "test" });
  const pi = await undo.undoInfo(preview);
  assert.ok(!pi.can && pi.deletable && /проверка/.test(pi.reason));
  await undo.deleteRunRecord(preview, "test");
});

test("отмена загрузки убирает созданные ею категории, если они опустели", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const newSup = await sup.createSupplier({ name: "Зварка-Опт" });
  const feed = milFeed().replace("Акумуляторний інструмент", "Лазерна техніка").replace("Дрилі-шуруповерти", "Нівеліри").replace(/MW-00/g, "ZV-M").replace("DW-001", "ZV-D").replace("NB-001", "ZV-N");
  const runId = await load(newSup, feed);
  const created = ((await imp.getRun(runId))!.report as { createdCategories: string[] }).createdCategories;
  assert.ok(created.length >= 1);
  const out = await undo.undoImport(runId, "test");
  assert.equal(out.categoriesRemoved, created.length);
  assert.equal(await prisma.category.count({ where: { id: { in: created } } }), 0);
  await undo.deleteRunRecord(runId, "test");
  await sup.deleteSupplier(newSup);
});

test("старая загрузка (без журнала изменений): товары находятся по времени, «пропавшие» снова в каталоге", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const runId = await load(vitalsId, milFeed().replace(/MW-00/g, "OLD-00").replace("DW-001", "OLD-DW").replace("NB-001", "OLD-NB"));
  // как будто загрузка была до обновления: нет журнала изменений и новых полей отчёта
  await prisma.importUndo.deleteMany({ where: { runId } });
  const { createdCategories: _c, createdBrands: _b, addedBrandLinks: _l, ...oldReport } = (await imp.getRun(runId))!.report as Record<string, unknown>;
  await prisma.importRun.update({ where: { id: runId }, data: { report: oldReport as never } });
  const info = await undo.undoInfo(runId);
  assert.ok(info.can && info.legacy);
  assert.equal(info.created, 4);
  assert.ok(info.updated >= 15);
  const out = await undo.undoImport(runId, "test");
  assert.equal(out.deleted, 4);
  assert.ok(out.restored >= 15);
  assert.equal(await prisma.product.count({ where: { sku: { startsWith: "OLD-" } } }), 0);
  assert.equal(await prisma.product.count({ where: { supplierId: vitalsId, missingFromFeedSince: { not: null } } }), 0);
  assert.equal(await prisma.product.count({ where: { supplierId: vitalsId } }), 19, "товары Vitals на месте");
});

test("бренды: переименовать, объединить дубль, удалить пустой; поставщики бренда", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const mil = await prisma.brand.findFirstOrThrow({ where: { name: "MILWAUKEE" } });
  const renamed = await sup.renameBrand(mil.id, "Milwaukee");
  assert.ok(renamed.length >= 3);
  assert.equal((await prisma.supplier.findUniqueOrThrow({ where: { id: milId } })).defaultBrand, "Milwaukee");
  const dup = await sup.createBrand("Мілуокі", [vitalsId]);
  await assert.rejects(() => sup.createBrand("milwaukee"), /уже есть/);
  const p = await prisma.product.findFirstOrThrow({ where: { supplierId: vitalsId } });
  await sup.setProductsBrand([p.id], dup, "test");
  assert.equal(await prisma.productFieldLock.count({ where: { productId: p.id, fieldName: "brandId" } }), 1);
  await assert.rejects(() => sup.deleteBrand(dup), /Объединить/);
  const moved = await sup.mergeBrand(dup, mil.id);
  assert.deepEqual(moved, [p.id]);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).brandId, mil.id);
  const brands = await sup.listBrands();
  const row = brands.find((b) => b.id === mil.id)!;
  assert.deepEqual(row.suppliers.map((s) => s.id).sort(), [milId, vitalsId].sort(), "у бренда два поставщика");
  await sup.setBrandSuppliers(mil.id, [milId]);
  assert.equal((await sup.listBrands()).find((b) => b.id === mil.id)!.suppliers.length, 1);
  const empty = await sup.createBrand("Пустий");
  await sup.deleteBrand(empty);
  assert.equal(await prisma.brand.count({ where: { id: empty } }), 0);
  // поставщика с товарами удалить нельзя, без товаров — можно
  await assert.rejects(() => sup.deleteSupplier(milId), /товаров/);
  const tmp = await sup.createSupplier({ name: "Тимчасовий", feedUrl: "https://example.com/feed.xml", markupPct: 10 });
  await assert.rejects(() => sup.updateSupplier(tmp, { name: "Тимчасовий", feedUrl: "ftp://x" }), /http/);
  await sup.deleteSupplier(tmp);
  assert.equal((await sup.listSuppliers()).length, 2);
});

test("отмена убирает бренды, которые появились из-за загрузки, если у них не осталось товаров", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const tmp = await sup.createSupplier({ name: "Бренди-Тест", defaultBrand: "Власний" });
  const keep = await prisma.brand.findFirstOrThrow({ where: { name: "Milwaukee" } });
  const feed = milFeed().replace(/MW-00/g, "BT-M").replace("DW-001", "BT-D").replace("NB-001", "BT-N").replace("<vendor>DeWALT</vendor>", "<vendor>Новий Бренд</vendor>");
  const runId = await load(tmp, feed);
  const linked = await prisma.supplierBrand.findMany({ where: { supplierId: tmp }, include: { brand: true } });
  assert.deepEqual(linked.map((l) => l.brand.name).sort(), ["Milwaukee", "Власний", "Новий Бренд"].sort());
  const out = await undo.undoImport(runId, "test");
  assert.equal(out.brandsRemoved, 2, "«Новий Бренд» и «Власний» созданы загрузкой и опустели");
  assert.equal(await prisma.brand.count({ where: { name: { in: ["Новий Бренд", "Власний"] } } }), 0);
  assert.ok(await prisma.brand.findUnique({ where: { id: keep.id } }), "существовавший бренд остаётся");
  assert.equal(await prisma.supplierBrand.count({ where: { supplierId: tmp } }), 0);
  assert.equal((await prisma.supplier.findUniqueOrThrow({ where: { id: tmp } })).defaultBrand, "Власний", "настройка поставщика не теряется");
  await undo.deleteRunRecord(runId, "test");
  await sup.deleteSupplier(tmp);
});
