// Фоновые задачи вместе с сайтом (шаг 4.8): раз в минуту — сводки, напоминания, тревоги (`runJobs`, packages/db/src/jobs.ts).
// Этап 5: бот в Telegram — долгий опрос новых сообщений (и на сервере тоже, шаг 8.5; BOT_WEBHOOK=on — только если вебхук зарегистрирован у Telegram).
// Запускается из instrumentation.ts один раз на процесс. Выключить: HM_WORKER=off (всё) или HM_BOT=off (только чтение бота).
import { hostname } from "node:os";
import { runJobs } from "@handyman/db/jobs";
import { bumpShopGeneration } from "./shop/generation";
import { TelegramError, pollOnce, releaseBotLease } from "@handyman/db/bot";
import { secret } from "@handyman/db/integrations";
import { logError } from "@handyman/db/errors";
import { botOutageFail, botOutageStart, isTransientTelegramFailure } from "@handyman/core/telegram";

const g = globalThis as unknown as { hmWorker?: ReturnType<typeof setInterval>; hmBot?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startWorker(): void {
  if (g.hmWorker || process.env.HM_WORKER === "off") return;
  const tick = () =>
    runJobs()
      .then((r) => {
        if (r.menu > 0) bumpShopGeneration(); // меню разложено фоновой задачей — витрина сразу покажет новые разделы
        if (r.daily || r.weekly || r.reminders || r.alerts || r.retried) console.info("[worker]", JSON.stringify(r));
      })
      .catch((e) => logError("[worker]", e instanceof Error ? e.message : e));
  setTimeout(tick, 20_000); // первый запуск — когда сайт уже поднялся
  g.hmWorker = setInterval(tick, 60_000);
  console.info("[worker] фоновые задачи запущены (раз в минуту)");
  startBot();
}

/**
 * Чтение бота (getUpdates). Только одна копия сайта читает (аренда в базе); при конфликте с другой программой — пауза.
 * Токен бота может появиться позже (владелец вписал его в «Интеграциях») — тогда чтение начнётся само, без перезапуска.
 */
function startBot(): void {
  if (g.hmBot || process.env.HM_BOT === "off" || process.env.BOT_WEBHOOK === "on") return;
  g.hmBot = true;
  const owner = `${hostname()}:${process.pid}`;
  const stop = () => void releaseBotLease(owner).catch(() => {});
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let warned = false;
  let outage = botOutageStart(); // кратковременные сбои связи с Telegram — пережидаем молча, в журнал — если дольше 5 минут
  void (async () => {
    await sleep(5_000);
    let reading = false;
    for (;;) {
      try {
        if (!(await secret("telegram.botToken"))) {
          if (reading) console.info("[bot] токен бота убран — чтение остановлено");
          reading = false;
          await sleep(60_000);
          continue;
        }
        if (!reading) console.info("[bot] читаю сообщения бота (долгий опрос)");
        reading = true;
        const n = await pollOnce(owner);
        warned = false;
        if (outage.reported) console.info("[bot] связь с Telegram восстановлена");
        outage = botOutageStart();
        if (n === -1) await sleep(30_000); // читает другая копия сайта
      } catch (e) {
        if (e instanceof TelegramError && e.code === 409) {
          if (!warned) logError("[bot] бота уже читает другая программа (например, старый прототип на том же боте). Жду…");
          warned = true;
          await sleep(60_000);
        } else if (isTransientTelegramFailure(e)) {
          const f = botOutageFail(outage, Date.now());
          outage = f.next;
          const msg = e instanceof Error ? e.message : String(e);
          if (f.report) logError("[bot] Telegram не отвечает больше 5 минут (бот не получает сообщения):", msg);
          else console.warn("[bot] сбой связи с Telegram, повтор:", msg);
          await sleep(f.waitMs);
        } else {
          logError("[bot]", e instanceof Error ? e.message : e);
          await sleep(10_000);
        }
      }
    }
  })();
}
