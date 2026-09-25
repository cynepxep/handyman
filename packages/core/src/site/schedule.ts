// График работы выбором, а не текстом: для каждого дня Пн…Нд «с 09:00 до 18:00» или «вихідний».
// Текст для сайта собирается сам на двух языках: «Пн–Пт 9:00–18:00, Сб 10:00–15:00, Нд — вихідний».
// Используется в «Контактах» и у каждого магазина (точки самовывоза). Без зависимостей: работает и в браузере.

export type DayHours = { off: true } | { off?: false; from: string; to: string };
export type WeekSchedule = {
  /** Пн, Вт, Ср, Чт, Пт, Сб, Нд — ровно 7 дней */
  days: DayHours[];
  /** примечание, например «перерва 13:00–14:00» */
  noteUk: string;
  noteRu: string;
};

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const DAY_NAMES = {
  uk: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"],
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
} as const;
export const DAY_FULL_RU = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const OFF = { uk: "вихідний", ru: "выходной" } as const;

/** Время в списках: 06:00 … 23:30 с шагом 30 минут. */
export const TIME_OPTIONS: string[] = Array.from({ length: 36 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** Стандартный график, пока владелец не выбрал свой: Пн–Сб 9:00–18:00, Нд — вихідний. */
export const DEFAULT_WEEK: WeekSchedule = {
  days: [...Array(6).fill({ from: "09:00", to: "18:00" }), { off: true }],
  noteUk: "",
  noteRu: "",
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Чтение из базы без падений: мусор → null (графика нет). */
export function parseSchedule(raw: unknown): WeekSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.days) || o.days.length !== 7) return null;
  const days: DayHours[] = [];
  for (const d of o.days) {
    const x = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    if (x.off === true) days.push({ off: true });
    else if (typeof x.from === "string" && typeof x.to === "string" && TIME.test(x.from) && TIME.test(x.to) && x.from < x.to) days.push({ from: x.from, to: x.to });
    else return null;
  }
  return { days, noteUk: str(o.noteUk, 200), noteRu: str(o.noteRu, 200) };
}

const hhmm = (t: string) => t.replace(/^0(\d)/, "$1");
const same = (a: DayHours, b: DayHours) => (a.off && b.off) || (!a.off && !b.off && a.from === b.from && a.to === b.to);

/** «Пн–Пт 9:00–18:00, Сб 10:00–15:00, Нд — вихідний» (+ примечание через точку). Все дни выходные — пусто. */
export function scheduleText(s: WeekSchedule, lang: "uk" | "ru"): string {
  if (s.days.every((d) => d.off)) return "";
  const names = DAY_NAMES[lang];
  const parts: string[] = [];
  for (let i = 0; i < 7; ) {
    let j = i;
    while (j + 1 < 7 && same(s.days[j + 1], s.days[i])) j++;
    const days = j === i ? names[i] : j === i + 1 ? `${names[i]}, ${names[j]}` : `${names[i]}–${names[j]}`;
    const d = s.days[i];
    parts.push(d.off ? `${days} — ${OFF[lang]}` : `${days} ${hhmm(d.from)}–${hhmm(d.to)}`);
    i = j + 1;
  }
  const note = lang === "ru" ? s.noteRu || s.noteUk : s.noteUk || s.noteRu;
  return parts.join(", ") + (note ? `. ${note}` : "");
}

export type ScheduleForm = { ok: true; value: WeekSchedule } | { ok: false; error: string };

/**
 * Форма админки: поля `<prefix>mon.off` (галочка «выходной»), `<prefix>mon.from`, `<prefix>mon.to` … и `<prefix>noteUk/noteRu`.
 * Ошибки — понятными словами.
 */
export function parseScheduleForm(input: Record<string, string>, prefix = "h."): ScheduleForm {
  const days: DayHours[] = [];
  for (let i = 0; i < 7; i++) {
    const k = `${prefix}${DAY_KEYS[i]}`;
    if (input[`${k}.off`] === "on") {
      days.push({ off: true });
      continue;
    }
    const from = input[`${k}.from`] ?? "";
    const to = input[`${k}.to`] ?? "";
    if (!TIME.test(from) || !TIME.test(to)) return { ok: false, error: `${DAY_FULL_RU[i]}: выберите время «с» и «до» или отметьте «выходной».` };
    if (from >= to) return { ok: false, error: `${DAY_FULL_RU[i]}: время «до» должно быть позже, чем «с».` };
    days.push({ from, to });
  }
  return { ok: true, value: { days, noteUk: str(input[`${prefix}noteUk`], 200), noteRu: str(input[`${prefix}noteRu`], 200) } };
}
