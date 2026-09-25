// Свои копии фото товаров: скачать у поставщика, уменьшить (WebP, до 1200 px) и хранить в папке MEDIA_DIR.
// Сайт показывает свою копию (/media/…), а если её ещё нет — фото поставщика. Так сайт не зависит от того, работает ли сайт поставщика.
// Имя файла — отпечаток адреса фото (sha1): одно и то же фото не скачивается дважды, в том числе после повторного импорта.
// Пометки turbopackIgnore: путь к папке вычисляется при работе — сборка не должна тащить в себя весь проект (и 600 МБ фото).
// Скачивание идёт в фоне по одному поставщику (кнопка в админке «Фото товаров» и само после импорта), ход — в таблице MediaSyncRun.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { prisma } from "./client";
import { reindexProducts, reindexSafely } from "./catalog-search";

// ---------- где лежат файлы ----------

/** Корень проекта (папка с pnpm-workspace.yaml) — чтобы папка фото была одна и та же при запуске из apps/web и из скриптов. */
function projectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

/** Папка с фото: MEDIA_DIR из .env, иначе «storage/media» в корне проекта. На сервере — отдельный диск/папка. */
export function mediaDir(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR?.trim() || join(/*turbopackIgnore: true*/ projectRoot(), "storage", "media"));
}

const PUBLIC_PREFIX = "/media/";
/** Адрес своей копии фото: /media/ab/<sha1>.webp (по адресу фото у поставщика). */
export function localUrlFor(sourceUrl: string): string {
  const h = createHash("sha1").update(sourceUrl.trim()).digest("hex");
  return `${PUBLIC_PREFIX}${h.slice(0, 2)}/${h}.webp`;
}

const SAFE = /^\/media\/([0-9a-f]{2})\/([0-9a-f]{40})\.webp$/;
/** Путь к файлу на диске по адресу /media/…; чужой или кривой адрес — null (защита от «../»). */
export function mediaFilePath(localUrl: string): string | null {
  const m = SAFE.exec(localUrl);
  if (!m || !m[2].startsWith(m[1])) return null;
  return join(/*turbopackIgnore: true*/ mediaDir(), m[1], `${m[2]}.webp`);
}

/** Файл для отдачи сайтом (маршрут /media/…). */
export async function readMediaFile(localUrl: string): Promise<Buffer | null> {
  const p = mediaFilePath(localUrl);
  if (!p) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ p);
  } catch {
    return null;
  }
}

/** Если копия этого фото уже лежит на диске (например, товар пересоздан импортом) — её адрес, иначе null. */
export function existingLocalUrl(sourceUrl: string): string | null {
  const u = localUrlFor(sourceUrl);
  const p = mediaFilePath(u);
  return p && existsSync(/*turbopackIgnore: true*/ p) ? u : null;
}

/** Строки фото для импорта: сразу с адресом своей копии, если файл уже есть. */
export function imageRows(urls: string[]): Array<{ url: string; sort: number; localUrl: string | null }> {
  return urls.map((url, sort) => ({ url, sort, localUrl: existingLocalUrl(url) }));
}

// ---------- скачивание и уменьшение ----------

type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer>;
}>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
/** Для тестов: подменить скачивание (null — обычный fetch). */
export function setMediaFetch(f: FetchLike | null) {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
}

const MAX_SOURCE = 25 * 1024 * 1024; // больше 25 МБ — это не фото товара
export const MAX_SIDE = 1200;

