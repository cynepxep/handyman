// Уведомления и фоновые задачи (шаг 4.8): когда что отправлять — чистая логика без базы.

export const NOTIFY_SETTING_KEY = "notify.settings";

export type NotifySettings = {
  daily: boolean; // ежедневная сводка
  dailyHour: number; // во сколько (по Киеву), 0–23
  weekly: boolean; // отчёт в понедельник
  weeklyHour: number;
  taskReminders: boolean; // напоминания по задачам в срок
  alerts: boolean; // тревоги: импорт не прошёл, продажи упали, хит закончился
  showMoney: boolean; // суммы в сводках (чат только для владельца)
};

export const DEFAULT_NOTIFY: NotifySettings = { daily: true, dailyHour: 21, weekly: true, weeklyHour: 9, taskReminders: true, alerts: true, showMoney: true };

const hour = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d;
};

export function normalizeNotify(raw: unknown): NotifySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof NotifySettings, unknown>>;
  const b = (k: keyof NotifySettings) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_NOTIFY[k] as boolean));
  return {
    daily: b("daily"), dailyHour: hour(r.dailyHour, DEFAULT_NOTIFY.dailyHour), weekly: b("weekly"), weeklyHour: hour(r.weeklyHour, DEFAULT_NOTIFY.weeklyHour),
    taskReminders: b("taskReminders"), alerts: b("alerts"), showMoney: b("showMoney"),
  };
}

/** Дата, час и день недели по Киеву (+ номер недели ISO) — чтобы решать, пора ли сводке. */
export function kyivClock(now = new Date()): { ymd: string; hour: number; weekday: number; isoWeek: string } {
  const ymd = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const hourNow = Number(now.toLocaleString("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" }));
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(now.toLocaleDateString("en-GB", { timeZone: "Europe/Kyiv", weekday: "short" }));
  // ISO-неделя: четверг этой недели определяет год
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 3 - weekday);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThu.getTime()) / 86400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return { ymd, hour: hourNow, weekday, isoWeek: `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}` };
}

/** Пора ли ежедневной сводке: включена и уже наступил её час (отправляется один раз в день — это следит база). */
export const dailyDue = (s: NotifySettings, now = new Date()) => s.daily && kyivClock(now).hour >= s.dailyHour;
/** Пора ли недельному отчёту: включён, понедельник, наступил час. */
export const weeklyDue = (s: NotifySettings, now = new Date()) => {
  const c = kyivClock(now);
  return s.weekly && c.weekday === 0 && c.hour >= s.weeklyHour;
};

/** Продажи «упали»: сегодня меньше, чем 60 % от среднего за такие же дни недели (было хотя бы 3 заказа в среднем). */
export function salesDropped(today: number, sameWeekdays: number[]): { dropped: boolean; avg: number; pct: number } {
  const avg = sameWeekdays.length ? sameWeekdays.reduce((a, b) => a + b, 0) / sameWeekdays.length : 0;
  const pct = avg ? Math.round((1 - today / avg) * 100) : 0;
  return { dropped: avg >= 3 && today < avg * 0.6, avg: Math.round(avg * 10) / 10, pct };
}

/** «+12 %» / «−30 %» / «» (не с чем сравнить) — для текста сводки. */
export function deltaText(cur: number, prev: number): string {
  if (!prev) return cur ? "" : "";
  const d = Math.round(((cur - prev) / prev) * 100);
  return d === 0 ? "=" : `${d > 0 ? "+" : "−"}${Math.abs(d)}%`;
}
