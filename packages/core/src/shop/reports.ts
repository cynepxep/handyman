// Отчёты (шаг 4.6) — периоды, сравнение с прошлым периодом, выгрузка CSV для Excel. Чистая логика без базы.

import { kyivDayStart } from "./order-admin";

export type PeriodKind = "today" | "7d" | "30d" | "month" | "custom";

export type Period = { kind: PeriodKind; from: Date; to: Date; prevFrom: Date; prevTo: Date; fromYmd: string; toYmd: string; days: number; label: string };

const ymdKyiv = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ruDay = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;

/**
 * Период отчёта по Киеву: «сегодня», «7 дней», «30 дней», «этот месяц» или свой «с — по».
 * Прошлый период — такой же длины сразу перед ним (для стрелок «▲ 12 %»).
 */
export function periodRange(p: { period?: string; from?: string; to?: string }, now = new Date()): Period {
  const today = ymdKyiv(now);
  let kind: PeriodKind = (["today", "7d", "30d", "month", "custom"] as const).find((k) => k === p.period) ?? "7d";
  let fromYmd: string;
  let toYmd = today;
  if (kind === "custom" && p.from && DATE.test(p.from) && p.to && DATE.test(p.to) && p.from <= p.to) {
    fromYmd = p.from;
    toYmd = p.to;
  } else {
    if (kind === "custom") kind = "7d";
    fromYmd = kind === "today" ? today : kind === "7d" ? addDays(today, -6) : kind === "30d" ? addDays(today, -29) : `${today.slice(0, 7)}-01`;
  }
  const days = Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86400_000) + 1;
  const prevToYmd = addDays(fromYmd, -1);
  const prevFromYmd = addDays(fromYmd, -days);
  const label = kind === "today" ? "сегодня" : kind === "7d" ? "7 дней" : kind === "30d" ? "30 дней" : kind === "month" ? "этот месяц" : `${ruDay(fromYmd)}–${ruDay(toYmd)}`;
  return {
    kind, fromYmd, toYmd, days, label,
    from: kyivDayStart(fromYmd), to: kyivDayStart(toYmd, true), prevFrom: kyivDayStart(prevFromYmd), prevTo: kyivDayStart(prevToYmd, true),
  };
}

/** Все дни периода (для графика по дням, в том числе пустые). */
export function periodDays(p: Period): string[] {
  return Array.from({ length: Math.min(p.days, 400) }, (_, i) => addDays(p.fromYmd, i));
}

/** Изменение к прошлому периоду в %, null — сравнивать не с чем. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return cur ? null : 0;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

export const kyivYmd = ymdKyiv;
export const kyivHour = (d: Date) => Number(d.toLocaleString("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" }));
/** День недели по Киеву: 0 — понедельник … 6 — воскресенье. */
export const kyivWeekday = (d: Date) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(d.toLocaleDateString("en-GB", { timeZone: "Europe/Kyiv", weekday: "short" }));
export const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Медиана (для «время до обработки»), null — нет данных. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** «95 мин» → «1 ч 35 мин», «3000 мин» → «2 дн 2 ч». */
export function humanMinutes(min: number | null): string {
  if (min == null) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m} мин`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ""}`;
  const d = Math.floor(m / 1440);
  const h = Math.round((m % 1440) / 60);
  return `${d} дн${h ? ` ${h} ч` : ""}`;
}

// ---------- CSV для Excel ----------

/**
 * Таблица → CSV, который Excel открывает двойным щелчком: разделитель «;» (так ждёт Excel с украинскими/русскими настройками),
 * числа с запятой, UTF-8 с меткой BOM (иначе кириллица превращается в «кракозябры»).
 */
export function toCsv(columns: Array<{ key: string; title: string }>, rows: Array<Record<string, unknown>>): string {
  const cell = (v: unknown) => {
    if (v == null) return "";
    if (typeof v === "number") return String(v).replace(".", ",");
    if (v instanceof Date) return v.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" });
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.title)).join(";"), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
