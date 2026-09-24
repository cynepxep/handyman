// Поиск на живом Meilisearch (индекс products_test) и базе handyman_test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let search: typeof import("../src/catalog-search");
const noMeili = "Meilisearch недоступен (запустите pnpm infra:up; ключ MEILI_MASTER_KEY берётся из .env)";

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  search = await import("../src/catalog-search");
  if (!(await search.searchStats()).ok && !(await tryCreate())) {
    console.warn("Тест поиска пропущен:", noMeili);
    return;
  }
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  ready = true;
});

async function tryCreate() {
  try {
    await search.ensureIndex();
    return true;
  } catch {
    return false;
  }
}

after(async () => {
  if (ready) await search.reindexProducts([]).catch(() => {});
  if (prisma) await prisma.$disconnect();
  cleanup();
});

test("полная пересборка: в индексе все видимые товары, недоступный Meili не роняет остальное", async (t) => {
  if (!ready) return t.skip(noMeili);
  const { indexed } = await search.reindexAll();
  assert.equal(indexed, 19);
  assert.equal((await search.searchStats()).documents, 19);
  assert.equal(await search.isSearchStale(), false);
});

test("поиск по названию, артикулу (в т.ч. без нулей) и по синониму", async (t) => {
  if (!ready) return t.skip(noMeili);
  const saws = await search.searchProducts({ q: "пила" });
  // самые релевантные — пилы по названию (дальше могут идти товары, где слово только в описании)
  assert.ok(saws.total >= 3 && saws.items.slice(0, 3).every((i) => /пил/i.test(i.nameUk)), `пил: ${saws.total}`);
  assert.equal((await search.searchProducts({ q: "000237651" })).items[0]?.sku, "000237651");
  assert.equal((await search.searchProducts({ q: "237651" })).items[0]?.sku, "000237651");
  // «шуруповерт» находит и «шурупокрут»
  const drills = await search.searchProducts({ q: "шуруповерт" });
  assert.ok(drills.items.some((i) => /шурупокрут/i.test(i.nameUk)) && drills.items.some((i) => /шуруповерт/i.test(i.nameUk)));
});

test("раскладка клавиатуры: gbkf → пила, подсказки тоже", async (t) => {
  if (!ready) return t.skip(noMeili);
  const r = await search.searchProducts({ q: "gbkf" });
  assert.equal(r.correctedQuery, "пила");
  assert.ok(r.total >= 3);
  const s = await search.suggestProducts("gbkf");
  assert.equal(s.correctedQuery, "пила");
  assert.ok(s.items.length > 0 && s.items.length <= 6);
  assert.deepEqual((await search.suggestProducts("п")).items, []); // слишком короткий запрос
});

test("фильтры: категория со всеми вложенными, бренд, цена, наличие, скидка, характеристики", async (t) => {
  if (!ready) return t.skip(noMeili);
  const all = await search.searchProducts({});
  assert.equal(all.total, 19);
  const ak = await search.searchProducts({ cat: "ak" });
  assert.ok(ak.total > 0 && ak.total < 19);
  assert.ok(ak.facets.categories.length > 0, "подкатегории со счётчиками");
  assert.equal((await search.searchProducts({ brand: ["Vitals"] })).total, 19);
  assert.equal((await search.searchProducts({ brand: ["Bosch"] })).total, 0);
  const cheap = await search.searchProducts({ max: 1500, sort: "price_asc" });
  assert.ok(cheap.items.every((i) => i.price <= 1500));
  // сортировка по цене: сначала «в наличии» по возрастанию, потом «под заказ» по возрастанию
  for (const flag of [true, false]) {
    const prices = cheap.items.filter((i) => i.available === flag).map((i) => i.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  }
  assert.deepEqual(cheap.items.map((i) => i.available), cheap.items.map((i) => i.available).sort((a, b) => Number(b) - Number(a)));
  const avail = await search.searchProducts({ available: true });
  assert.equal(avail.total, 16); // 3 «Под заказ»
  assert.ok(avail.items.every((i) => i.available));
  assert.ok((await search.searchProducts({ sale: true })).items.every((i) => i.oldPrice && i.oldPrice > i.price));
  const v = await search.searchProducts({ facets: { voltage: ["18"] } });
  assert.ok(v.total > 0 && v.total < 19);
  // счётчики выбранной группы показывают и другие значения (disjunctive)
  const voltage = v.facets.attrs.find((a) => a.key === "voltage");
  assert.ok(voltage?.values.find((x) => x.value === "18" && x.selected));
  assert.ok(all.facets.price && all.facets.price.min <= all.facets.price.max);
});

test("недоступные товары в списке идут после доступных", async (t) => {
  if (!ready) return t.skip(noMeili);
  const r = await search.searchProducts({ perPage: 30 });
  const flags = r.items.map((i) => i.available);
  assert.deepEqual(flags, [...flags].sort((a, b) => Number(b) - Number(a)));
});

test("правка товара доходит до поиска, скрытый товар исчезает", async (t) => {
  if (!ready) return t.skip(noMeili);
  const p = await prisma.product.findUniqueOrThrow({ where: { sku: "000237651" } });
  await prisma.product.update({ where: { id: p.id }, data: { price: 1234 } });
  await search.reindexProducts([p.id]);
  assert.equal((await search.searchProducts({ q: "000237651" })).items[0].price, 1234);
  await prisma.product.update({ where: { id: p.id }, data: { visible: false } });
  await search.reindexProducts([p.id]);
  assert.equal((await search.searchProducts({ q: "000237651" })).total, 0);
  assert.equal((await search.searchStats()).documents, 18);
});

test("«Нераспределённые» покупателям не показываются, после переноса в категорию появляются", async (t) => {
  if (!ready) return t.skip(noMeili);
  await prisma.category.upsert({ where: { id: "unsorted" }, update: {}, create: { id: "unsorted", nameUk: "Нерозподілені", nameRu: "Нераспределённые", sort: 999 } });
  const p = await prisma.product.findFirstOrThrow({ where: { visible: true } });
  await prisma.product.update({ where: { id: p.id }, data: { categoryId: "unsorted" } });
  await search.reindexProducts([p.id]);
  assert.equal((await search.searchProducts({ q: p.sku })).total, 0);
  await prisma.product.update({ where: { id: p.id }, data: { categoryId: "acc" } });
  await search.reindexProducts([p.id]);
  assert.equal((await search.searchProducts({ q: p.sku })).items[0]?.id, p.id);
});

test("пометка «поиск отстаёт»: ставится при сбое и снимается пересборкой", async (t) => {
  if (!ready) return t.skip(noMeili);
  await search.reindexSafely(async () => {
    throw new Error("Meili лежит");
  });
  assert.equal(await search.isSearchStale(), true);
  await search.reindexAll();
  assert.equal(await search.isSearchStale(), false);
});
