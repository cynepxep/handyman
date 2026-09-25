// Общая подготовка интеграционных тестов: отдельная база handyman_test, миграции, очистка, стартовые категории.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEST_URL = process.env.DATABASE_URL_TEST ?? "postgresql://handyman:handyman@localhost:5432/handyman_test?schema=public";
process.env.DATABASE_URL = TEST_URL; // до загрузки клиента базы
process.env.FEEDS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hm-feeds-"));
process.env.MEILI_INDEX_PRODUCTS = "products_test"; // отдельный поисковый индекс, рабочий не трогаем
// Тесты никогда не пишут в настоящий Telegram, даже если в .env есть токен бота.
process.env.BOT_TOKEN = "";
process.env.ADMIN_CHAT_ID = "";

export const sampleText = fs.readFileSync(path.join(here, "../../core/test/fixtures/vitals-sample.xml"), "utf8");
export const skipMsg = "нет подключения к тестовой базе handyman_test (запустите pnpm infra:up)";

export const file = (text: string) => ({ kind: "file" as const, name: "test.xml", bytes: Buffer.from(text, "utf8") });

export async function setupTestDb() {
  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: path.join(here, ".."), env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: "pipe", shell: true,
    });
    const { prisma } = await import("../src/client");
    const imp = await import("../src/catalog-import");
    const prod = await import("../src/catalog-products");
    await prisma.$queryRaw`select 1`;
    await prisma.$executeRawUnsafe('TRUNCATE "Supplier","Brand","Category","Product","ImportRun","AuditLog","FeedCategoryMap","TextOverride","Page","Setting","Order","Client","Outbox","Warehouse","StockItem" RESTART IDENTITY CASCADE');
    await prisma.category.createMany({
      data: [["ak", "Акумуляторний"], ["el", "Електро"], ["gr", "Садова"], ["hand", "Ручний"], ["acc", "Аксесуари"], ["bld", "Будівельне"], ["pw", "Силова"]]
        .map(([id, n], sort) => ({ id, nameUk: n, nameRu: n, sort })),
    });
    const supplierId = (await imp.ensureDefaultSupplier()).id;
    return { ok: true as const, prisma, imp, prod, supplierId };
  } catch (e) {
    console.warn("Интеграционный тест пропущен:", e instanceof Error ? e.message.split("\n")[0] : e);
    return { ok: false as const };
  }
}

export async function waitDone(imp: typeof import("../src/catalog-import"), runId: string) {
  for (let i = 0; i < 300; i++) {
    const r = await imp.getRun(runId);
    if (r && (r.status === "DONE" || r.status === "FAILED")) return r;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("импорт не завершился за 30 секунд");
}

export function cleanup() {
  fs.rmSync(process.env.FEEDS_DIR!, { recursive: true, force: true });
}
