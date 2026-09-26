// Фоновые задачи вместе с сайтом (шаг 4.8): раз в минуту — сводки, напоминания, тревоги (`runJobs`, packages/db/src/jobs.ts).
// Этап 5: бот в Telegram — долгий опрос новых сообщений (если не задан вебхук BOT_WEBHOOK=on — это для сервера с доменом, Этап 8).
// Запускается из instrumentation.ts один раз на процесс. Выключить: HM_WORKER=off (всё) или HM_BOT=off (только чтение бота).
import { hostname } from "node:os";
import { runJobs } from "@handyman/db/jobs";
import { TelegramError, pollOnce, releaseBotLease } from "@handyman/db/bot";

const g = globalThis as unknown as { hmWorker?: ReturnType<typeof setInterval>; hmBot?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startWorker(): void {
  if (g.hmWorker || process.env.HM_WORKER === "off") return;
  const tick = () =>
    runJobs()
      .then((r) => {
        if (r.daily || r.weekly || r.reminders || r.alerts || r.retried) console.info("[worker]", JSON.stringify(r));
      })
      .catch((e) => console.error("[worker]", e instanceof Error ? e.message : e));
  setTimeout(tick, 20_000); // первый запуск — когда сайт уже поднялся
  g.hmWorker = setInterval(tick, 60_000);
  console.info("[worker] фоновые задачи запущены (раз в минуту)");
  startBot();
}

/** Чтение бота (getUpdates). Только одна копия сайта читает (аренда в базе); при конфликте с другой программой — пауза. */
function startBot(): void {
  if (g.hmBot || !process.env.BOT_TOKEN?.trim() || process.env.HM_BOT === "off" || process.env.BOT_WEBHOOK === "on") return;
  g.hmBot = true;
  const owner = `${hostname()}:${process.pid}`;
  const stop = () => void releaseBotLease(owner).catch(() => {});
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let warned = false;
  void (async () => {
    await sleep(5_000);
    console.info("[bot] читаю сообщения бота (долгий опрос)");
    for (;;) {
      try {
        const n = await pollOnce(owner);
        warned = false;
        if (n === -1) await sleep(30_000); // читает другая копия сайта
      } catch (e) {
        if (e instanceof TelegramError && e.code === 409) {
          if (!warned) console.error("[bot] бота уже читает другая программа (например, старый прототип на том же боте). Жду…");
          warned = true;
          await sleep(60_000);
        } else {
          console.error("[bot]", e instanceof Error ? e.message : e);
          await sleep(10_000);
        }
      }
    }
  })();
}
