// Фоновые задачи вместе с сайтом (шаг 4.8): раз в минуту — сводки, напоминания, тревоги (`runJobs`, packages/db/src/jobs.ts).
// Запускается из instrumentation.ts один раз на процесс. Выключить: HM_WORKER=off (например, для второй копии сайта на время проверки).
import { runJobs } from "@handyman/db/jobs";

const g = globalThis as unknown as { hmWorker?: ReturnType<typeof setInterval> };

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
}
