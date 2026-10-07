// Журнал ошибок и «здоровье» сайта (шаг 8.2): маскирование личных данных и ключей, «отпечаток» для группировки одинаковых ошибок,
// когда слать тревогу (новая группа или всплеск, не чаще раза в час на группу), разбор записи «как в console.error», оценка проверок здоровья.
// Чистая логика без базы и сети. Модуль использует node:crypto — свой вход `@handyman/core/errors`, в браузер не импортировать.
import { createHash } from "node:crypto";

/** Откуда ошибка: страница/действие/адрес API сайта (onRequestError), фоновые задачи, внешние сервисы, браузер покупателя. */
export type ErrorSource = "page" | "action" | "route" | "proxy" | "jobs" | "service" | "browser";
export const ERROR_SOURCE_RU: Record<ErrorSource, string> = {
  page: "страница",
  action: "действие",
  route: "адрес API",
  proxy: "служебное",
  jobs: "фоновые задачи",
  service: "сервис",
  browser: "браузер",
};
export const isErrorSource = (s: unknown): s is ErrorSource => typeof s === "string" && s in ERROR_SOURCE_RU;

/** Сколько хранить (дней), когда тревога о всплеске, как часто тревожить по одной группе. */
export const ERROR_KEEP_DAYS = 30;
export const ERROR_SPIKE = { count: 20, minutes: 10 };
export const ERROR_ALERT_EVERY_MIN = 60;
/** Длины, после которых текст обрезается (журнал — не хранилище логов). */
export const ERROR_LIMITS = { message: 500, stack: 4000, where: 120, url: 300 };

// ---------- маскирование ----------

const SECRET_KEYS = "token|secret|password|passwd|pwd|pass|api[_-]?key|apikey|key|sign|signature|x-sign|x-token|authorization|auth|cookie|session|otp";
const PERSONAL_KEYS = "phone|tel|telephone|mobile|email|e-mail|name|fullname|firstname|lastname|middlename|recipient\\w*|address|addr|street|city|house|flat|comment|warehouse|np\\w*";

/**
 * Убрать из текста то, что нельзя хранить в журнале: токены и ключи, пароли в адресах, телефоны, почту, имена и адреса покупателей
 * (в виде «поле: значение»). Лучше замаскировать лишнее, чем сохранить чужой телефон.
 */
export function maskSensitive(text: string): string {
  let s = String(text ?? "");
  // Prisma печатает в ошибке аргументы запроса (имя, телефон, адрес заказа) — оставляем только первую строку и причину
  s = trimPrismaArgs(s);
  // токен бота Telegram и «Bearer …»
  s = s.replace(/\bbot?\d{6,12}:[A-Za-z0-9_-]{25,}/g, "***");
  s = s.replace(/\b\d{6,12}:[A-Za-z0-9_-]{25,}/g, "***");
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 ***");
  // логин:пароль в адресе (postgresql://user:pass@host, https://u:p@…)
  s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]*@/gi, "$1***@");
  // ключ=значение и "ключ": "значение" (секреты и личные данные)
  const kv = new RegExp(`(["']?\\b(?:${SECRET_KEYS}|${PERSONAL_KEYS})\\b["']?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;&}\\]]+)`, "gi");
  s = s.replace(kv, (_m, k: string, v: string) => `${k}${v.startsWith('"') ? '"***"' : v.startsWith("'") ? "'***'" : "***"}`);
  // почта
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "***@***");
  // телефоны Украины в любом виде: +380 67 123 45 67, 380671234567, (067) 123-45-67, 0671234567
  s = s.replace(/(?<![\w-])(?:\+?\s?3\s?8\s?)?\(?0\s?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\w-])/g, "+38***");
  // любые длинные цифровые последовательности, похожие на телефон или карту (10–19 цифр)
  s = s.replace(/(?<![\w-])\+?\d{10,19}(?![\w-])/g, "***");
  return s;
}

