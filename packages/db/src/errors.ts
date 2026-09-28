// Журнал ошибок (шаг 8.2): запись ошибок сайта в таблицу ErrorLog группами (одинаковые — одна строка со счётчиком),
// раздел «Ошибки» в админке, тревога в Telegram (новая группа или всплеск ≥ 20 за 10 минут, не чаще раза в час на группу) и чистка
// старше 30 дней — из runJobs. Тексты маскируются до записи (core/src/errors.ts): токены, телефоны, имена и адреса покупателей не хранятся.
//
// `logError(...)` — замена `console.error(...)` в модулях внешних сервисов и фоновых задач: пишет и в консоль (как раньше), и в журнал.
// Запись никогда не бросает ошибку и не ждёт базу: журнал не должен ломать то, что он записывает.

import { prisma } from "./client";
import {
  ERROR_KEEP_DAYS, ERROR_SPIKE, alertReason, alertText, isErrorSource, makeErrorEntry, parseLogArgs, type ErrorEntry, type ErrorSource,
} from "@handyman/core/errors";

const g = globalThis as unknown as {
  hmErrWrites?: Set<Promise<void>>;
  hmErrPending?: Map<string, { entry: ErrorEntry; extra: number; timer: ReturnType<typeof setTimeout> | null; lastWrite: number }>;
  hmErrNewBrowser?: { hour: number; n: number };
};
const writes = (g.hmErrWrites ??= new Set());
const pending = (g.hmErrPending ??= new Map());

/** Одна и та же ошибка пишется в базу не чаще раза в секунду (остальные — прибавляются к счётчику следующей записью). */
const COALESCE_MS = 1000;
/** Новых групп из браузера — не больше 300 в час на копию сайта (защита от мусора и ботов). */
const BROWSER_NEW_PER_HOUR = 300;

export type ErrorInput = {
  source: ErrorSource;
  where?: string;
  error?: unknown;
  message?: string;
  stack?: string;
  url?: string | null;
  digest?: string | null;
};

/** Записать ошибку в журнал (в фоне). Дождаться записи — `errorsSettled()` (тесты). */
export function recordError(p: ErrorInput, now = new Date()): void {
  let entry: ErrorEntry;
  try {
    entry = makeErrorEntry(p);
  } catch (e) {
    console.error("[errors] не разобрал ошибку:", e instanceof Error ? e.message : e);
    return;
  }
  const slot = pending.get(entry.fingerprint);
  if (slot && now.getTime() - slot.lastWrite < COALESCE_MS) {
    // только что писали — прибавим к следующей записи
    slot.extra++;
    slot.entry = entry;
    if (!slot.timer) {
      slot.timer = setTimeout(() => flush(entry.fingerprint), COALESCE_MS);
      slot.timer.unref?.();
    }
    return;
  }
  // прошло больше секунды: пишем сейчас вместе с накопленными
  if (slot?.timer) clearTimeout(slot.timer);
  pending.set(entry.fingerprint, { entry, extra: 0, timer: null, lastWrite: now.getTime() });
  track(write(entry, 1 + (slot?.extra ?? 0), now));
}

function flush(fp: string): void {
  const slot = pending.get(fp);
  if (!slot || !slot.extra) return;
  const n = slot.extra;
  slot.extra = 0;
  slot.timer = null;
  slot.lastWrite = Date.now();
  track(write(slot.entry, n, new Date()));
}

function track(p: Promise<void>): void {
  writes.add(p);
  void p.finally(() => writes.delete(p));
  // карта «что недавно писали» не должна расти бесконечно
  if (pending.size > 2000) for (const [k, v] of pending) if (!v.timer && Date.now() - v.lastWrite > 60_000) pending.delete(k);
}

