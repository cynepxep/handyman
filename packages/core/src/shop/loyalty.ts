// Уровни покупателя (накопительная скидка) и личная скидка — чистая логика без базы.
// Правила из прототипа (`..\handyman\docs\04-BUSINESS-RULES.md`): уровень считается по сумме выполненных заказов,
// итоговая скидка = личная (если задана) ИЛИ по уровню. Тестовые заказы в сумму не входят (это делает база).
// По умолчанию уровни ВЫКЛЮЧЕНЫ (допущение: владелец включает в админке).

export type TierKey = "START" | "MASTER" | "PRO" | "LEGEND" | "WHOLESALE";

export type LoyaltyLevel = { key: Exclude<TierKey, "WHOLESALE">; min: number; pct: number };

export type LoyaltySettings = {
  enabled: boolean;
  levels: LoyaltyLevel[]; // по возрастанию порога; первый — всегда с 0
  wholesalePct: number; // «Опт» (бригады): уровень назначает сотрудник вручную
};

export const TIER_RU: Record<TierKey, string> = { START: "Старт", MASTER: "Майстер", PRO: "Профі", LEGEND: "Легенда", WHOLESALE: "Опт" };
export const TIER_KEYS: TierKey[] = ["START", "MASTER", "PRO", "LEGEND", "WHOLESALE"];

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  levels: [
    { key: "START", min: 0, pct: 0 },
    { key: "MASTER", min: 5000, pct: 3 },
    { key: "PRO", min: 15000, pct: 5 },
    { key: "LEGEND", min: 40000, pct: 10 },
  ],
  wholesalePct: 0,
};

const clampPct = (n: unknown, fallback = 0) => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(50, Math.max(0, Math.round(v * 10) / 10)) : fallback;
};
const clampMoney = (n: unknown, fallback = 0) => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(10_000_000, Math.max(0, Math.round(v))) : fallback;
};

/** Привести сохранённые настройки к правильному виду: неизвестное — по умолчанию, пороги растут, у «Старт» порог 0. */
export function normalizeLoyalty(raw: unknown): LoyaltySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<LoyaltySettings>;
  const given = Array.isArray(r.levels) ? r.levels : [];
  let prevMin = -1;
  const levels = DEFAULT_LOYALTY.levels.map((d) => {
    const g = given.find((x) => x && (x as LoyaltyLevel).key === d.key) as Partial<LoyaltyLevel> | undefined;
    let min = d.key === "START" ? 0 : clampMoney(g?.min, d.min);
    if (min <= prevMin) min = prevMin + 1;
    prevMin = min;
    return { key: d.key, min, pct: clampPct(g?.pct, d.pct) };
  });
  return { enabled: r.enabled === true, levels, wholesalePct: clampPct(r.wholesalePct, DEFAULT_LOYALTY.wholesalePct) };
}

/** Уровень по сумме покупок. «Опт» не вычисляется — его ставят вручную. */
export function tierBySpent(spent: number, s: LoyaltySettings): Exclude<TierKey, "WHOLESALE"> {
  let tier: LoyaltyLevel["key"] = "START";
  for (const l of s.levels) if (spent >= l.min) tier = l.key;
  return tier;
}

/** Какой уровень хранить у клиента: «Опт» остаётся, остальные пересчитываются по сумме. */
export function nextStoredTier(current: TierKey, spent: number, s: LoyaltySettings): TierKey {
  return current === "WHOLESALE" ? "WHOLESALE" : tierBySpent(spent, s);
}

/** Прогресс до следующего уровня (для кабинета и карточки клиента): null — уже максимальный или «Опт». */
export function tierProgress(spent: number, tier: TierKey, s: LoyaltySettings): { next: TierKey; left: number; pctDone: number } | null {
  if (tier === "WHOLESALE") return null;
  const idx = s.levels.findIndex((l) => l.key === tierBySpent(spent, s));
  const cur = s.levels[idx];
  const next = s.levels[idx + 1];
  if (!cur || !next) return null;
  const span = next.min - cur.min;
  return { next: next.key, left: Math.max(0, Math.round((next.min - spent) * 100) / 100), pctDone: span > 0 ? Math.min(100, Math.max(0, Math.round(((spent - cur.min) / span) * 100))) : 0 };
}

/**
 * Скидка покупателя в процентах. Личная скидка работает ВСЕГДА (даже если уровни выключены);
 * иначе — по уровню, если уровни включены. Скидки не складываются: берётся личная, если задана.
 */
export function clientDiscountPct(c: { tier: TierKey; manualDiscountPct: number | null }, s: LoyaltySettings): { pct: number; source: "manual" | "tier" | "none" } {
  if (c.manualDiscountPct != null && c.manualDiscountPct > 0) return { pct: clampPct(c.manualDiscountPct), source: "manual" };
  if (!s.enabled) return { pct: 0, source: "none" };
  const pct = c.tier === "WHOLESALE" ? s.wholesalePct : (s.levels.find((l) => l.key === c.tier)?.pct ?? 0);
  return pct > 0 ? { pct, source: "tier" } : { pct: 0, source: "none" };
}

// ---------- карточка клиента: проверка правок сотрудника ----------

export type ClientEditInput = { name: string; phone: string; email: string; lang: "UK" | "RU"; note: string; manualDiscountPct: number | null; wholesale: boolean };
export type ClientEditCheck = { ok: true; value: ClientEditInput } | { ok: false; error: string };

/** Проверка формы клиента в админке. Телефон приводится к +380XXXXXXXXX; пустая почта — нет почты. */
export function validateClientEdit(raw: Record<string, unknown>, normalizePhone: (s: string) => string | null): ClientEditCheck {
  const s = (k: string, max: number) => String(raw[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const name = s("name", 120);
  const phoneRaw = s("phone", 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : "";
  if (phoneRaw && !phone) return { ok: false, error: "Телефон указан неверно: нужен украинский номер, например 093 123 45 67." };
  const email = s("email", 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Почта указана неверно." };
  const discRaw = String(raw.manualDiscountPct ?? "").replace(",", ".").trim();
  let manualDiscountPct: number | null = null;
  if (discRaw) {
    const d = Number(discRaw);
    if (!Number.isFinite(d) || d < 0 || d > 50) return { ok: false, error: "Личная скидка — число от 0 до 50 %." };
    manualDiscountPct = d > 0 ? Math.round(d * 10) / 10 : null;
  }
  const note = String(raw.note ?? "").trim().slice(0, 2000);
  return {
    ok: true,
    value: { name, phone: phone || "", email, lang: raw.lang === "RU" ? "RU" : "UK", note, manualDiscountPct, wholesale: raw.wholesale === "on" || raw.wholesale === true },
  };
}
