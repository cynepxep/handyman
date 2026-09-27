// Кабинет покупателя (Этап 5, шаг 5.5) на базе handyman_test: общая корзина, «Обране», «Мій інструмент», перенос при слиянии карточек.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let cab: typeof import("../src/cabinet");
let clients: typeof import("../src/clients");

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  cab = await import("../src/cabinet");
  clients = await import("../src/clients");
  await prisma.category.createMany({
    data: [
      { id: "el-kutovi-shlifuvalni-mashyny", nameUk: "Кутові шліфувальні машини", nameRu: "УШМ", parentId: "el" },
      { id: "acc-dysky-vidrizni-po-metalu", nameUk: "Диски відрізні", nameRu: "Диски", parentId: "acc" },
    ],
  });
  const mk = (sku: string, categoryId: string, nameUk: string, attrs: Array<[string, string]> = []) =>
    prisma.product.create({ data: { sku, nameUk, nameRu: nameUk, price: 1000, categoryId, attributes: { create: attrs.map(([key, value], sort) => ({ key, value, sort })) } } });
  await mk("T-GRIND", "el-kutovi-shlifuvalni-mashyny", "Кутова шліфмашина 125", [["Діаметр диска, мм", "125"]]);
  await mk("T-DISC", "acc-dysky-vidrizni-po-metalu", "Диск відрізний 125");
  await mk("T-DISC2", "acc-dysky-vidrizni-po-metalu", "Диск відрізний 230");
  ready = true;
});

after(async () => {
  if (ready) await prisma.$disconnect();
  cleanup();
});

test("общая корзина: первый вход объединяет, потом Mini App и сайт видят одно и то же, пустая корзина тоже сохраняется", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const c = await prisma.client.create({ data: { phone: "+380935550501" } });
  // сайт: гость положил товар, вошёл
  const site1 = await cab.syncCart(c.id, { local: [{ sku: "T-DISC", qty: 2 }], baseVersion: 0, dirty: true });
  assert.deepEqual(site1, { lines: [{ sku: "T-DISC", qty: 2 }], version: 1 });
  // Mini App (другой браузер, пустой): просто получает корзину
  const app1 = await cab.syncCart(c.id, { local: [], baseVersion: 0, dirty: false });
  assert.deepEqual(app1, site1);
  // в Mini App добавил второй товар
  const app2 = await cab.syncCart(c.id, { local: [{ sku: "T-DISC", qty: 2 }, { sku: "T-DISC2", qty: 1 }], baseVersion: 1, dirty: true });
  assert.equal(app2?.version, 2);
  // сайт ничего не менял — получает корзину из Mini App
  assert.deepEqual((await cab.syncCart(c.id, { local: [{ sku: "T-DISC", qty: 2 }], baseVersion: 1, dirty: false }))?.lines.map((l) => l.sku), ["T-DISC", "T-DISC2"]);
  // оформил заказ на сайте → корзина пуста везде
  const done = await cab.syncCart(c.id, { local: [], baseVersion: 2, dirty: true });
  assert.deepEqual(done, { lines: [], version: 3 });
  assert.deepEqual(await cab.getCart(c.id), { lines: [], version: 3 });
  assert.equal(await cab.syncCart("нет-такого", { local: [], baseVersion: 0, dirty: true }), null);
});

test("«Обране»: добавить, убрать, перенос из браузера при входе без дублей", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const c = await prisma.client.create({ data: { phone: "+380935550502" } });
  assert.equal(await cab.setFavorite(c.id, "T-DISC", true), true);
  assert.equal(await cab.setFavorite(c.id, "T-DISC", true), true); // повтор — без ошибки
  assert.equal(await cab.setFavorite(c.id, "НЕМА", true), false);
  assert.deepEqual(new Set(await cab.mergeFavorites(c.id, ["T-DISC", "T-DISC2", 42, "НЕМА"])), new Set(["T-DISC", "T-DISC2"]));
  assert.equal((await cab.favoriteSkus(c.id)).length, 2);
  assert.equal(await cab.setFavorite(c.id, "T-DISC", false), true);
  assert.deepEqual(await cab.favoriteSkus(c.id), ["T-DISC2"]);
});

test("«Мій інструмент»: купленный (отправлен) появляется сам, расходник — нет; убрал — не возвращается; отметить можно только инструмент", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const c = await prisma.client.create({ data: { phone: "+380935550503" } });
  const grinder = await prisma.product.findUniqueOrThrow({ where: { sku: "T-GRIND" } });
  const disc = await prisma.product.findUniqueOrThrow({ where: { sku: "T-DISC" } });
  const base = { clientId: c.id, payMode: "PREPAY" as const, subtotal: 2000, total: 2000, dueNow: 200, delivery: "PICKUP" as const };
  await prisma.order.create({ data: { ...base, no: "HM-T501", status: "NEW", items: { create: [{ productId: grinder.id, sku: grinder.sku, name: grinder.nameUk, qty: 1, unitPrice: 1000 }] } } });
  assert.deepEqual(await cab.listTools(c.id), []); // ещё не отправлен
  await prisma.order.update({ where: { no: "HM-T501" }, data: { status: "SHIPPED", items: { create: [{ productId: disc.id, sku: disc.sku, name: disc.nameUk, qty: 3, unitPrice: 100 }] } } });
  const tools = await cab.listTools(c.id);
  assert.deepEqual(tools.map((x) => [x.sku, x.source, x.facets.diameter]), [["T-GRIND", "order", ["125"]]]);
  assert.equal(await cab.isMyTool(c.id, grinder.id), true);
  assert.equal(await cab.setTool(c.id, "T-GRIND", false), true);
  assert.deepEqual(await cab.listTools(c.id), []); // убрал — купленный не возвращается
  assert.equal(await cab.setTool(c.id, "T-DISC", true), false); // расходник — не инструмент
  assert.equal(await cab.setTool(c.id, "T-GRIND", true), true);
  assert.equal((await cab.listTools(c.id)).length, 1);
});

test("слияние карточек (поделился номером в боте): избранное, инструменты и корзина дубля переходят к основной", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const main = await prisma.client.create({ data: { phone: "+380935550504" } });
  const tg = await prisma.client.create({ data: { tgId: 7770504n } });
  await cab.setFavorite(tg.id, "T-DISC2", true);
  await cab.setFavorite(main.id, "T-DISC2", true); // одинаковое — без конфликта
  await cab.setTool(tg.id, "T-GRIND", true);
  await cab.syncCart(tg.id, { local: [{ sku: "T-DISC", qty: 1 }], baseVersion: 0, dirty: true });
  await cab.syncCart(main.id, { local: [{ sku: "T-DISC2", qty: 4 }], baseVersion: 0, dirty: true });
  const r = await clients.linkTelegramPhone({ tgId: 7770504n, phone: "+380935550504" });
  assert.deepEqual(r, { id: main.id, merged: true, created: false });
  assert.deepEqual(await cab.favoriteSkus(main.id), ["T-DISC2"]);
  assert.deepEqual((await cab.listTools(main.id)).map((x) => x.sku), ["T-GRIND"]);
  const cart = await cab.getCart(main.id);
  assert.deepEqual(cart.lines, [{ sku: "T-DISC2", qty: 4 }, { sku: "T-DISC", qty: 1 }]);
  assert.equal(cart.version, 2);
});
