// Отдельный запуск бота (профиль docker «full» или `pnpm --filter bot dev`), если сайт запущен без фоновых задач (HM_WORKER=off).
// Обычно бот читается прямо из сайта (apps/web/lib/worker.ts) — тогда эту программу запускать не нужно: две копии поделят «аренду» и не помешают.
import { hostname } from "node:os";
import { TelegramError, pollOnce, releaseBotLease } from "@handyman/db/bot";

const owner = `bot:${hostname()}:${process.pid}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
process.once("SIGINT", () => void releaseBotLease(owner).finally(() => process.exit(0)));

async function main() {
  if (!process.env.BOT_TOKEN?.trim()) {
    console.error("[bot] нет BOT_TOKEN в .env — нечего запускать");
    process.exit(1);
  }
  console.info("[bot] читаю сообщения бота");
  for (;;) {
    try {
      if ((await pollOnce(owner)) === -1) await sleep(30_000);
    } catch (e) {
      console.error("[bot]", e instanceof Error ? e.message : e);
      await sleep(e instanceof TelegramError && e.code === 409 ? 60_000 : 10_000);
    }
  }
}
void main();