/** Ошибки Prisma вида «Invalid `prisma.order.create()` invocation: { data: {...} } Причина» — без аргументов. */
function trimPrismaArgs(s: string): string {
  if (!/Invalid `[^`]*` invocation/.test(s)) return s;
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.find((l) => /Invalid `[^`]*` invocation/.test(l)) ?? lines[0];
  const reason = lines[lines.length - 1];
  return reason && reason !== head ? `${head.replace(/ in$/, "")} … ${reason}` : head;
}

/** Адрес страницы для журнала: путь без хвоста после «?», значения параметров — только безопасные (номер страницы, язык, сортировка). */
export function maskUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  let path = String(raw);
  let query = "";
  try {
    const u = new URL(path, "http://x");
    path = u.pathname;
    const safe = ["page", "sort", "tab", "lang", "status", "period", "part", "view"];
    const q = [...u.searchParams.keys()].map((k) => (safe.includes(k) ? `${k}=${maskSensitive(u.searchParams.get(k) ?? "")}` : `${k}=…`));
    if (q.length) query = `?${q.join("&")}`;
  } catch {
    path = path.split("?")[0];
  }
  return (maskSensitive(path) + query).slice(0, ERROR_LIMITS.url);
}

// ---------- группировка ----------

/** Текст без «переменных» частей — одинаковые по смыслу ошибки получают один отпечаток. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\bc[a-z0-9]{20,30}\b/g, "<id>") // cuid
    .replace(/\b[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/HM-\d+/g, "HM-<n>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'|`[^`]{0,200}`/g, "<s>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Первая строка стека из нашего кода — без номеров строк (номер меняется при правке файла, группа — нет). */
export function stackTop(stack: string | undefined | null): string {
  if (!stack) return "";
  for (const line of stack.split("\n").slice(1)) {
    const l = line.trim();
    if (!l.startsWith("at ") || /node_modules|node:internal|\(native\)|<anonymous>/.test(l)) continue;
    return l.replace(/:\d+:\d+\)?$/, "").replace(/\(.*[\\/](apps|packages)[\\/]/, "($1/").replace(/^at /, "").slice(0, 200);
  }
  return "";
}

/** Отпечаток группы: откуда + где + текст без чисел и адресов + место в коде. */
export function errorFingerprint(p: { source: string; where: string; message: string; stack?: string | null }): string {
  const basis = [p.source, normalizeMessage(p.where), normalizeMessage(p.message), stackTop(p.stack)].join("|");
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

/** Текст ошибки из чего угодно (Error, строка, объект с message, AggregateError). */
export function errorText(e: unknown): { message: string; stack: string; name: string } {
  if (e instanceof Error) {
    const cause = e.cause instanceof Error ? ` (причина: ${e.cause.message})` : "";
    return { message: `${e.message}${cause}` || e.name, stack: e.stack ?? "", name: e.name };
  }
  if (typeof e === "string") return { message: e, stack: "", name: "" };
  if (e && typeof e === "object" && "message" in e) return { message: String((e as { message: unknown }).message), stack: "", name: "" };
  try {
    return { message: JSON.stringify(e) ?? String(e), stack: "", name: "" };
  } catch {
    return { message: String(e), stack: "", name: "" };
  }
}

/**
 * Разобрать запись в стиле console.error("[payments] счёт не создан:", err) → где = «payments», текст, стек первой ошибки.
 * Так все места, где раньше был console.error, пишут в журнал без переделки текстов.
 */
export function parseLogArgs(args: unknown[]): { where: string; message: string; stack: string } {
  let where = "";
  const parts: string[] = [];
  let stack = "";
  args.forEach((a, i) => {
    if (i === 0 && typeof a === "string") {
      const m = /^\[([^\]]{1,60})\]\s*/.exec(a);
      if (m) {
        where = m[1];
        a = a.slice(m[0].length);
      }
    }
    const t = errorText(a);
    if (!stack && t.stack) stack = t.stack;
    if (t.message) parts.push(t.message);
  });
  return { where, message: parts.join(" ").replace(/:\s*$/, "").trim() || "ошибка без текста", stack };
}

