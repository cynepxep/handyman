// «Интеграции» (шаг 3.1): ключи внешних сервисов в базе, зашифрованные; чтение ключа для кода магазина; проверка подключения.
// Порядок чтения ключа: база (раздел «Интеграции») → .env (как было до шага 3.1) → нет ключа (режим-заглушка).
// Ключ шифрования: SECRETS_KEY из окружения, иначе файл .data/secrets.key в корне проекта (создаётся сам). Без него копия базы
// бесполезна для чужого: ключи в ней не прочитать. Значения ключей нигде не печатаются и в журнал не пишутся.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  INTEGRATIONS, deriveKey, integrationById, maskSecret, openSecret, readCheckboxCheck, readKeycrmCheck, readMonoCheck, readNovaPoshtaCheck,
  readGtmCheck, readTelegramCheck, readTurboSmsCheck, sealSecret, secretKey, validateField, type CheckResult, type IntegrationId, type SecretKey,
} from "@handyman/core/integrations";
import { prisma, Prisma } from "./client";
import { logError } from "./errors";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

// ---------- ключ шифрования ----------

/** Корень проекта (папка с pnpm-workspace.yaml). */
export function projectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

/** Где лежит файл ключа (если SECRETS_KEY не задан). */
export const secretsKeyFile = () => process.env.SECRETS_KEY_FILE?.trim() || join(/*turbopackIgnore: true*/ projectRoot(), ".data", "secrets.key");

