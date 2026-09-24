// Полная пересборка поискового индекса из базы: pnpm search:reindex
import { prisma } from "../src/client";
import { reindexAll } from "../src/catalog-search";

async function main() {
  const started = Date.now();
  const { indexed } = await reindexAll();
  console.log(`Поиск пересобран: ${indexed} товаров за ${((Date.now() - started) / 1000).toFixed(1)} с.`);
}

main()
  .catch((e) => {
    console.error("Не удалось пересобрать поиск:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