/** Готовая запись для журнала: всё замаскировано и обрезано. */
export type ErrorEntry = { source: ErrorSource; where: string; message: string; stack: string; url: string; digest: string; fingerprint: string };

export function makeErrorEntry(p: { source: ErrorSource; where?: string; error?: unknown; message?: string; stack?: string; url?: string | null; digest?: string | null }): ErrorEntry {
  const t = p.error !== undefined ? errorText(p.error) : { message: "", stack: "", name: "" };
  const message = maskSensitive(p.message ?? t.message ?? "").slice(0, ERROR_LIMITS.message) || "ошибка без текста";
  const stack = maskSensitive(p.stack ?? t.stack ?? "").slice(0, ERROR_LIMITS.stack);
  const where = maskSensitive(p.where ?? "").slice(0, ERROR_LIMITS.where);
  const url = maskUrl(p.url);
  return {
    source: p.source, where, message, stack, url,
    digest: String(p.digest ?? "").slice(0, 60),
    fingerprint: errorFingerprint({ source: p.source, where, message, stack }),
  };
}

/** Служебные «ошибки» Next.js (redirect, notFound, переход на динамику) — не ошибки, в журнал не пишутся. */
export function isNextControlFlow(e: unknown): boolean {
  const digest = e && typeof e === "object" && "digest" in e ? String((e as { digest: unknown }).digest) : "";
  return /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|NEXT_PRERENDER_INTERRUPTED)/.test(digest);
}

/**
 * «Failed to find Server Action»: форма прислала номер действия, которого в этой сборке нет — страница открыта до обновления сайта
 * или запрос прислал сканер. Сайт отвечает сам (у Next.js это предупреждение), исправлять в коде нечего — в журнал и тревоги не пишем.
 */
export function isStaleServerAction(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE;
  const message = "message" in e ? String((e as { message: unknown }).message) : "";
  return code === "E975" || /^Failed to find Server Action\b/.test(message);
}

// ---------- тревоги ----------

export type ErrorGroupState = {
  source: string;
  lastAt: Date;
  windowAt: Date;
  windowCount: number;
  alertedAt: Date | null;
  reopenedAt: Date | null;
  closedAt: Date | null;
};

/**
 * Нужна ли тревога владельцу по группе: «new» — новая группа (или вернулась после «Закрыть»), «spike» — ≥ 20 за 10 минут.
 * Не чаще раза в час на группу. Ошибки из браузера покупателя — только всплеск (единичные бывают из-за расширений и старых телефонов).
 */
export function alertReason(g: ErrorGroupState, now = new Date()): "new" | "spike" | null {
  if (g.closedAt) return null;
  if (g.alertedAt && now.getTime() - g.alertedAt.getTime() < ERROR_ALERT_EVERY_MIN * 60_000) return null;
  const spike = g.windowCount >= ERROR_SPIKE.count && now.getTime() - g.windowAt.getTime() <= ERROR_SPIKE.minutes * 60_000 * 2
    && (!g.alertedAt || g.lastAt > g.alertedAt);
  if (g.source === "browser") return spike ? "spike" : null;
  if (!g.alertedAt) return "new";
  if (g.reopenedAt && g.reopenedAt > g.alertedAt) return "new";
  return spike ? "spike" : null;
}

/** Текст тревоги в Telegram (без подробностей — они в «Ошибки»). */
export function alertText(items: Array<{ reason: "new" | "spike"; source: ErrorSource; where: string; message: string; count: number; windowCount: number }>, more = 0): string {
  const lines = items.map((g) => {
    const head = g.reason === "spike" ? `🔥 Всплеск: ${g.windowCount} раз за ${ERROR_SPIKE.minutes} мин` : "❗ Новая ошибка";
    const where = [ERROR_SOURCE_RU[g.source], g.where].filter(Boolean).join(" · ");
    return `${head} (${where}): ${g.message.slice(0, 160)}`;
  });
  if (more > 0) lines.push(`…и ещё ${more}`);
  lines.push("Подробности — «Ошибки» в админке.");
  return lines.join("\n");
}

