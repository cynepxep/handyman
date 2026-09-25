// Редактируемый контент сайта на отдельной базе handyman_test: тексты, контакты, страницы, меню.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

let dbReady = false;
let prisma: typeof import("../src/client").prisma;
let site: typeof import("../src/site-content");

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  ({ prisma } = s);
  site = await import("../src/site-content");
  dbReady = true;
});

after(async () => {
  if (dbReady) await prisma.$disconnect();
  cleanup();
});

const page = (over: Partial<import("../src/site-content").PageInput> = {}) => ({
  titleUk: "Гарантія", titleRu: "Гарантия", bodyUk: "Текст", bodyRu: "Текст", inMenu: true, sort: 10, visible: true, ...over,
});

test("тексты: правка сохраняется и видна только на своём языке, возврат стандартного удаляет её", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const r = await site.saveTextEdits([{ key: "home.title", lang: "uk", value: "  Наш магазин " }], "owner");
  assert.deepEqual(r, { ok: true, saved: 1, reset: 0 });
  const uk = await site.loadSiteContent("uk");
  const ru = await site.loadSiteContent("ru");
  assert.equal(uk.texts["home.title"], "Наш магазин");
  assert.notEqual(ru.texts["home.title"], "Наш магазин");
  assert.equal(await prisma.auditLog.count({ where: { action: "site.texts.edit" } }), 1);

  const back = await site.saveTextEdits([{ key: "home.title", lang: "uk", value: "" }], "owner");
  assert.deepEqual(back, { ok: true, saved: 0, reset: 1 });
  assert.equal(await prisma.textOverride.count(), 0);
  assert.equal((await site.loadSiteContent("uk")).texts["home.title"], "Інструмент і витратні матеріали");
});

test("тексты: нельзя потерять {n}, неизвестные ключи игнорируются", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const bad = await site.saveTextEdits([{ key: "category.shown", lang: "uk", value: "Показано" }], "owner");
  assert.ok(!bad.ok && /\{n\}/.test(bad.error) && /\{total\}/.test(bad.error));
  assert.equal(await prisma.textOverride.count({ where: { key: "category.shown" } }), 0, "ничего не записано");
  const unknown = await site.saveTextEdits([{ key: "нет.такого", lang: "uk", value: "x" }], "owner");
  assert.deepEqual(unknown, { ok: true, saved: 0, reset: 0 });
});

test("контакты: сохраняются и читаются, до заполнения пусто", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  assert.deepEqual((await site.loadContacts()).phones, []);
  const c = { ...(await site.loadContacts()), phones: ["+380 48 123 45 67"], hoursUk: "Пн–Сб 9:00–18:00", telegram: "https://t.me/handyman" };
  await site.saveContacts(c, "owner");
  const back = await site.loadContacts();
  assert.deepEqual(back.phones, ["+380 48 123 45 67"]);
  assert.equal(back.telegram, "https://t.me/handyman");
  assert.equal((await site.loadSiteContent("ru")).contacts.hoursUk, "Пн–Сб 9:00–18:00");
});

test("страницы: создать, изменить, скрыть; неверный и занятый адрес не проходят", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  assert.ok((await site.createPage("Bad Slug!", page(), "owner")).ok === false);
  assert.deepEqual(await site.createPage("warranty", page(), "owner"), { ok: true });
  const dup = await site.createPage("warranty", page(), "owner");
  assert.ok(!dup.ok && /уже есть/.test(dup.error));
  assert.deepEqual(await site.savePage("warranty", page({ titleUk: "Гарантія та повернення", visible: false }), "owner"), { ok: true });
  assert.equal((await site.getPageBySlug("warranty"))?.titleUk, "Гарантія та повернення");
  assert.equal((await site.loadSiteContent("uk")).pages.some((p) => p.slug === "warranty"), false, "скрытая страница не попадает на сайт");
  const noTitle = await site.savePage("warranty", page({ titleRu: "" }), "owner");
  assert.ok(!noTitle.ok);
  const missing = await site.savePage("nope", page(), "owner");
  assert.ok(!missing.ok);
});

test("страницы: стандартные нельзя удалить, свои — можно", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  await site.createPage("delivery", page({ titleUk: "Доставка", titleRu: "Доставка" }), "owner");
  const std = await site.deletePage("delivery", "owner");
  assert.ok(!std.ok && /скрыть/.test(std.error));
  assert.ok(await site.getPageBySlug("delivery"));
  assert.deepEqual(await site.deletePage("warranty", "owner"), { ok: true });
  assert.equal(await site.getPageBySlug("warranty"), null);
});

test("меню: без правок — стандартное; сохранённое читается; сломанное заменяется стандартным; сброс работает", async (t) => {
  if (!dbReady) return t.skip(skipMsg);
  const { defaultMenuConfig } = await import("@handyman/core/catalog");
  assert.equal(await site.hasCustomMenu(), false);
  const base = await site.loadMenuConfig();
  assert.deepEqual(base, defaultMenuConfig());

  base.groups[0].nameUk = "Мої свердла";
  await site.saveMenuConfig(base, "owner");
  assert.equal(await site.hasCustomMenu(), true);
  assert.equal((await site.loadMenuConfig()).groups[0].nameUk, "Мої свердла");
  assert.equal((await site.loadSiteContent("uk")).menu.groups[0].nameUk, "Мої свердла");

  await prisma.setting.update({ where: { key: "storefront.menu" }, data: { value: { groups: "сломано" } } });
  assert.deepEqual(await site.loadMenuConfig(), defaultMenuConfig(), "сайт не падает на сломанных настройках");

  await site.resetMenuConfig("owner");
  assert.equal(await site.hasCustomMenu(), false);
  assert.equal((await site.loadMenuConfig()).groups[0].nameUk, defaultMenuConfig().groups[0].nameUk);
});
