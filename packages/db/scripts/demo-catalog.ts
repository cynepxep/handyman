// Пробный каталог для облачного чата Claude: товары из образца фида (packages/core/test/fixtures/vitals-sample.xml, после правил импорта — 19)
// загружаются в ПУСТУЮ базу обычным импортом (проверка → применение) и попадают в поиск. На компьютере владельца не нужен.
// Запуск: pnpm --filter @handyman/db exec dotenv -e ../../.env -- tsx scripts/demo-catalog.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/client";
import * as imp from "../src/catalog-import";
import { reindexAll } from "../src/catalog-search";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if ((await prisma.product.count()) > 0) {
    console.log("Товары уже есть — пробный каталог не нужен.");
    return;
  }
  const bytes = fs.readFileSync(path.join(here, "../../core/test/fixtures/vitals-sample.xml"));
  await imp.ensureSystemCategories();
  const supplierId = (await imp.ensureDefaultSupplier()).id;
  const runId = await imp.startPreview({ supplierId, source: { kind: "file", name: "vitals-sample.xml", bytes }, who: "demo" });
  await imp.startApply({ runId, approvedSkus: [], who: "demo" });
  for (let i = 0; i < 600; i++) {
    const run = await imp.getRun(runId);
    if (run?.status === "FAILED") throw new Error(run.error ?? "импорт не прошёл");
    if (run?.status === "DONE") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const r = await reindexAll();
  console.log(`Пробный каталог загружен: ${await prisma.product.count()} товаров, в поиске ${r.indexed}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