let masterKey: Buffer | null = null;
function key(): Buffer {
  if (masterKey) return masterKey;
  const fromEnv = process.env.SECRETS_KEY?.trim();
  if (fromEnv) return (masterKey = deriveKey(fromEnv));
  const file = secretsKeyFile();
  if (!existsSync(/*turbopackIgnore: true*/ file)) {
    mkdirSync(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
    writeFileSync(/*turbopackIgnore: true*/ file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    try {
      chmodSync(/*turbopackIgnore: true*/ file, 0o600);
    } catch {
      /* Windows: права файла задаёт папка пользователя */
    }
    console.info(`[integrations] создан ключ шифрования ${file} — сохраните его вместе с резервной копией базы`);
  }
  return (masterKey = deriveKey(readFileSync(/*turbopackIgnore: true*/ file, "utf8")));
}

/**
 * Содержимое ключа шифрования — для резервной копии (шаг 8.1): SECRETS_KEY или файл ключа (создаётся, если его ещё нет).
 * Без него ключи «Интеграций» из копии базы не расшифровать. Никуда, кроме копии, не выводить.
 */
export function secretsKeyMaterial(): { material: string; source: "SECRETS_KEY" | "file" } {
  const fromEnv = process.env.SECRETS_KEY?.trim();
  if (fromEnv) return { material: fromEnv, source: "SECRETS_KEY" };
  key();
  return { material: readFileSync(/*turbopackIgnore: true*/ secretsKeyFile(), "utf8").trim(), source: "file" };
}

/** Где ключ шифрования (для подсказки владельцу). */
export const secretsKeySource = () => (process.env.SECRETS_KEY?.trim() ? "SECRETS_KEY" : secretsKeyFile());

// ---------- чтение ключей кодом магазина ----------

type Stored = Map<string, { value: string | null; updatedAt: Date; updatedBy: string }>;
let cache: { at: number; rows: Stored } | null = null;
const TTL = 30_000;

/** Сбросить кэш (после сохранения в админке и в тестах). */
export const integrationsChanged = () => {
  cache = null;
};
/** Для тестов: сбросить и ключ шифрования (другой SECRETS_KEY). */
export const resetSecretsKey = () => {
  masterKey = null;
  cache = null;
};

async function stored(): Promise<Stored> {
  if (cache && Date.now() - cache.at < TTL) return cache.rows;
  const rows = await prisma.integrationSecret.findMany();
  const k = key();
  const map: Stored = new Map(rows.map((r) => [r.key, { value: openSecret(r.sealed, k), updatedAt: r.updatedAt, updatedBy: r.updatedBy }]));
  cache = { at: Date.now(), rows: map };
  return map;
}

function envOf(full: string): string {
  const [id, field] = full.split(".");
  const f = integrationById(id)?.fields.find((x) => x.key === field);
  return f ? (process.env[f.env]?.trim() ?? "") : "";
}

/**
 * Ключ сервиса: «telegram.botToken», «novaposhta.apiKey»… Пусто — ключа нет (режим-заглушка).
 * База недоступна — берём из .env, чтобы магазин не падал.
 */
export async function secret(full: SecretKey): Promise<string> {
  try {
    const v = (await stored()).get(full)?.value;
    if (v) return v;
  } catch (e) {
    logError("[integrations] не прочитал ключи из базы:", e instanceof Error ? e.message.split("\n")[0] : e);
  }
  return envOf(full);
}

// ---------- раздел «Интеграции» ----------

export type FieldState = {
  key: string; label: string; env: string; secret: boolean; hint?: string;
  /** откуда значение: база, .env, нет; broken — в базе есть, но не расшифровывается (сменился ключ шифрования) */
  source: "db" | "env" | "none" | "broken";
  /** что показать: маска у секрета, само значение у обычного поля */
  shown: string;
  updatedAt: Date | null; updatedBy: string | null;
};
export type CheckState = { ok: boolean; message: string; at: string; who: string };
export type IntegrationState = {
  id: IntegrationId; title: string; what: string; stub: string;
  fields: FieldState[];
  /** все обязательные поля есть — сервис работает (иначе заглушка) */
  configured: boolean;
  check: CheckState | null;
};

const CHECKS_KEY = "integrations.checks";
async function loadChecks(): Promise<Record<string, CheckState>> {
  const row = await prisma.setting.findUnique({ where: { key: CHECKS_KEY } });
  return (row?.value ?? {}) as Record<string, CheckState>;
}

export async function integrationsOverview(): Promise<IntegrationState[]> {
  integrationsChanged();
  const [rows, checks] = await Promise.all([stored(), loadChecks()]);
  return INTEGRATIONS.map((d) => {
    const fields = d.fields.map((f): FieldState => {
      const s = rows.get(secretKey(d.id, f.key));
      const env = process.env[f.env]?.trim() ?? "";
      const value = s?.value || env;
      const source = s?.value ? "db" : s ? "broken" : env ? "env" : "none";
      return {
        key: f.key, label: f.label, env: f.env, secret: f.secret, hint: f.hint, source,
        shown: value ? (f.secret ? maskSecret(value) : value) : "",
        updatedAt: s?.updatedAt ?? null, updatedBy: s?.updatedBy ?? null,
      };
    });
    const configured = d.required.every((k) => fields.find((f) => f.key === k && (f.source === "db" || f.source === "env")));
    return { id: d.id, title: d.title, what: d.what, stub: d.stub, fields, configured, check: checks[d.id] ?? null };
  });
}

export class IntegrationError extends Error {}

/** Сохранить введённые поля сервиса. Пустое поле — «оставить как было». Возвращает, какие поля изменены. */
export async function saveIntegration(id: string, values: Record<string, string>, who: string): Promise<string[]> {
  const d = integrationById(id);
  if (!d) throw new IntegrationError("Нет такого сервиса.");
  const changed: Array<{ key: string; value: string }> = [];
  for (const f of d.fields) {
    const v = (values[f.key] ?? "").trim();
    if (!v) continue;
    const err = validateField(d.id, f.key, v);
    if (err) throw new IntegrationError(`${f.label}: ${err}`);
    changed.push({ key: f.key, value: v });
  }
  if (!changed.length) return [];
  const k = key();
  await prisma.$transaction([
    ...changed.map((c) =>
      prisma.integrationSecret.upsert({
        where: { key: secretKey(d.id, c.key) },
        create: { key: secretKey(d.id, c.key), sealed: sealSecret(c.value, k), updatedBy: who },
        update: { sealed: sealSecret(c.value, k), updatedBy: who },
      }),
    ),
    // результат прошлой проверки к новым ключам не относится
    prisma.auditLog.create({ data: { who, action: "integration.save", target: d.id, details: json({ fields: changed.map((c) => c.key) }) } }),
  ]);
  await dropCheck(d.id);
  integrationsChanged();
  if (d.id === "analytics") {
    (await import("./analytics")).analyticsChanged(); // шаг А1: витрина сразу берёт новый ID
    // шаг А3: новый ключ — покупки последних дней, не ушедшие из-за неверного ключа, отправляются снова
    if (changed.some((c) => /Token$|ApiSecret$|PixelId$|ga4Id$/.test(c.key))) await (await import("./ad-events")).requeueAdErrors();
  }
  return changed.map((c) => c.key);
}

/** Удалить значение из базы: сервис снова берёт .env или работает заглушкой. */
export async function clearIntegrationField(id: string, field: string, who: string): Promise<void> {
  const d = integrationById(id);
  if (!d || !d.fields.some((f) => f.key === field)) throw new IntegrationError("Нет такого поля.");
  await prisma.$transaction([
    prisma.integrationSecret.deleteMany({ where: { key: secretKey(d.id, field) } }),
    prisma.auditLog.create({ data: { who, action: "integration.clear", target: d.id, details: json({ field }) } }),
  ]);
  await dropCheck(d.id);
  integrationsChanged();
  if (d.id === "analytics") (await import("./analytics")).analyticsChanged();
}

async function dropCheck(id: string) {
  const checks = await loadChecks();
  if (!(id in checks)) return;
  delete checks[id];
  await prisma.setting.upsert({ where: { key: CHECKS_KEY }, create: { key: CHECKS_KEY, value: json(checks) }, update: { value: json(checks) } });
}

// ---------- проверка подключения ----------

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Для тестов: подменить запросы к сервисам (null — обычный fetch). */
export const setIntegrationsFetch = (f: FetchLike | null) => {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
};

async function call(url: string, init: { method: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(url, {
    method: init.method,
    headers: { accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
  // все эти сервисы отвечают JSON; другое (страница ошибки прокси, 502) — значит, до сервиса не достучались
  const body = await res.json().catch(() => undefined);
  if (body === undefined) throw new Unreachable(res.status);
  return { status: res.status, body };
}
class Unreachable extends Error {
  constructor(public status: number) {
    super(`ответ не от сервиса (${status})`);
  }
}

async function runCheck(id: IntegrationId): Promise<CheckResult> {
  const v = (f: string) => secret(`${id}.${f}`);
  switch (id) {
    case "telegram": {
      const token = await v("botToken");
      const me = await call(`https://api.telegram.org/bot${token}/getMe`, { method: "POST", body: {} });
      const chatId = await v("adminChatId");
      if (!chatId || !(me.body as { ok?: boolean } | null)?.ok) return readTelegramCheck(me.body, chatId ? me.body : undefined);
      const chat = await call(`https://api.telegram.org/bot${token}/getChat`, { method: "POST", body: { chat_id: chatId } });
      return readTelegramCheck(me.body, chat.body);
    }
    case "novaposhta": {
      const r = await call("https://api.novaposhta.ua/v2.0/json/", {
        method: "POST",
        body: { apiKey: await v("apiKey"), modelName: "Counterparty", calledMethod: "getCounterparties", methodProperties: { CounterpartyProperty: "Sender", Page: "1" } },
      });
      return readNovaPoshtaCheck(r.body);
    }
    case "mono": {
      const base = process.env.MONO_BASE?.trim() || "https://api.monobank.ua";
      const r = await call(`${base}/api/merchant/details`, { method: "GET", headers: { "X-Token": await v("token") } });
      return readMonoCheck(r.status, r.body);
    }
    case "checkbox": {
      const base = (process.env.CHECKBOX_BASE?.trim() || "https://api.checkbox.in.ua").replace(/\/+$/, "");
      const r = await call(`${base}/api/v1/cashier/signin`, {
        method: "POST",
        headers: { "X-License-Key": await v("licenseKey"), "X-Client-Name": "Handyman", "X-Client-Version": "1.0" },
        body: { login: await v("login"), password: await v("password") },
      });
      return readCheckboxCheck(r.status, r.body);
    }
    case "keycrm": {
      const r = await call("https://openapi.keycrm.app/v1/order/source?limit=50", { method: "GET", headers: { Authorization: `Bearer ${await v("apiKey")}` } });
      return readKeycrmCheck(r.status, r.body, await v("sourceId"));
    }
    case "backup":
      // шаг 8.1: второе хранилище копий (S3) отвечает XML, а не JSON — своя проверка; модуль грузится лениво (он сам импортирует этот)
      return (await import("./offsite")).checkOffsite();
    case "analytics": {
      // шаг А1: Google отдаёт gtm.js только опубликованного контейнера (это скрипт, не JSON — смотрим только код ответа)
      const gtmId = await v("gtmId");
      const res = await fetchImpl(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`, { method: "GET", headers: {}, signal: AbortSignal.timeout(10_000) });
      const def = integrationById("analytics")!;
      const filled: string[] = [];
      for (const f of def.fields) if (/Id$/.test(f.key) && f.key !== "gtmId" && (await v(f.key))) filled.push(f.label.split(":")[0]);
      const { loadAnalyticsSettings } = await import("./analytics");
      const gtm = readGtmCheck(res.status, gtmId, [...new Set(filled)], (await loadAnalyticsSettings()).enabled);
      // шаг А3: ключи покупки с сервера (Meta — токен, GA4 — формат события); модуль грузится лениво (он сам импортирует этот)
      const srv = await (await import("./ad-events")).checkAdServers();
      return srv.lines.length ? { ok: gtm.ok && srv.ok, message: [gtm.message, ...srv.lines].join(" ") } : gtm;
    }
    case "sms": {
      const r = await call("https://api.turbosms.ua/user/balance.json", { method: "POST", headers: { Authorization: `Bearer ${await v("token")}` }, body: {} });
      return readTurboSmsCheck(r.status, r.body);
    }
  }
}

/** Кнопка «Проверить подключение»: запрос к сервису, результат сохраняется и пишется в журнал (без ключей). */
export async function checkIntegration(id: string, who: string): Promise<CheckState> {
  const d = integrationById(id);
  if (!d) throw new IntegrationError("Нет такого сервиса.");
  const missing: string[] = [];
  for (const k of d.required) if (!(await secret(secretKey(d.id, k)))) missing.push(d.fields.find((f) => f.key === k)!.label);
  let r: CheckResult;
  if (missing.length) r = { ok: false, message: `Не заполнено: ${missing.join(", ")}. Впишите значение в поле выше и нажмите «Сохранить» — пока работает заглушка.` };
  else {
    try {
      r = await runCheck(d.id);
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      r = {
        ok: false,
        message: timeout
          ? "Сервис не ответил за 10 секунд — попробуйте ещё раз."
          : `Не удалось связаться с сервисом (нет интернета или сервис недоступен${e instanceof Unreachable ? `, код ${e.status}` : ""}). Ключ сохранён — проверьте позже.`,
      };
    }
  }
  const state: CheckState = { ok: r.ok, message: r.message.slice(0, 500), at: new Date().toISOString(), who };
  const checks = await loadChecks();
  checks[d.id] = state;
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: CHECKS_KEY }, create: { key: CHECKS_KEY, value: json(checks) }, update: { value: json(checks) } }),
    prisma.auditLog.create({ data: { who, action: "integration.check", target: d.id, details: json({ ok: r.ok }) } }),
  ]);
  return state;
}