/** Скачать фото, уменьшить до 1200 px по большей стороне, сохранить WebP. Возвращает адрес и размер или понятную ошибку. */
export async function storeImage(sourceUrl: string): Promise<{ ok: true; localUrl: string; bytes: number } | { ok: false; error: string }> {
  const localUrl = localUrlFor(sourceUrl);
  const path = mediaFilePath(localUrl)!;
  if (existsSync(/*turbopackIgnore: true*/ path)) return { ok: true, localUrl, bytes: statSync(/*turbopackIgnore: true*/ path).size };
  if (!/^https?:\/\//i.test(sourceUrl)) return { ok: false, error: "не ссылка на фото" };
  let buf: Buffer;
  try {
    const res = await fetchImpl(sourceUrl, { headers: { "user-agent": "HandymanShop/1.0 (+photos)" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { ok: false, error: `сайт поставщика ответил ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/")) return { ok: false, error: `не картинка (${type.slice(0, 40)})` };
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_SOURCE) return { ok: false, error: "файл слишком большой" };
    buf = Buffer.from(ab);
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "сайт поставщика не ответил за 30 с" : "не удалось скачать" };
  }
  let out: Buffer;
  try {
    out = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }) // прозрачный фон — белым, как на карточках
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return { ok: false, error: "файл повреждён или это не картинка" };
  }
  mkdirSync(/*turbopackIgnore: true*/ dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, out);
  await rename(/*turbopackIgnore: true*/ tmp, path); // файл появляется целиком — сайт не отдаст недописанный
  return { ok: true, localUrl, bytes: out.length };
}

// ---------- фоновое скачивание по поставщику ----------

export type MediaScope = { supplierId: string | null };
const active = new Set<string>();
const CONCURRENCY = 4;
let batchSize = 40;
/** Для тестов: маленькие пачки, чтобы проверить переход между ними. */
export function setMediaBatchSize(n: number) {
  batchSize = Math.max(1, Math.floor(n));
}

const supplierWhere = (supplierId: string | null) => ({ product: { supplierId } });

/** Сколько фото у поставщика: всего, уже у нас, ошибок, объём своих копий. */
export async function mediaStats() {
  const rows = await prisma.$queryRaw<Array<{ supplierId: string | null; total: bigint; local: bigint; errors: bigint; bytes: bigint | null }>>`
    SELECT p."supplierId", COUNT(*) AS total, COUNT(i."localUrl") AS local,
      COUNT(*) FILTER (WHERE i."localUrl" IS NULL AND i."localError" IS NOT NULL) AS errors, SUM(i."localBytes") AS bytes
    FROM "ProductImage" i JOIN "Product" p ON p.id = i."productId"
    GROUP BY p."supplierId"`;
  return rows.map((r) => ({ supplierId: r.supplierId, total: Number(r.total), local: Number(r.local), errors: Number(r.errors), bytes: Number(r.bytes ?? 0) }));
}

/** Последний запуск по каждому поставщику; «running», который сейчас не идёт (сервер перезапускали), помечается «прервано». */
export async function lastRuns() {
  const runs = await prisma.mediaSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 200 });
  const seen = new Map<string, (typeof runs)[number] & { interrupted: boolean }>();
  for (const r of runs) {
    const key = r.supplierId ?? "";
    if (!seen.has(key)) seen.set(key, { ...r, interrupted: r.status === "running" && !active.has(r.id) });
  }
  return seen;
}

/**
 * Запустить скачивание фото поставщика в фоне (только тех, которых у нас ещё нет; ошибки прошлых попыток — повторяются).
 * Уже идёт — вернёт тот же запуск. Возвращает id запуска.
 */
export async function startMediaSync(scope: MediaScope, who: string, opts: { onlyNew?: boolean } = {}): Promise<{ runId: string; total: number }> {
  const running = await prisma.mediaSyncRun.findFirst({ where: { supplierId: scope.supplierId, status: "running", id: { in: [...active] } } });
  if (running) return { runId: running.id, total: running.total };
  const where = { localUrl: null, ...supplierWhere(scope.supplierId), ...(opts.onlyNew ? { localError: null } : {}) };
  const total = await prisma.productImage.count({ where });
  const run = await prisma.mediaSyncRun.create({ data: { supplierId: scope.supplierId, who, total, status: total ? "running" : "done", finishedAt: total ? null : new Date() } });
  if (!total) return { runId: run.id, total };
  active.add(run.id);
  void runSync(run.id, where).catch(async (e) => {
    console.error("[media] скачивание фото прервано:", e);
    await prisma.mediaSyncRun.update({ where: { id: run.id }, data: { status: "failed", error: String(e instanceof Error ? e.message : e).slice(0, 300), finishedAt: new Date() } }).catch(() => {});
  }).finally(() => active.delete(run.id));
  return { runId: run.id, total };
}

/** Попросить остановить (текущие 4 фото докачаются, дальше — стоп). */
export async function stopMediaSync(runId: string): Promise<void> {
  await prisma.mediaSyncRun.updateMany({ where: { id: runId, status: "running" }, data: { stopRequested: true } });
}

/** Столько неудач подряд — считаем, что сайт поставщика не работает, и останавливаемся (иначе часы впустую по 30 с на фото). */
export const GIVE_UP_STREAK = 20;

async function runSync(runId: string, where: object): Promise<void> {
  let done = 0, failed = 0, savedKb = 0, streak = 0;
  let gaveUp = false;
  const touched = new Set<string>();
  let cursor: string | undefined;
  const stopAsked = async () => (await prisma.mediaSyncRun.findUnique({ where: { id: runId }, select: { stopRequested: true } }))?.stopRequested === true;
  outer: for (;;) {
    // «id больше последнего», а не cursor+skip: скачанные фото выпадают из выборки (localUrl уже не пустой),
    // и cursor со skip: 1 пропускал бы по одному фото на каждую пачку
    const batch = await prisma.productImage.findMany({
      where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" }, take: batchSize, select: { id: true, url: true, productId: true, sort: true },
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].id;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      if (await stopAsked()) break outer;
      const part = batch.slice(i, i + CONCURRENCY);
      const results = await Promise.all(part.map((img) => storeImage(img.url)));
      await prisma.$transaction(part.map((img, k) => {
        const r = results[k];
        return r.ok
          ? prisma.productImage.update({ where: { id: img.id }, data: { localUrl: r.localUrl, localBytes: r.bytes, localAt: new Date(), localError: null } })
          : prisma.productImage.update({ where: { id: img.id }, data: { localError: r.error.slice(0, 200) } });
      }));
      part.forEach((img, k) => {
        const r = results[k];
        if (r.ok) {
          done++;
          streak = 0;
          savedKb += Math.round(r.bytes / 1024);
          if (img.sort === 0) touched.add(img.productId); // первое фото — в поиске и карточках
        } else {
          failed++;
          streak++;
        }
      });
      await prisma.mediaSyncRun.update({ where: { id: runId }, data: { done, failed, savedKb } });
      if (streak >= GIVE_UP_STREAK) {
        gaveUp = true;
        break outer;
      }
    }
  }
  const stopped = await stopAsked();
  await prisma.mediaSyncRun.update({
    where: { id: runId },
    data: {
      status: gaveUp ? "failed" : stopped ? "stopped" : "done", done, failed, savedKb, finishedAt: new Date(),
      ...(gaveUp ? { error: `${GIVE_UP_STREAK} фото подряд не скачались — похоже, сайт поставщика сейчас не работает. Попробуйте позже.` } : {}),
    },
  });
  // карточки в поиске показывают первое фото — обновить у них адрес на свою копию
  const ids = [...touched];
  for (let i = 0; i < ids.length; i += 200) await reindexSafely(() => reindexProducts(ids.slice(i, i + 200)));
}

/** Ход запуска для полоски в админке. */
export const getMediaRun = (runId: string) => prisma.mediaSyncRun.findUnique({ where: { id: runId } });

/** Сколько места занимают свои копии всего (по базе). */
export async function mediaTotalBytes(): Promise<number> {
  const r = await prisma.productImage.aggregate({ _sum: { localBytes: true } });
  return r._sum.localBytes ?? 0;
}