// ---------- здоровье ----------

export type HealthLevel = "ok" | "warn" | "bad";
export type HealthCheck = { key: "db" | "search" | "jobs" | "disk" | "backup" | "errors" | "telegram"; level: HealthLevel; text: string };
export const HEALTH_LABEL_RU: Record<HealthCheck["key"], string> = {
  db: "База данных",
  search: "Поиск",
  jobs: "Фоновые задачи",
  disk: "Место на диске",
  backup: "Резервная копия",
  errors: "Ошибки за сутки",
  telegram: "Сообщения в Telegram",
};

/**
 * Сообщения о заказах и заявках в Telegram: без токена бота или ID чата — не уходят вовсе (плохо);
 * последнее сообщение не отправилось — плохо (с причиной от Telegram); иначе — хорошо.
 */
export function telegramHealth(p: { token: boolean; chat: boolean; last: { state: string; error: string | null } | null; sentDay: number }): { level: HealthLevel; text: string } {
  const how = "«Интеграции» → Telegram; свой ID чата бот подскажет командой /chatid";
  if (!p.token || !p.chat) {
    const miss = [!p.token && "токен бота", !p.chat && "ID чата для уведомлений"].filter(Boolean).join(" и ");
    return { level: "bad", text: `не уходят: не указан ${miss} — ${how}` };
  }
  if (p.last?.state === "FAILED") return { level: "bad", text: `последнее не отправлено (${(p.last.error ?? "ошибка").slice(0, 120)}) — проверьте ${how}` };
  return { level: "ok", text: `настроены; за сутки отправлено: ${p.sentDay}` };
}

/** Фоновые задачи идут раз в минуту: 10 минут тишины — внимание, час — плохо. */
export function jobsLevel(lastRunAt: Date | null, now = new Date(), workerOff = false): HealthLevel {
  if (workerOff) return "warn";
  if (!lastRunAt) return "warn";
  const min = (now.getTime() - lastRunAt.getTime()) / 60_000;
  return min <= 10 ? "ok" : min <= 60 ? "warn" : "bad";
}

/** Место на диске: меньше 1 ГБ или 5 % — плохо, меньше 3 ГБ или 15 % — внимание. */
export function diskLevel(freeBytes: number, totalBytes: number): HealthLevel {
  if (!totalBytes) return "warn";
  const pct = freeBytes / totalBytes;
  if (freeBytes < 1024 ** 3 || pct < 0.05) return "bad";
  if (freeBytes < 3 * 1024 ** 3 || pct < 0.15) return "warn";
  return "ok";
}

/** Последняя удачная копия: до 26 часов — хорошо, до 3 суток — внимание, дольше или нет — плохо. */
export function backupLevel(lastOkAt: Date | null, now = new Date()): HealthLevel {
  if (!lastOkAt) return "warn";
  const h = (now.getTime() - lastOkAt.getTime()) / 3600_000;
  return h <= 26 ? "ok" : h <= 72 ? "warn" : "bad";
}

/**
 * Итог для внешнего сторожа: «error» — только если не работает то, без чего покупатель не купит (база, поиск) или кончается диск.
 * Остальное («давно не было копии», «фоновые задачи молчат») — внимание в админке, сторож не будит.
 */
export function healthStatus(checks: HealthCheck[]): "ok" | "error" {
  const critical = new Set<HealthCheck["key"]>(["db", "search", "disk"]);
  return checks.some((c) => c.level === "bad" && critical.has(c.key)) ? "error" : "ok";
}