async function write(e: ErrorEntry, n: number, now: Date): Promise<void> {
  try {
    if (e.source === "browser" && !(await browserGroupAllowed(e.fingerprint, now))) return;
    const at = now.toISOString();
    // одна строка на группу; окно «всплеска» — 10 минут от первой ошибки окна; закрытая группа при новом случае открывается снова
    await prisma.$executeRaw`
      INSERT INTO "ErrorLog" ("id", "fingerprint", "source", "where", "message", "stack", "url", "digest", "count", "firstAt", "lastAt", "windowAt", "windowCount")
      VALUES (gen_random_uuid()::text, ${e.fingerprint}, ${e.source}, ${e.where}, ${e.message}, ${e.stack}, ${e.url}, ${e.digest}, ${n}::int,
              (${at}::timestamptz AT TIME ZONE 'UTC'), (${at}::timestamptz AT TIME ZONE 'UTC'), (${at}::timestamptz AT TIME ZONE 'UTC'), ${n}::int)
      ON CONFLICT ("fingerprint") DO UPDATE SET
        "count" = "ErrorLog"."count" + EXCLUDED."count",
        "lastAt" = GREATEST("ErrorLog"."lastAt", EXCLUDED."lastAt"),
        "message" = EXCLUDED."message",
        "stack" = CASE WHEN EXCLUDED."stack" <> '' THEN EXCLUDED."stack" ELSE "ErrorLog"."stack" END,
        "url" = CASE WHEN EXCLUDED."url" <> '' THEN EXCLUDED."url" ELSE "ErrorLog"."url" END,
        "digest" = CASE WHEN EXCLUDED."digest" <> '' THEN EXCLUDED."digest" ELSE "ErrorLog"."digest" END,
        "windowCount" = CASE WHEN "ErrorLog"."windowAt" < EXCLUDED."lastAt" - make_interval(mins => ${ERROR_SPIKE.minutes}::int)
                             THEN EXCLUDED."windowCount" ELSE "ErrorLog"."windowCount" + EXCLUDED."windowCount" END,
        "windowAt" = CASE WHEN "ErrorLog"."windowAt" < EXCLUDED."lastAt" - make_interval(mins => ${ERROR_SPIKE.minutes}::int)
                          THEN EXCLUDED."lastAt" ELSE "ErrorLog"."windowAt" END,
        "reopenedAt" = CASE WHEN "ErrorLog"."closedAt" IS NOT NULL THEN EXCLUDED."lastAt" ELSE "ErrorLog"."reopenedAt" END,
        "closedAt" = NULL,
        "closedBy" = NULL`;
  } catch (err) {
    // база недоступна — ошибка остаётся только в консоли (её увидит «здоровье» и внешний сторож)
    console.error("[errors] не записал в журнал:", err instanceof Error ? err.message.trim().split("\n").pop() : err);
  }
}

async function browserGroupAllowed(fingerprint: string, now: Date): Promise<boolean> {
  const hour = Math.floor(now.getTime() / 3600_000);
  const c = (g.hmErrNewBrowser = g.hmErrNewBrowser?.hour === hour ? g.hmErrNewBrowser : { hour, n: 0 });
  if (c.n < BROWSER_NEW_PER_HOUR) {
    c.n++;
    return true;
  }
  // лимит новых групп исчерпан — пишем только в уже существующие
  return Boolean(await prisma.errorLog.findUnique({ where: { fingerprint }, select: { id: true } }));
}

/** Дождаться всех записей в журнал (тесты, скрипты). */
export async function errorsSettled(): Promise<void> {
  for (const [fp, v] of pending) if (v.timer) {
    clearTimeout(v.timer);
    flush(fp);
  }
  while (writes.size) await Promise.all([...writes]);
}

/** Откуда ошибка по метке «[jobs] …» / «[payments] …»: фоновые задачи, внешний сервис или действие на сайте (заказ, отзыв, импорт). */
function sourceOfTag(where: string): ErrorSource {
  if (/^(jobs|worker|backup)\b/.test(where)) return "jobs";
  if (/^(payments|pay|receipts|keycrm|bot|telegram|novaposhta|integrations|search|media|notify|api)\b/.test(where)) return "service";
  return "action";
}

/**
 * Замена `console.error` в модулях сервисов и фоновых задач: те же аргументы, та же строка в консоли, плюс запись в журнал.
 * Метка в квадратных скобках в начале («[payments] …») становится полем «где».
 */
