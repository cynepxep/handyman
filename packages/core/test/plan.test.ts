import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeed, planImport, computePrice, type ExistingProduct, type ImportPlan, type FeedItem, type PlanOptions, type StoredMapping } from "../src/catalog";

const here = path.dirname(fileURLToPath(import.meta.url));
const feed = parseFeed(fs.readFileSync(path.join(here, "fixtures", "vitals-sample.xml")));
const NOW = new Date("2026-09-24T12:00:00Z");
const SUPPLIER = "sup1";

const opts = (over: Partial<PlanOptions> = {}): PlanOptions => ({
  supplierId: SUPPLIER, markupPct: null, jumpPct: 30, brandId: "brand-vitals",
  stored: new Map() as StoredMapping, approvedSkus: new Set(), now: NOW, ...over,
});
const run = (existing: ExistingProduct[], o = opts(), items: FeedItem[] = feed.items) =>
  planImport(items, new Map(existing.map((e) => [e.sku, e])), o, { totalRows: items.length, issues: 0 });

/** Имитация базы после первого импорта: из планов «создать» делаем существующие товары. */
function dbAfter(plan: ImportPlan): ExistingProduct[] {
  const out: ExistingProduct[] = [];
  for (const p of plan.items) {
    if (p.action !== "create") continue;
    out.push({
      id: `id-${p.sku}`, sku: p.sku, ...p.data, descRu: null, visible: true, source: "FEED", locked: new Set(),
      pictures: p.item.pictures, params: p.item.params,
    });
  }
  return out;
}
const upd = (plan: ImportPlan, sku: string) => plan.items.find((i) => i.sku === sku && (i.action === "update" || i.action === "unchanged")) as Extract<ImportPlan["items"][number], { productId: string }>;

test("первый импорт образца: архив пропущен, остальное создаётся, цена = цене фида", () => {
  const plan = run([]);
  assert.equal(plan.summary.created + plan.summary.skipped, 23);
  assert.equal(plan.summary.skipped, 4);
  assert.deepEqual(plan.summary.skippedByReason, { "Архів продукції": 4 });
  const c = plan.items.find((i) => i.sku === "000237651");
  assert.ok(c && c.action === "create");
  assert.equal(c.data.price, 1599);
  assert.equal(c.data.oldPrice, 1909);
  assert.equal(c.data.supplierPrice, 1599);
  assert.equal(c.data.supplierAvailable, true);
  assert.equal(c.data.brandId, "brand-vitals");
  assert.equal(c.data.categoryId, "ak-seriya-m-type-18-sadovo-parkova-tekhnika");
  assert.equal(c.data.nameRu, c.data.nameUk); // пока копия украинского
});

test("повторный импорт без изменений даёт 0 изменений", () => {
  const first = run([]);
  const again = run(dbAfter(first));
  assert.equal(again.summary.created, 0);
  assert.equal(again.summary.updated, 0);
  assert.equal(again.summary.unchanged, first.summary.created);
  assert.equal(again.summary.priceChanged, 0);
  assert.equal(again.missing.length, 0);
});

test("наценка поставщика применяется, для Vitals без наценки цена равна фиду", () => {
  assert.equal(computePrice(1599, null), 1599);
  assert.equal(computePrice(1000, 12.5), 1125);
  assert.equal(computePrice(99.99, 10), 109.99);
});

test("обычное изменение цены: применяется и пишется в историю", () => {
  const db = dbAfter(run([]));
  db.find((e) => e.sku === "000237651")!.price = 1500; // было 1500, в фиде 1599 (+6,6%)
  const plan = run(db);
  const p = upd(plan, "000237651");
  assert.equal(p.action, "update");
  assert.equal(p.changes.price, 1599);
  assert.deepEqual(p.priceLog, { oldPrice: 1500, newPrice: 1599 });
  assert.equal(plan.summary.priceChanged, 1);
});

test("скачок цены больше 30% ждёт подтверждения, с подтверждением применяется", () => {
  const db = dbAfter(run([]));
  db.find((e) => e.sku === "000237651")!.price = 1000; // 1599 против 1000 = +59,9%
  const held = upd(run(db), "000237651");
  assert.equal(held.changes.price, undefined);
  assert.equal(held.priceLog, null);
  assert.equal(held.jump?.newPrice, 1599);
  assert.equal(held.jump?.pct, 59.9);
  assert.equal(run(db).summary.needConfirm, 1);
  const ok = upd(run(db, opts({ approvedSkus: new Set(["000237651"]) })), "000237651");
  assert.equal(ok.changes.price, 1599);
  assert.equal(ok.jump, null);
});

