// Резервные копии (шаг 8.1): имена копий, какие копии хранить (14 ежедневных + 8 еженедельных), когда делать копию и проверку
// восстановления, сверка числа строк, подпись запросов к облачному хранилищу (S3, AWS Signature V4) и разбор ответа его проверки.
// Чистая логика без базы, диска и сети. Модуль использует node:crypto — свой вход `@handyman/core/backups`, в браузер не импортировать.
import { createHash, createHmac } from "node:crypto";
import { kyivClock } from "./shop/notify-rules";

export type BackupKind = "auto" | "manual" | "pre-restore";
export const BACKUP_KIND_RU: Record<BackupKind, string> = { auto: "ночная", manual: "вручную", "pre-restore": "перед восстановлением" };

/** Сколько копий хранить: последние 14 дней (по одной на день), последние 8 недель (по одной на неделю), последние 5 сделанных вручную. */
export const BACKUP_KEEP = { daily: 14, weekly: 8, manual: 5 };
/** Ночная копия — с 03:30 по Киеву (раз в день); проверка восстановления — раз в 7 дней, с 04:30. */
export const BACKUP_AT = { hour: 3, minute: 30 };
export const CHECK_AT = { hour: 4, minute: 30 };
/** Главные таблицы, число строк в которых сверяется после восстановления. */
export const BACKUP_CHECK_TABLES = [
  "Category", "Product", "ProductImage", "Client", "Order", "OrderItem", "StockItem", "StockMovement", "PayInvoice", "FiscalReceipt",
  "Staff", "Review", "Task", "Page", "TextOverride", "IntegrationSecret",
] as const;

// ---------- имена ----------

const NAME_RE = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})-(auto|manual|pre-restore)$/;

/** Имя копии (оно же имя папки): «2026-09-28_033000-auto» — время по Киеву, чтобы владельцу было понятно. */
export function backupName(now: Date, kind: BackupKind): string {
  const t = now.toLocaleString("sv-SE", { timeZone: "Europe/Kyiv", hourCycle: "h23" }); // «2026-09-28 03:30:00»
  return `${t.slice(0, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}${t.slice(17, 19)}-${kind}`;
}

export type BackupNameInfo = { name: string; ymd: string; time: string; kind: BackupKind; isoWeek: string };

/** Разобрать имя копии; чужое или кривое имя (в том числе с «../») — null. */
export function parseBackupName(name: string): BackupNameInfo | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [, ymd, hh, mm, ss, kind] = m;
  if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59 || Number.isNaN(Date.parse(`${ymd}T00:00:00Z`))) return null;
  return { name, ymd, time: `${hh}:${mm}`, kind: kind as BackupKind, isoWeek: kyivClock(new Date(`${ymd}T12:00:00Z`)).isoWeek };
}

// ---------- что хранить ----------

export type BackupForRetention = { name: string; ok: boolean };

/**
 * Какие копии оставить, какие удалить. Удачные: самая новая за каждый из последних 14 дней, самая новая за каждую из последних
 * 8 недель, 5 последних «вручную»/«перед восстановлением». Неудачные: остаётся только самая новая (чтобы была видна ошибка).
 * Самая новая удачная копия не удаляется никогда. Чужие имена в папке не трогаем.
 */
export function pickBackupsToDrop(list: BackupForRetention[], keep = BACKUP_KEEP): string[] {
  const parsed = list.map((b) => ({ ...b, info: parseBackupName(b.name) })).filter((b) => b.info);
  const ok = parsed.filter((b) => b.ok).sort((a, b) => (a.name < b.name ? 1 : -1));
  const keepSet = new Set<string>();
  const days = new Set<string>();
  const weeks = new Set<string>();
  let manual = 0;
  for (const b of ok) {
    const i = b.info!;
    if (!days.has(i.ymd) && days.size < keep.daily) {
      days.add(i.ymd);
      keepSet.add(b.name);
    }
    if (!weeks.has(i.isoWeek) && weeks.size < keep.weekly) {
      weeks.add(i.isoWeek);
      keepSet.add(b.name);
    }
    if (i.kind !== "auto" && manual < keep.manual) {
      manual++;
      keepSet.add(b.name);
    }
  }
  if (ok[0]) keepSet.add(ok[0].name);
  const failed = parsed.filter((b) => !b.ok).sort((a, b) => (a.name < b.name ? 1 : -1));
  if (failed[0]) keepSet.add(failed[0].name);
  return parsed.filter((b) => !keepSet.has(b.name)).map((b) => b.name).sort();
}

// ---------- когда ----------

const minutesKyiv = (now: Date) => kyivClock(now).hour * 60 + now.getUTCMinutes();

/** Пора ли ночной копии: наступило 03:30 по Киеву (раз в день — следит база). Сайт был выключен ночью — копия сделается, когда включат. */
export const backupDue = (now = new Date()) => minutesKyiv(now) >= BACKUP_AT.hour * 60 + BACKUP_AT.minute;

/** Пора ли проверке восстановления: прошло 7 дней с прошлой проверки (или её не было) и уже 04:30 по Киеву. */
export function restoreCheckDue(lastCheckAt: Date | null, now = new Date()): boolean {
  if (minutesKyiv(now) < CHECK_AT.hour * 60 + CHECK_AT.minute) return false;
  return !lastCheckAt || now.getTime() - lastCheckAt.getTime() >= 7 * 86400_000 - 3 * 3600_000;
}