export function logError(...args: unknown[]): void {
  console.error(...args);
  try {
    const { where, message, stack } = parseLogArgs(args);
    recordError({ source: sourceOfTag(where), where, message, stack });
  } catch {
    /* журнал не должен ломать вызывающий код */
  }
}

// ---------- раздел «Ошибки» ----------

export type ErrorTab = "open" | "closed" | "all";

export async function listErrors(p: { tab?: ErrorTab; source?: string; take?: number } = {}) {
  const tab = p.tab ?? "open";
  const where = {
    ...(tab === "open" ? { closedAt: null } : tab === "closed" ? { closedAt: { not: null } } : {}),
    ...(isErrorSource(p.source) ? { source: p.source } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.errorLog.findMany({ where, orderBy: { lastAt: "desc" }, take: p.take ?? 100 }),
    prisma.errorLog.count({ where }),
  ]);
  return { rows, total };
}

/** Сводка для дашборда и «здоровья»: открытых групп, новых групп за сутки, открытых групп, случавшихся за сутки. */
export async function errorSummary(now = new Date()) {
  const day = new Date(now.getTime() - 24 * 3600_000);
  const [open, newDay, activeDay] = await Promise.all([
    prisma.errorLog.count({ where: { closedAt: null } }),
    prisma.errorLog.count({ where: { firstAt: { gte: day } } }),
    prisma.errorLog.count({ where: { lastAt: { gte: day }, closedAt: null } }),
  ]);
  return { open, newDay, activeDay };
}

/** «Закрыть» группу (разобрались). Если ошибка повторится — группа откроется снова и придёт тревога «новая». */
export async function closeErrors(ids: string[] | "all", who: string, now = new Date()): Promise<number> {
  const where = ids === "all" ? { closedAt: null } : { id: { in: ids }, closedAt: null };
  const r = await prisma.errorLog.updateMany({ where, data: { closedAt: now, closedBy: who } });
  if (r.count) await prisma.auditLog.create({ data: { who, action: "errors.close", details: { count: r.count, all: ids === "all" } } });
  return r.count;
}

/** Открыть закрытую по ошибке группу. */
export async function reopenError(id: string, who: string): Promise<boolean> {
  const r = await prisma.errorLog.updateMany({ where: { id, closedAt: { not: null } }, data: { closedAt: null, closedBy: null } });
  if (r.count) await prisma.auditLog.create({ data: { who, action: "errors.reopen", details: { id } } });
  return r.count > 0;
}

// ---------- из runJobs ----------

/** Удалить группы, которых не было 30 дней. */
export async function pruneErrors(now = new Date()): Promise<number> {
  const r = await prisma.errorLog.deleteMany({ where: { lastAt: { lt: new Date(now.getTime() - ERROR_KEEP_DAYS * 86400_000) } } });
  return r.count;
}

/**
 * Тревога в Telegram (чат менеджеров, как остальные тревоги 4.8): новые группы и всплески. Отметка «тревожили» ставится до отправки —
 * при сбое Telegram повторно не заспамим. Возвращает, о скольких группах сообщили.
 */
export async function alertErrors(send: (text: string) => Promise<unknown>, now = new Date()): Promise<number> {
  const recent = await prisma.errorLog.findMany({
    where: { closedAt: null, lastAt: { gte: new Date(now.getTime() - 2 * 3600_000) } },
    orderBy: { lastAt: "desc" },
    take: 200,
  });
  const due = recent
    .map((r) => ({ r, reason: alertReason(r, now) }))
    .filter((x): x is { r: (typeof recent)[number]; reason: "new" | "spike" } => x.reason !== null);
  if (!due.length) return 0;
  await prisma.errorLog.updateMany({ where: { id: { in: due.map((d) => d.r.id) } }, data: { alertedAt: now } });
  const show = due.slice(0, 5);
  await send(alertText(show.map(({ r, reason }) => ({ reason, source: r.source as ErrorSource, where: r.where, message: r.message, count: r.count, windowCount: r.windowCount })), due.length - show.length));
  return due.length;
}
