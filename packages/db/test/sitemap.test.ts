// Карта сайта (шаг Л1) на базе handyman_test: в карте только видимые товары и непустые разделы меню, страницы — видимые;
// товары по порядку артикулов кусками; код Search Console — сохранение, отметка «подтверждено», журнал, «Проверка перед запуском».
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let sm: typeof import("../src/sitemap");
let lc: typeof import("../src/launch-check");

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  sm = await import("../src/sitemap");
  lc = await import("../src/launch-check");
  await prisma.category.createMany({ data: [{ id: "unsorted", nameUk: "Нерозподілені", nameRu: "Нераспределённые" }], skipDuplicates: true });
  const site = await import("../src/site-content");
  const { defaultMenuConfig } = await import("@handyman/core/catalog");
  // меню по умолчанию: свой раздел с категорией «ak» (акумуляторний) и пустой раздел с «gr»
  const menu = defaultMenuConfig();
  menu.groups = [
    { id: "g-ak", nameUk: "Акумуляторний", nameRu: "Аккумуляторный", hintUk: "", hintRu: "", quickPick: [], slug: "akumuliatornyi",
      subs: [{ id: "s-ak", nameUk: "Шуруповерти", nameRu: "Шуруповерты", categoryIds: ["ak"], slug: "shurupoverty" }] },
    { id: "g-gr", nameUk: "Садова", nameRu: "Садовая", hintUk: "", hintRu: "", quickPick: [], slug: "sadova",
      subs: [{ id: "s-gr", nameUk: "Газонокосарки", nameRu: "Газонокосилки", categoryIds: ["gr"], slug: "hazonokosarky" }] },
  ];
  menu.tasks = [];
  await site.saveMenuConfig(menu, "тест");
  await prisma.page.createMany({ data: [
    { slug: "dostavka", titleUk: "Доставка", titleRu: "Доставка", bodyUk: "", bodyRu: "" },
    { slug: "draft", titleUk: "Чернетка", titleRu: "", bodyUk: "", bodyRu: "", visible: false },
  ] });
  await prisma.product.createMany({ data: [
    { sku: "B-200", nameUk: "Шуруповерт Б", nameRu: "", price: 1000, categoryId: "ak" },
    { sku: "A-100", nameUk: "Шуруповерт А", nameRu: "", price: 1000, categoryId: "ak" },
    { sku: "C-300", nameUk: "Шуруповерт В", nameRu: "", price: 1000, categoryId: "ak" },
    { sku: "H-1", nameUk: "Схований", nameRu: "", price: 1000, categoryId: "gr", visible: false },
    { sku: "U-1", nameUk: "Нерозподілений", nameRu: "", price: 1000, categoryId: "unsorted" },
  ] });
  ready = true;
});

after(async () => {
  if (ready) {
    await prisma.product.deleteMany({ where: { sku: { in: ["A-100", "B-200", "C-300", "H-1", "U-1"] } } });
    await prisma.page.deleteMany({ where: { slug: { in: ["dostavka", "draft"] } } });
    await prisma.setting.deleteMany({ where: { key: { in: ["storefront.menu", "site.searchConsole"] } } });
    await prisma.$disconnect();
  }
  cleanup();
});

test("карта: разделы с видимыми товарами, видимые страницы; товары — видимые, без «Нераспределённых», по артикулу", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const base = await sm.loadSitemapBase();
  // «Садова» пуста: единственный её товар скрыт
  assert.deepEqual(base.pages.map((p) => p.path), ["/", "/catalog", "/catalog/akumuliatornyi", "/catalog/akumuliatornyi/shurupoverty", "/info/dostavka"]);
  assert.equal(base.products, 3);
  const all = await sm.loadSitemapProducts(0, 10);
  assert.deepEqual(all.map((p) => p.sku), ["A-100", "B-200", "C-300"]);
  assert.ok(all.every((p) => typeof p.updatedAt === "string" && !Number.isNaN(Date.parse(p.updatedAt!))));
  // куски без пропусков и повторов
  assert.deepEqual([...(await sm.loadSitemapProducts(0, 2)), ...(await sm.loadSitemapProducts(2, 2))].map((p) => p.sku), ["A-100", "B-200", "C-300"]);
  assert.deepEqual(await sm.sitemapStats(), { urls: (5 + 3) * 2, products: 3 });
});

test("Search Console: код и «подтверждено» — в настройке и журнале; новый код снимает отметку; пункты проверки", async (t) => {
  if (!ready) return t.skip(skipMsg);
  await prisma.setting.deleteMany({ where: { key: "site.searchConsole" } });
  await prisma.auditLog.deleteMany({ where: { action: "site.searchConsole" } });
  assert.deepEqual(await lc.loadSearchConsole(), { code: null, verifiedAt: null, by: null });
  let facts = await lc.launchFacts();
  assert.deepEqual(facts.searchConsole, { code: false, verified: false });
  assert.deepEqual(facts.sitemap, { urls: 16, products: 3 });

  const s1 = await lc.saveSearchConsole({ code: "Code-1234567890", verified: false }, "Владелец");
  assert.equal(s1.verifiedAt, null);
  const s2 = await lc.saveSearchConsole({ code: "Code-1234567890", verified: true }, "Владелец");
  assert.ok(s2.verifiedAt);
  // повторное сохранение того же — дата подтверждения не меняется
  assert.equal((await lc.saveSearchConsole({ code: "Code-1234567890", verified: true }, "Владелец")).verifiedAt, s2.verifiedAt);
  facts = await lc.launchFacts();
  assert.deepEqual(facts.searchConsole, { code: true, verified: true });
  const st = Object.fromEntries((await lc.launchCheck()).map((i) => [i.id, i.status]));
  assert.equal(st["search-console"], "ok");
  assert.equal(st.sitemap, "info", "сайт закрыт — карта готова, но Google её не видит");
  // другой код — подтверждать заново
  assert.equal((await lc.saveSearchConsole({ code: "Other-1234567890", verified: true }, "Владелец")).verifiedAt !== s2.verifiedAt, true);
  assert.equal((await lc.saveSearchConsole({ code: "Third-1234567890", verified: false }, "Владелец")).verifiedAt, null);
  assert.equal(await prisma.auditLog.count({ where: { action: "site.searchConsole", who: "Владелец" } }), 5);
  await prisma.auditLog.deleteMany({ where: { action: "site.searchConsole" } });
});
