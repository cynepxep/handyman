// Фоновые задачи (шаг 4.8): раз в минуту `runJobs()` смотрит, что пора сделать — ежедневная сводка, отчёт по понедельникам,
// напоминания по задачам, тревоги (импорт не прошёл, продажи упали), повтор неудачных сообщений. Запускается вместе с сайтом
// (apps/web/instrumentation.ts). «Один раз» гарантирует база: отметка `job:<ключ>` в Setting — даже при нескольких копиях сайта.

import { prisma, Prisma } from "./client";
import {
  NOTIFY_SETTING_KEY, dailyDue, deltaText, kyivClock, normalizeNotify, periodRange, salesDropped, weeklyDue, type NotifySettings,
} from "@handyman/core/shop";
import { notifyManagers, retryOutbox } from "./notify";
import { salesReport, productsReport } from "./reports";
import { lowStockList } from "./stock";

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} ₴`;

export async function loadNotify(): Promise<NotifySettings> {
  return normalizeNotify((await prisma.setting.findUnique({ where: { key: NOTIFY_SETTING_KEY } }))?.value);
}

export async function saveNotify(raw: unknown, who: string): Promise<NotifySettings> {
  const v = normalizeNotify(raw);
  await prisma.setting.upsert({ where: { key: NOTIFY_SETTING_KEY }, update: { value: v as unknown as Prisma.InputJsonValue }, create: { key: NOTIFY_SETTING_KEY, value: v as unknown as Prisma.InputJsonValue } });
  await prisma.auditLog.create({ data: { who, action: "notify.settings", details: v as unknown as Prisma.InputJsonValue } });
  return v;
}

/** Занять задачу «один раз»: true — мы первые (делаем), false — уже сделано. */
export async function claimOnce(key: string): Promise<boolean> {
  try {
    await prisma.setting.create({ data: { key: `job:${key}`, value: { at: new Date().toISOString() } } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

// ---------- тексты ----------

/** Текст ежедневной сводки за день по Киеву (сегодня — если `ymd` не задан). */
export async function dailySummaryText(s: NotifySettings, ymd?: string): Promise<string> {
  const day = ymd ?? kyivClock().ymd;
  const p = periodRange({ period: "custom", from: day, to: day });
  const weekAgo = new Date(Date.parse(`${day}T12:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10);
  const [today, lastWeek, action, low, overdue, hitsOut] = await Promise.all([
    salesReport(p),
    salesReport(periodRange({ period: "custom", from: weekAgo, to: weekAgo })),
    prisma.order.count({ where: { isTest: false, status: { in: ["NEW", "NO_ANSWER", "AWAITING_SUPPLIER"] } } }),
    lowStockList(5),
    prisma.task.count({ where: { done: false, dueAt: { lt: new Date() } } }),
    prisma.product.findMany({ where: { isHit: true, visible: true, supplierAvailable: false, stockItems: { none: { onHand: { gt: 0 } } } }, select: { nameUk: true }, take: 5 }),
  ]);
  const c = today.cur;
  const lines = [
    `📊 Сводка за ${day.slice(8, 10)}.${day.slice(5, 7)}`,
    `Заказов: ${c.sold}${deltaText(c.sold, today.prev.sold) ? ` (вчера ${today.prev.sold})` : ""}${lastWeek.cur.sold ? `, неделю назад ${lastWeek.cur.sold}` : ""}`,
    s.showMoney ? `Продажи: ${money(c.revenue)} ${deltaText(c.revenue, today.prev.revenue) && `(${deltaText(c.revenue, today.prev.revenue)} ко вчера)`}${c.avg ? ` · средний чек ${money(c.avg)}` : ""}` : "",
    `Новых покупателей: ${c.newClients}, повторных: ${c.repeatClients}${c.lost ? ` · отмен: ${c.lost}` : ""}`,
    action ? `⏳ Ждут действия: ${action} заказ.` : "✅ Все заказы в работе",
    overdue ? `⏰ Просроченных задач: ${overdue}` : "",
    low.length ? `📦 Заканчиваются: ${low.map((l) => `${l.name} (${l.available})`).join("; ")}` : "",
    hitsOut.length ? `⚠️ Хиты закончились (нет ни у нас, ни у поставщика): ${hitsOut.map((h) => h.nameUk).join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Отчёт за прошлую неделю (пн–вс по Киеву). */
export async function weeklyReportText(s: NotifySettings, now = new Date()): Promise<string> {
  const c = kyivClock(now);
  const lastSun = new Date(Date.parse(`${c.ymd}T12:00:00Z`) - (c.weekday + 1) * 86400_000).toISOString().slice(0, 10);
  const lastMon = new Date(Date.parse(`${lastSun}T12:00:00Z`) - 6 * 86400_000).toISOString().slice(0, 10);
  const p = periodRange({ period: "custom", from: lastMon, to: lastSun });
  const [sales, prods] = await Promise.all([salesReport(p), productsReport(p, { top: 5 })]);
  const x = sales.cur;
  const src = sales.bySource.map((b) => `${b.key === "one_click" ? "1 клик" : b.key === "manual" ? "по звонку" : b.key === "site" ? "сайт" : b.key} ${b.count}`).join(", ");
  return [
    `🗓 Неделя ${lastMon.slice(8, 10)}.${lastMon.slice(5, 7)}–${lastSun.slice(8, 10)}.${lastSun.slice(5, 7)}`,
    `Заказов: ${x.sold} (${deltaText(x.sold, sales.prev.sold) || "—"} к прошлой неделе)`,
    s.showMoney ? `Продажи: ${money(x.revenue)} (${deltaText(x.revenue, sales.prev.revenue) || "—"}), средний чек ${money(x.avg)}` : "",
    `Новых покупателей: ${x.newClients}, повторных: ${x.repeatClients}${x.lost ? `, отмен: ${x.lost}` : ""}`,
    src ? `Откуда: ${src}` : "",
    prods.byQty.length ? `Топ: ${prods.byQty.map((t, i) => `${i + 1}) ${t.name} — ${t.qty} шт.`).join("; ")}` : "",
    prods.staleCounts.d30 ? `На складе без продаж 30+ дней: ${prods.staleCounts.d30} товаров` : "",
  ].filter(Boolean).join("\n");
}

// ---------- запуск ----------

export type JobsReport = { daily: boolean; weekly: boolean; reminders: number; alerts: number; retried: number };

/** Сделать всё, что пора. Ошибка одной задачи не мешает остальным (пишется в консоль). */
export async function runJobs(now = new Date()): Promise<JobsReport> {
  const rep: JobsReport = { daily: false, weekly: false, reminders: 0, alerts: 0, retried: 0 };
  const s = await loadNotify();
  const c = kyivClock(now);
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[jobs] ${name}:`, e instanceof Error ? e.message : e);
    }
  };

  await step("daily", async () => {
    if (dailyDue(s, now) && (await claimOnce(`daily:${c.ymd}`))) {
      let text = await dailySummaryText(s, c.ymd);
      if (s.alerts) {
        // тревога «продажи упали»: сравниваем с теми же днями недели за 4 прошлые недели
        const counts = await Promise.all([1, 2, 3, 4].map(async (w) => {
          const d = new Date(Date.parse(`${c.ymd}T12:00:00Z`) - w * 7 * 86400_000).toISOString().slice(0, 10);
          return (await salesReport(periodRange({ period: "custom", from: d, to: d }))).cur.sold;
        }));
        const todaySold = (await salesReport(periodRange({ period: "custom", from: c.ymd, to: c.ymd }))).cur.sold;
        const drop = salesDropped(todaySold, counts);
        if (drop.dropped) text += `\n🔻 Продажи ниже обычного на ${drop.pct}% (обычно по этим дням ~${drop.avg} заказ.)`;
      }
      await notifyManagers(text);
      rep.daily = true;
    }
  });

  await step("weekly", async () => {
    if (weeklyDue(s, now) && (await claimOnce(`weekly:${c.isoWeek}`))) {
      await notifyManagers(await weeklyReportText(s, now));
      rep.weekly = true;
    }
  });

  await step("reminders", async () => {
    if (!s.taskReminders) return;
    const due = await prisma.task.findMany({ where: { done: false, notifiedAt: null, dueAt: { lte: now } }, take: 20, orderBy: { dueAt: "asc" } });
    for (const t of due) {
      // отметка до отправки: при сбое повторно не заспамим
      const upd = await prisma.task.updateMany({ where: { id: t.id, notifiedAt: null }, data: { notifiedAt: now } });
      if (!upd.count) continue;
      const order = t.orderId ? await prisma.order.findUnique({ where: { id: t.orderId }, select: { no: true } }) : null;
      await notifyManagers(`⏰ Напоминание${t.assignee ? ` для ${t.assignee}` : ""}: ${t.title}${order ? ` (заказ ${order.no})` : ""}`, t.orderId ?? undefined);
      rep.reminders++;
    }
  });

  await step("alerts", async () => {
    if (!s.alerts) return;
    const failed = await prisma.importRun.findMany({ where: { status: "FAILED", finishedAt: { gte: new Date(now.getTime() - 24 * 3600_000) } }, select: { id: true, error: true } });
    for (const r of failed) {
      if (!(await claimOnce(`alert:import:${r.id}`))) continue;
      await notifyManagers(`❗ Загрузка каталога не прошла: ${(r.error ?? "неизвестная ошибка").slice(0, 200)}. Откройте «Импорт» в админке.`);
      rep.alerts++;
    }
  });

  await step("retry", async () => {
    // сообщения, которые не ушли из-за сбоя сети/Telegram: до 3 попыток, не чаще раза в 5 минут
    const stuck = await prisma.outbox.findMany({ where: { state: "FAILED", attempts: { lt: 3 }, createdAt: { lte: new Date(now.getTime() - 5 * 60_000), gte: new Date(now.getTime() - 24 * 3600_000) } }, take: 10 });
    for (const m of stuck) if ((await retryOutbox(m.id)) === "SENT") rep.retried++;
  });

  return rep;
}
