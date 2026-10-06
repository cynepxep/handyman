// Автораскладка разделов по меню после загрузки каталога (runJobs → autoPlaceMenu).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, waitDone, cleanup, skipMsg, file } from "./helpers";

let ready = false;
let prisma: typeof import("../src/client").prisma;
let s: Awaited<ReturnType<typeof setupTestDb>> & { ok: true };

/** Каталог нового поставщика: серия › раздел, как у Milwaukee. */
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="2026-10-06"><shop><currency id="UAH" rate="1"/>
<categories><category id="1">Акумуляторний інструмент</category><category id="2" parentId="1">M18</category>
<category id="3" parentId="2">Гайковерти</category><category id="4" parentId="1">M12</category><category id="5" parentId="4">Акумуляторні гайковерти</category>
<category id="6">Оснастка</category><category id="7" parentId="6">Свердла по металу</category><category id="8">Різне</category><category id="9" parentId="8">Шоломи</category></categories>
<offers>
  <offer id="1" available="true"><vendorCode>MA-1</vendorCode><name>Гайковерт M18</name><price>9000</price><categoryId>3</categoryId><vendor>Milwaukee</vendor></offer>
  <offer id="2" available="true"><vendorCode>MA-2</vendorCode><name>Гайковерт M12</name><price>6000</price><categoryId>5</categoryId><vendor>Milwaukee</vendor></offer>
  <offer id="3" available="true"><vendorCode>MA-3</vendorCode><name>Свердло 6 мм</name><price>90</price><categoryId>7</categoryId><vendor>Milwaukee</vendor></offer>
  <offer id="4" available="true"><vendorCode>MA-4</vendorCode><name>Шолом</name><price>900</price><categoryId>9</categoryId><vendor>Milwaukee</vendor></offer>
</offers></shop></yml_catalog>`;

before(async () => {
  const r = await setupTestDb();
  if (!r.ok) return;
  s = r as typeof s;
  prisma = r.prisma;
  ready = true;
});

after(async () => {
  if (prisma) {
    await prisma.setting.deleteMany({ where: { OR: [{ key: "storefront.menu" }, { key: { startsWith: "job:menu-auto:" } }] } });
    await prisma.$disconnect();
  }
  cleanup();
});

test("после загрузки каталога runJobs сам раскладывает разделы по меню (один раз на загрузку) и сообщает менеджерам", async (t) => {
  if (!ready) return t.skip(skipMsg);
  const jobs = await import("../src/jobs");
  const sup = await import("../src/suppliers");
  const { loadMenuConfig } = await import("../src/site-content");
  const { lostCategories, assignCategories } = await import("@handyman/core/catalog");
  const milId = await sup.createSupplier({ name: `Milwaukee ${Date.now()}`, defaultBrand: "Milwaukee" });
  const runId = await s.imp.startPreview({ supplierId: milId, source: file(feed), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  assert.equal((await waitDone(s.imp, runId)).status, "DONE");

  const outboxBefore = await prisma.outbox.count();
  process.env.HM_MENU_AUTO = "on";
  try {
    const rep = await jobs.runJobs(new Date());
    assert.ok(rep.menu >= 3, `разложено ${rep.menu}`);
    const again = await jobs.runJobs(new Date());
    assert.equal(again.menu, 0, "второй раз на ту же загрузку не запускается");
  } finally {
    process.env.HM_MENU_AUTO = "off";
  }
  const cfg = await loadMenuConfig();
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true } });
  const counts = await prisma.product.groupBy({ by: ["categoryId"], where: { visible: true }, _count: { _all: true } });
  const lost = lostCategories(cats, new Map(counts.map((c) => [c.categoryId, c._count._all])), cfg);
  const prod = async (sku: string) => (await prisma.product.findUniqueOrThrow({ where: { sku } })).categoryId;
  const { subOf } = assignCategories(cats, cfg.groups);
  // гайковерты M18 и M12 — в одной новой подгруппе аккумуляторного инструмента, свёрла — в «Свердла по металу»
  assert.equal(subOf.get(await prod("MA-1")), subOf.get(await prod("MA-2")));
  const cordless = cfg.groups.find((g) => g.id === "cordless")!;
  const sub1 = subOf.get(await prod("MA-1"));
  assert.ok(cordless.subs.some((x) => x.id === sub1 && x.nameUk === "Гайковерти"));
  assert.equal(subOf.get(await prod("MA-3")), "drills-metal");
  // «Шоломи» подобрать не по чему — остаются владельцу
  const lostIds = lost.map((l) => l.id);
  assert.ok(lostIds.includes(await prod("MA-4")));
  for (const sku of ["MA-1", "MA-2", "MA-3"]) assert.ok(!lostIds.includes(await prod(sku)), `${sku} в меню`);
  const msg = await prisma.outbox.findFirst({ where: { text: { contains: "разложены по меню" } }, orderBy: { createdAt: "desc" } });
  assert.ok(msg && (await prisma.outbox.count()) > outboxBefore, "сообщение менеджерам");
  assert.match(msg!.text, /Не удалось подобрать: \d+/);
});
