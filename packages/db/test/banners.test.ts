// Баннеры в базе: создание, правка, выключение, выбор для показа, счёт нажатий.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { validateBannerForm } from "@handyman/core/site";
import { setupTestDb, cleanup, skipMsg } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let banners: typeof import("../src/banners");

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  banners = await import("../src/banners");
  await prisma.banner.deleteMany();
  ready = true;
});

after(async () => {
  if (ready) {
    await prisma.banner.deleteMany();
    await prisma.$disconnect();
  }
  cleanup();
});

const form = (over: Record<string, string>) => {
  const r = validateBannerForm({ placement: "listing", titleUk: "Знижки", href: "/catalog/dysky", active: "on", ...over }, ["disks"]);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

test("баннеры: сохранить, выключить, показать по месту и датам, посчитать нажатия", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const a = await banners.saveBanner(null, form({ name: "Диски", sort: "2", buttonUk: "Дивитись" }), "test");
  const b = await banners.saveBanner(null, form({ placement: "home", titleUk: "Головна" }), "test");
  const future = await banners.saveBanner(null, form({ titleUk: "Скоро", startsAt: "2099-01-01" }), "test");
  const row = await banners.getBanner(a);
  assert.equal(row?.content.buttonUk, "Дивитись");
  assert.equal(row?.settings.everyN, 8);
  assert.equal(row?.content.titleRu, "", "русский заголовок пустой — на сайте возьмётся украинский");

  const all = await banners.activeBanners();
  assert.deepEqual(banners.liveOf(all, "listing").map((x) => x.id), [a], "будущий не показывается");
  assert.deepEqual(banners.liveOf(all, "home").map((x) => x.id), [b]);
  assert.ok(all.some((x) => x.id === future));

  await banners.setBannerActive(a, false, "test");
  assert.equal(banners.liveOf(await banners.activeBanners(), "listing").length, 0);

  assert.equal(await banners.clickBanner(b), "/catalog/dysky");
  assert.equal(await banners.clickBanner(b), "/catalog/dysky");
  assert.equal((await banners.getBanner(b))?.clicks, 2);
  assert.equal(await banners.clickBanner("нет-такого"), null);

  await banners.saveBanner(a, form({ titleUk: "Диски −20%", placement: "product" }), "test");
  assert.equal((await banners.getBanner(a))?.placement, "product");
  await banners.deleteBanner(future, "test");
  assert.equal(await banners.getBanner(future), null);
  assert.ok((await prisma.auditLog.count({ where: { action: { startsWith: "banner." } } })) >= 5, "всё пишется в журнал");
});
