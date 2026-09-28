// Вторая копия вне сервера (шаг 8.1): выгрузка резервных копий в облачное S3-совместимое хранилище (R2, Backblaze B2, Wasabi, S3, MinIO).
// Без библиотек: запросы подписываются сами (AWS Signature V4, `signS3` в @handyman/core/backups). Ключи — из «Интеграций» (`secret("backup.…")`).
// Без ключей — копии только на сервере (в «Резервных копиях» — предупреждение). В тестах сеть — `setOffsiteFetch`.
import { readS3Check, s3ObjectUrl, s3Region, sha256Hex, signS3, type S3Config } from "@handyman/core/backups";
import type { CheckResult } from "@handyman/core/integrations";
import { secret } from "./integrations";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;
const realFetch: FetchLike = (url, init) => fetch(url, { ...init, body: init.body as unknown as BodyInit | undefined });
let fetchImpl: FetchLike = realFetch;
/** Для тестов: подменить запросы к хранилищу (null — обычный fetch). */
export const setOffsiteFetch = (f: FetchLike | null) => {
  fetchImpl = f ?? realFetch;
};

/** Папка внутри корзины: одна корзина может хранить копии нескольких сайтов. */
export const OFFSITE_PREFIX = "handyman/";

/** Настройки хранилища или null — не задано (копии только на сервере). */
export async function offsiteConfig(): Promise<S3Config | null> {
  const [endpoint, bucket, accessKey, secretKey, region] = await Promise.all(
    (["endpoint", "bucket", "accessKey", "secretKey", "region"] as const).map((f) => secret(`backup.${f}`)),
  );
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, accessKey, secretKey, region: s3Region(endpoint, region), prefix: OFFSITE_PREFIX };
}

export class OffsiteError extends Error {}

async function request(c: S3Config, method: string, key: string, body?: Buffer, query = ""): Promise<{ status: number; text: string }> {
  const url = s3ObjectUrl(c, key, query);
  const headers = signS3({
    method, url, payloadHash: sha256Hex(body ?? ""), region: c.region, accessKey: c.accessKey, secretKey: c.secretKey,
    headers: body ? { "content-type": "application/octet-stream" } : {},
  });
  // большой файл базы по медленному каналу — до часа; остальное — 30 секунд
  const timeout = body && body.length > 5_000_000 ? 3600_000 : 30_000;
  const res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(timeout) });
  return { status: res.status, text: await res.text().catch(() => "") };
}

const errText = (status: number, text: string) => {
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  return `хранилище ответило ${status}${code ? ` (${code})` : ""}`;
};

/** Положить файл в хранилище (перезапишет, если такой уже есть). */
export async function putObject(c: S3Config, key: string, body: Buffer): Promise<void> {
  const r = await request(c, "PUT", `${c.prefix}${key}`, body);
  if (r.status < 200 || r.status >= 300) throw new OffsiteError(`${key}: ${errText(r.status, r.text)}`);
}

/** Удалить файл из хранилища; «нет такого» — не ошибка. */
export async function deleteObject(c: S3Config, key: string): Promise<void> {
  const r = await request(c, "DELETE", `${c.prefix}${key}`);
  if ((r.status < 200 || r.status >= 300) && r.status !== 404) throw new OffsiteError(`${key}: ${errText(r.status, r.text)}`);
}

/** «Проверить подключение» в «Интеграциях»: список объектов корзины (не больше одного). */
export async function checkOffsite(): Promise<CheckResult> {
  const c = await offsiteConfig();
  if (!c) return { ok: false, message: "Не заполнены адрес, корзина или ключи хранилища." };
  const r = await request(c, "GET", "", undefined, `list-type=2&max-keys=1&prefix=${encodeURIComponent(OFFSITE_PREFIX)}`);
  return readS3Check(r.status, r.text);
}
