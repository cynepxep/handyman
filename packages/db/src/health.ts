// «Здоровье» сайта (шаг 8.2): база, поиск, когда последний раз отработали фоновые задачи, место на диске, последняя удачная копия (8.1),
// ошибки за сутки. Для `/api/health` (внешний сторож — только «ok/error») и блока «Здоровье сайта» на главной админки.
// Каждая проверка — с коротким ожиданием: сторож не должен ждать минуту, если что-то зависло.
import { statfs } from "node:fs/promises";
import { prisma } from "./client";
import {
  HEALTH_LABEL_RU, backupLevel, diskLevel, healthStatus, jobsLevel, telegramHealth, type HealthCheck, type HealthLevel,
} from "@handyman/core/errors";
import { formatBytes } from "@handyman/core/backups";
import { backupDir, listBackups } from "./backups";
import { errorSummary } from "./errors";
import { projectRoot, secret } from "./integrations";

export const JOBS_LAST_RUN_KEY = "worker.lastRun";

/** Отметка «фоновые задачи отработали» — из runJobs раз в минуту. */
export async function markJobsRun(now = new Date()): Promise<void> {
  const value = { at: now.toISOString() };
  await prisma.setting.upsert({ where: { key: JOBS_LAST_RUN_KEY }, create: { key: JOBS_LAST_RUN_KEY, value }, update: { value } });
}

export async function jobsLastRun(): Promise<Date | null> {
  const v = (await prisma.setting.findUnique({ where: { key: JOBS_LAST_RUN_KEY } }))?.value as { at?: string } | null | undefined;
  return v?.at ? new Date(v.at) : null;
}

/** Промис с пределом времени: не успел — ошибка «не отвечает». */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`не ответил за ${ms / 1000} с`)), ms).unref?.())]);
}

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
function ago(d: Date, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  return m < 1 ? "только что" : m < 60 ? `${m} мин назад` : m < 2880 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн. назад`;
}

export type HealthReport = { status: "ok" | "error"; at: string; checks: Array<HealthCheck & { label: string }> };

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Для тестов: подменить сеть (проверка поиска). */
export const setHealthFetch = (f: Fetch | null) => {
  fetchImpl = f ?? ((...a) => fetch(...a));
};

export async function healthReport(now = new Date()): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const add = (key: HealthCheck["key"], level: HealthLevel, text: string) => checks.push({ key, level, text });

  // база
  let dbOk = false;
  try {
    const t0 = Date.now();
    await within(prisma.$queryRaw`select 1`, 3000);
    dbOk = true;
    add("db", "ok", `отвечает (${Date.now() - t0} мс)`);
  } catch (e) {
    add("db", "bad", `не отвечает: ${e instanceof Error ? e.message.split("\n")[0].slice(0, 120) : "ошибка"}`);
  }

  // поиск (Meilisearch)
  try {
    const host = (process.env.MEILI_HOST ?? "http://localhost:7700").replace(/\/$/, "");
    const r = await fetchImpl(`${host}/health`, { signal: AbortSignal.timeout(3000) });
    const j = (await r.json().catch(() => null)) as { status?: string } | null;
    if (r.ok && j?.status === "available") add("search", "ok", "отвечает");
    else add("search", "bad", `отвечает с ошибкой (${r.status})`);
  } catch {
    add("search", "bad", "не отвечает — поиск и каталог на сайте не работают");
  }

  // фоновые задачи
  if (dbOk) {
    const workerOff = process.env.HM_WORKER === "off";
    const last = await jobsLastRun().catch(() => null);
    const level = jobsLevel(last, now, workerOff);
    add("jobs", level, workerOff ? "выключены в этой копии сайта (HM_WORKER=off)" : last ? `последний раз ${ago(last, now)}` : "ещё ни разу не запускались");
  }

  // место на диске (там, где лежат копии; это же диск проекта, если BACKUP_DIR не задан)
  try {
    const dir = await firstExisting([backupDir(), projectRoot()]);
    const s = await statfs(/*turbopackIgnore: true*/ dir);
    const free = Number(s.bavail) * Number(s.bsize);
    const total = Number(s.blocks) * Number(s.bsize);
    add("disk", diskLevel(free, total), `свободно ${formatBytes(free)} из ${formatBytes(total)}${total ? ` (${Math.round((free / total) * 100)} %)` : ""}`);
  } catch (e) {
    add("disk", "warn", `не удалось узнать: ${e instanceof Error ? e.message.slice(0, 80) : "ошибка"}`);
  }

  // последняя удачная копия (8.1)
  try {
    const list = await within(listBackups(), 5000);
    const ok = list.find((b) => b.state === "ok");
    const at = ok?.manifest?.finishedAt ? new Date(ok.manifest.finishedAt) : null;
    add("backup", backupLevel(at, now), at ? `последняя ${when(at)} (${ago(at, now)})` : "копий ещё нет");
  } catch (e) {
    add("backup", "warn", `не удалось проверить: ${e instanceof Error ? e.message.slice(0, 80) : "ошибка"}`);
  }

  // ошибки за сутки
  if (dbOk) {
    try {
      const s = await errorSummary(now);
      add("errors", s.newDay ? "warn" : "ok", s.activeDay ? `видов ошибок: ${s.activeDay}, из них новых: ${s.newDay}; открыто всего: ${s.open}` : `нет (открыто всего: ${s.open})`);
    } catch {
      /* таблицы может не быть до миграции */
    }
  }

  // сообщения в Telegram (новые заказы, «Передзвоніть мені»): настроены ли и ушло ли последнее
  if (dbOk) {
    try {
      const [token, chat, last, sentDay] = await Promise.all([
        secret("telegram.botToken"),
        secret("telegram.adminChatId"),
        prisma.outbox.findFirst({ where: { audience: "manager", state: { in: ["SENT", "FAILED"] } }, orderBy: { createdAt: "desc" }, select: { state: true, error: true } }),
        prisma.outbox.count({ where: { audience: "manager", state: "SENT", createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } }),
      ]);
      const r = telegramHealth({ token: Boolean(token), chat: Boolean(chat), last, sentDay });
      add("telegram", r.level, r.text);
    } catch {
      /* ключи не читаются — не мешаем остальным проверкам */
    }
  }

  return { status: healthStatus(checks), at: now.toISOString(), checks: checks.map((c) => ({ ...c, label: HEALTH_LABEL_RU[c.key] })) };
}

async function firstExisting(dirs: string[]): Promise<string> {
  for (const d of dirs) {
    try {
      await statfs(/*turbopackIgnore: true*/ d);
      return d;
    } catch {
      /* следующая */
    }
  }
  return process.cwd();
}