// ---------- сверка после восстановления ----------

export type RowCounts = Record<string, number>;

/**
 * Сверить число строк во временной базе с тем, что было при копировании. Копия снимается за время между «до» и «после»,
 * поэтому число строк должно попасть между ними (заказ, пришедший во время копии, может быть в ней, а может и нет).
 * Возвращает список расхождений понятными словами (пусто — всё сошлось).
 */
export function compareCounts(before: RowCounts, after: RowCounts, restored: RowCounts): string[] {
  const problems: string[] = [];
  for (const t of Object.keys(before)) {
    const lo = Math.min(before[t], after[t] ?? before[t]);
    const hi = Math.max(before[t], after[t] ?? before[t]);
    const got = restored[t];
    if (got === undefined) problems.push(`таблицы ${t} нет в восстановленной базе`);
    else if (got < lo || got > hi) problems.push(`${t}: в копии ${got} строк, а в базе было ${lo === hi ? lo : `${lo}–${hi}`}`);
  }
  return problems;
}

// ---------- показ ----------

/** «12,3 МБ» — размер для владельца. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["байт", "КБ", "МБ", "ГБ", "ТБ"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} ${units[u]}`;
}

/** Короткий отпечаток ключа шифрования (чтобы понять, тот ли ключ в копии, что и на сайте), сам ключ по нему не узнать. */
export const keyFingerprint = (material: string) => createHash("sha256").update(`handyman-key-fp:${material.trim()}`).digest("hex").slice(0, 16);

// ---------- облачное хранилище (S3-совместимое) ----------

export type S3Config = { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string; prefix: string };

/** Регион по адресу хранилища: Cloudflare R2 — «auto», «s3.eu-central-003.backblazeb2.com» — «eu-central-003»; иначе us-east-1. */
export function s3Region(endpoint: string, given = ""): string {
  if (given.trim()) return given.trim();
  let host = "";
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return "us-east-1";
  }
  if (host.endsWith(".r2.cloudflarestorage.com")) return "auto";
  const m = /(?:^|\.)s3[.-]([a-z]{2}(?:-[a-z]+)+-\d{1,3})\./.exec(host);
  return m ? m[1] : "us-east-1";
}

/** Адрес объекта (path-style: https://хранилище/корзина/путь) — так работают R2, Backblaze B2, Wasabi, AWS и MinIO. */
export function s3ObjectUrl(c: Pick<S3Config, "endpoint" | "bucket">, key: string, query = ""): string {
  const base = c.endpoint.replace(/\/+$/, "");
  const path = [c.bucket, ...key.split("/")].map(uriEncode).join("/");
  return `${base}/${path}${query ? `?${query}` : ""}`;
}

/** Кодирование как требует AWS (RFC 3986: всё, кроме A-Z a-z 0-9 - _ . ~). */
export const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/**
 * Подписать запрос (AWS Signature Version 4, сервис s3). Возвращает заголовки для fetch: исходные + x-amz-date,
 * x-amz-content-sha256 и Authorization. `payloadHash` — sha256 тела в hex (пустое тело — хэш пустой строки).
 */
export function signS3(p: {
  method: string; url: string; headers?: Record<string, string>; payloadHash: string;
  region: string; accessKey: string; secretKey: string; now?: Date;
}): Record<string, string> {
  const u = new URL(p.url);
  const amzDate = (p.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.headers ?? {})) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  headers.host = u.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = p.payloadHash;
  const names = Object.keys(headers).sort();
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [
    p.method.toUpperCase(),
    u.pathname || "/",
    query,
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    names.join(";"),
    p.payloadHash,
  ].join("\n");
  const scope = `${date}/${p.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${p.secretKey}`, date), p.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
  const out: Record<string, string> = { ...headers };
  delete out.host; // fetch ставит сам
  out.authorization = `AWS4-HMAC-SHA256 Credential=${p.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return out;
}

/** Ответ хранилища на проверку (список объектов корзины) → понятный текст для владельца. */
export function readS3Check(status: number, body: string): { ok: boolean; message: string } {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? "";
  if (status >= 200 && status < 300) return { ok: true, message: "Хранилище на связи: корзина доступна, ключи подходят. Вторая копия будет выгружаться туда каждую ночь." };
  if (code === "NoSuchBucket" || status === 404) return { ok: false, message: "Такой корзины (bucket) в хранилище нет — проверьте название." };
  if (code === "InvalidAccessKeyId") return { ok: false, message: "Хранилище не узнало ключ доступа (Access Key ID)." };
  if (code === "SignatureDoesNotMatch") return { ok: false, message: "Секретный ключ не подходит к ключу доступа — скопируйте его ещё раз." };
  if (code === "AuthorizationHeaderMalformed" || code === "PermanentRedirect" || status === 301)
    return { ok: false, message: "Не тот регион или адрес хранилища — проверьте поле «Регион» (или оставьте его пустым)." };
  if (status === 401 || status === 403) return { ok: false, message: `Хранилище не пустило${code ? ` (${code})` : ""}: у ключа нет доступа к этой корзине.` };
  return { ok: false, message: `Хранилище ответило ошибкой ${status}${code ? ` (${code})` : ""}.` };
}