test("цена защищена вручную: не меняется, товар попадает в расхождения; при совпадении флаг снимается", () => {
  const db = dbAfter(run([]));
  const e = db.find((x) => x.sku === "000237651")!;
  e.price = 1700;
  e.locked = new Set(["price"]);
  const plan = run(db);
  const p = upd(plan, "000237651");
  assert.equal(p.changes.price, undefined);
  assert.equal(p.changes.priceConflict, true);
  assert.equal(p.conflict, true);
  assert.equal(p.changes.supplierPrice, undefined); // supplierPrice уже равен фиду
  assert.equal(plan.summary.conflicts, 1);
  // владелец поставил цену как у поставщика → расхождение исчезает
  e.price = 1599;
  e.priceConflict = true;
  const p2 = upd(run(db), "000237651");
  assert.equal(p2.changes.priceConflict, false);
  assert.equal(p2.conflict, false);
});

test("ручные правки защищены: название и описание не перезаписываются, пустое описание из фида не затирает", () => {
  const db = dbAfter(run([]));
  const e = db.find((x) => x.sku === "000237651")!;
  e.nameUk = "Моя пила";
  e.locked = new Set(["nameUk"]);
  const p = upd(run(db), "000237651");
  assert.equal(p.changes.nameUk, undefined);

  const empty: FeedItem = { ...feed.items[0], descriptionHtml: "", pictures: [], params: [] };
  const db2 = dbAfter(run([], opts(), [feed.items[0]]));
  db2[0].descUk = "Описание, написанное руками";
  const plan = run(db2, opts(), [empty]);
  const q = upd(plan, empty.sku);
  assert.equal(q.changes.descUk, undefined);
  assert.equal(q.replacePictures, null);
  assert.equal(q.replaceParams, null);
});

test("русское название обновляется только пока оно копия украинского", () => {
  const db = dbAfter(run([]));
  const e = db.find((x) => x.sku === "000237651")!;
  const item = feed.items.find((i) => i.sku === "000237651")!;
  e.nameUk = "Старое название";
  e.nameRu = "Старое название";
  const p = upd(run(db), "000237651");
  assert.equal(p.changes.nameUk, item.name);
  assert.equal(p.changes.nameRu, item.name);
  e.nameUk = "Старое название";
  e.nameRu = "Пила аккумуляторная (перевод)";
  const p2 = upd(run(db), "000237651");
  assert.equal(p2.changes.nameRu, undefined);
});

test("товар пропал из фида: остаётся «Под заказ», ручные и чужие товары не трогаем", () => {
  const db = dbAfter(run([]));
  const base = db[0];
  const gone: ExistingProduct = { ...base, id: "gone", sku: "GONE-1" };
  const manual: ExistingProduct = { ...base, id: "man", sku: "MAN-1", source: "MANUAL" };
  const other: ExistingProduct = { ...base, id: "oth", sku: "OTH-1", supplierId: "other-supplier" };
  const plan = run([...db, gone, manual, other]);
  assert.deepEqual(plan.missing.map((m) => m.sku), ["GONE-1"]);
  assert.equal(plan.missing[0].changes.supplierAvailable, false);
  assert.equal(plan.missing[0].changes.missingFromFeedSince, NOW);
  assert.equal(plan.summary.missing, 1);
  // уже отмечен — повторно не отмечаем
  gone.supplierAvailable = false;
  gone.missingFromFeedSince = new Date("2026-09-01T00:00:00Z");
  assert.equal(run([...db, gone]).missing.length, 0);
});

test("товар вернулся в фид: метка «пропал» снимается, наличие обновляется", () => {
  const db = dbAfter(run([]));
  const e = db.find((x) => x.sku === "000237651")!;
  e.supplierAvailable = false;
  e.missingFromFeedSince = new Date("2026-09-01T00:00:00Z");
  const p = upd(run(db), "000237651");
  assert.equal(p.changes.supplierAvailable, true);
  assert.equal(p.changes.missingFromFeedSince, null);
});

test("ранее загруженный товар ушёл в архив: становится недоступным с понятной причиной", () => {
  const db = dbAfter(run([], opts({ stored: new Map([["Архів продукції", { categoryId: "acc", skip: false }]]) as StoredMapping })));
  const archived = db.find((x) => x.sku === "000223813");
  assert.ok(archived, "при выборе владельца архив загружается");
  const plan = run(db); // теперь архив снова пропускается
  const m = plan.missing.find((x) => x.sku === "000223813");
  assert.ok(m);
  assert.equal(m.reason, "Архів продукції");
});

test("выбор владельца «не загружать» и «новая категория» работают через сопоставление", () => {
  const stored: StoredMapping = new Map([["Зварювальне обладнання", { categoryId: null, skip: true }]]);
  const plan = run([], opts({ stored }));
  assert.equal(plan.summary.skippedByReason["Выбрано «не загружать»"], 1);
  const welding = run([]).items.find((i) => i.sku === "000237593");
  assert.ok(welding && welding.action === "create");
  assert.equal(welding.placement.topNewName, "Зварювальне обладнання");
  assert.equal(welding.placement.topId, "zvaryuvalne-obladnannya");
});
