// Резервные копии (шаг 8.1). Каждую ночь (03:30 по Киеву, из `runJobs`) и по кнопке «Сделать копию сейчас»:
//  • база — `pg_dump -Fc` в файл db.dump (заказы, клиенты, товары, остатки, настройки, ключи «Интеграций» в зашифрованном виде);
//  • ключ шифрования — secrets.key (без него ключи «Интеграций» из копии не расшифровать);
//  • фото — папка MEDIA_DIR копируется в BACKUP_DIR/media (только новые файлы: уже скопированные пропускаются);
//  • вторая копия — в облачное хранилище, если оно задано в «Интеграциях» (offsite.ts).
// Хранится 14 ежедневных + 8 еженедельных (+ 5 последних «вручную»), старые удаляются (правило — `pickBackupsToDrop` в core).
// Раз в неделю — проверка: последняя копия восстанавливается во временную базу, число строк сверяется, ключи расшифровываются;
// не получилось — тревога в Telegram. Поисковый индекс не копируется (пересобирается `pnpm search:reindex`), фиды — не нужны.
// Список копий — папки в BACKUP_DIR (у каждой manifest.json): таблиц в базе для этого не нужно. Откуда берётся pg_dump — `pgRunner()`.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  BACKUP_CHECK_TABLES, backupDue, backupName, compareCounts, keyFingerprint, parseBackupName, pickBackupsToDrop, restoreCheckDue,
  type BackupKind, type RowCounts,
} from "@handyman/core/backups";
import { deriveKey, openSecret } from "@handyman/core/integrations";
import { kyivClock } from "@handyman/core/shop";
import { prisma, Prisma, PrismaClient } from "./client";
import { projectRoot, resetSecretsKey, secretsKeyFile, secretsKeyMaterial } from "./integrations";
import { mediaDir } from "./media";
import { notifyManagers } from "./notify";
import { deleteObject, offsiteConfig, putObject } from "./offsite";
import { logError } from "./errors";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
export class BackupError extends Error {}

// ---------- где лежат копии ----------

/** Папка копий: BACKUP_DIR из .env, иначе .data/backups в папке проекта. На сервере — отдельный диск/том. */
export const backupDir = () => resolve(/*turbopackIgnore: true*/ process.env.BACKUP_DIR?.trim() || join(/*turbopackIgnore: true*/ projectRoot(), ".data", "backups"));
const mirrorDir = () => join(/*turbopackIgnore: true*/ backupDir(), "media");
const offsiteMediaList = () => join(/*turbopackIgnore: true*/ backupDir(), "offsite-media.txt");

/** Папка копии по имени; чужое имя (в том числе «../») — null. */
export function backupPath(name: string): string | null {
  return parseBackupName(name) ? join(/*turbopackIgnore: true*/ backupDir(), name) : null;
}

export const BACKUP_FILES = { db: "db.dump", key: "secrets.key", manifest: "manifest.json" } as const;

export type BackupManifest = {
  version: 1;
  name: string;
  kind: BackupKind;
  who: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  error?: string;
  /** как делалась копия: pg_dump на этом компьютере или через Docker */
  via?: string;
  db?: { size: number; sha256: string };
  counts?: { before: RowCounts; after: RowCounts };
  key?: { fingerprint: string; source: "SECRETS_KEY" | "file" };
  media?: { dir: string; files: number; copied: number; bytes: number };
  offsite?: { ok: boolean; at: string; error?: string; mediaUploaded?: number; mediaLeft?: number } | null;
  check?: CheckInfo | null;
};
export type CheckInfo = { ok: boolean; at: string; who: string; problems: string[]; seconds: number; counts?: RowCounts; secrets?: { total: number; opened: number } };

async function readManifest(dir: string): Promise<BackupManifest | null> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, BACKUP_FILES.manifest), "utf8")) as BackupManifest;
  } catch {
    return null;
  }
}
async function writeManifest(dir: string, m: BackupManifest): Promise<void> {
  const tmp = join(/*turbopackIgnore: true*/ dir, `${BACKUP_FILES.manifest}.tmp`);
  await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(m, null, 2));
  await rename(/*turbopackIgnore: true*/ tmp, join(/*turbopackIgnore: true*/ dir, BACKUP_FILES.manifest));
}

// ---------- откуда pg_dump / pg_restore ----------

export type PgRunner = { how: "local"; bin: (tool: string) => string; label: string } | { how: "docker"; docker: string; container: string; label: string };
let runnerCache: PgRunner | null = null;

const works = (cmd: string, args: string[]) => {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 15_000, windowsHide: true });
    return r.status === 0 ? (r.stdout || "").trim() : null;
  } catch {
    return null;
  }
};

/**
 * Как запускать pg_dump/pg_restore: PG_BIN_DIR из .env → pg_dump на этом компьютере (сервер: боевой образ, шаг 8.4) →
 * внутри контейнера базы через Docker (ПК владельца: `docker exec handyman-next-postgres-1 pg_dump`, контейнер — PG_DOCKER_CONTAINER).
 */
export function pgRunner(): PgRunner {
  if (runnerCache) return runnerCache;
  const dir = process.env.PG_BIN_DIR?.trim();
  if (dir) return (runnerCache = { how: "local", bin: (t) => join(/*turbopackIgnore: true*/ dir, t), label: `pg_dump из ${dir}` });
  const ver = works("pg_dump", ["--version"]);
  if (ver) return (runnerCache = { how: "local", bin: (t) => t, label: `${ver} на этом компьютере` });
  const container = process.env.PG_DOCKER_CONTAINER?.trim() || "handyman-next-postgres-1";
  const candidates = ["docker"];
  if (process.env.LOCALAPPDATA) candidates.push(join(/*turbopackIgnore: true*/ process.env.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin", "docker.exe"));
  if (process.platform === "win32") candidates.push("C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe");
  for (const docker of candidates) {
    if (works(docker, ["--version"])) return (runnerCache = { how: "docker", docker, container, label: `pg_dump внутри Docker (контейнер ${container})` });
  }
  throw new BackupError("Не найдена программа pg_dump и не найден Docker. На сервере она входит в образ сайта; на компьютере — запустите Docker Desktop.");
}
/** Для тестов: забыть найденный способ. */
export const resetPgRunner = () => {
  runnerCache = null;
};

type Target = { host: string; port: string; user: string; password: string; db: string; sslmode: string | null };
function dbTarget(url = process.env.DATABASE_URL ?? ""): Target {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BackupError("DATABASE_URL не задан или записан неверно.");
  }
  return {
    host: u.hostname || "localhost", port: u.port || "5432", user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    db: decodeURIComponent(u.pathname.replace(/^\//, "")), sslmode: u.searchParams.get("sslmode"),
  };
}
/** Адрес той же базы с другим именем (временная база для проверки). */
function urlWithDb(dbName: string, url = process.env.DATABASE_URL ?? ""): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(dbName)}`;
  return u.toString();
}

/** Запустить программу; stdout — в файл, stdin — из файла. Ненулевой код — ошибка с концом stderr (без пароля: он в PGPASSWORD). */
function run(cmd: string, args: string[], o: { env?: Record<string, string>; stdoutFile?: string; stdinFile?: string } = {}): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...o.env }, stdio: [o.stdinFile ? "pipe" : "ignore", o.stdoutFile ? "pipe" : "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr!.on("data", (d: Buffer) => {
      err = (err + d.toString("utf8")).slice(-4000);
    });
    const waits: Array<Promise<void>> = [];
    if (o.stdoutFile) {
      const ws = createWriteStream(/*turbopackIgnore: true*/ o.stdoutFile);
      waits.push(new Promise((r, j) => {
        ws.on("finish", () => r());
        ws.on("error", j);
      }));
      child.stdout!.pipe(ws);
    }
    if (o.stdinFile) {
      const rs = createReadStream(/*turbopackIgnore: true*/ o.stdinFile);
      child.stdin!.on("error", () => {}); // программа закрыла вход раньше (ошибка) — код выхода скажет, что случилось
      rs.on("error", (e) => {
        child.kill();
        fail(e);
      });
      rs.pipe(child.stdin!);
    }
    child.on("error", (e) => fail(new BackupError(`не запустилась ${cmd}: ${e.message}`)));
    child.on("close", (code) => {
      Promise.all(waits).then(
        () => (code === 0 ? ok() : fail(new BackupError(`${cmd.split(/[\\/]/).pop()} завершился с ошибкой ${code}: ${err.trim().split("\n").slice(-3).join(" ").slice(0, 600)}`))),
        fail,
      );
    });
  });
}

const pgEnv = (t: Target): Record<string, string> => ({ PGPASSWORD: t.password, ...(t.sslmode ? { PGSSLMODE: t.sslmode } : {}) });

async function pgDump(outFile: string): Promise<void> {
  const r = pgRunner();
  const t = dbTarget();
  if (r.how === "local") {
    await run(r.bin("pg_dump"), ["-Fc", "-h", t.host, "-p", t.port, "-U", t.user, "-d", t.db, "-f", outFile], { env: pgEnv(t) });
  } else {
    // внутри контейнера база «своя»: вход по локальному сокету, пароль не нужен
    await run(r.docker, ["exec", r.container, "pg_dump", "-Fc", "-U", t.user, "-d", t.db], { stdoutFile: outFile });
  }
}

/** Восстановить файл копии в базу `dbName`. `clean` — сначала удалить то, что есть в копии (восстановление поверх рабочей базы). */
export async function pgRestore(file: string, dbName: string, opts: { clean?: boolean } = {}): Promise<void> {
  const r = pgRunner();
  const t = dbTarget();
  const common = ["--no-owner", "--no-privileges", "--exit-on-error", ...(opts.clean ? ["--clean", "--if-exists", "--single-transaction"] : [])];
  if (r.how === "local") await run(r.bin("pg_restore"), [...common, "-h", t.host, "-p", t.port, "-U", t.user, "-d", dbName, file], { env: pgEnv(t) });
  else await run(r.docker, ["exec", "-i", r.container, "pg_restore", ...common, "-U", t.user, "-d", dbName], { stdinFile: file });
}

// ---------- мелочи ----------

async function countRows(client: { $queryRawUnsafe: PrismaClient["$queryRawUnsafe"] }): Promise<RowCounts> {
  const out: RowCounts = {};
  for (const t of BACKUP_CHECK_TABLES) {
    try {
      const r = await client.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${t}"`);
      out[t] = Number(r[0].n);
    } catch {
      /* такой таблицы нет — не сверяем */
    }
  }
  return out;
}

async function fileSha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(/*turbopackIgnore: true*/ file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(/*turbopackIgnore: true*/ dir, e.name);
    if (e.isDirectory()) await walk(p, base, out);
    else if (e.isFile() && !e.name.endsWith(".tmp")) out.push(relative(/*turbopackIgnore: true*/ base, p));
  }
  return out;
}

/** Скопировать новые и изменившиеся (по размеру) файлы из `src` в `dst`. Уже скопированные пропускаются; удалённые в `src` — остаются в копии. */
export async function mirrorFiles(src: string, dst: string): Promise<{ files: number; copied: number; bytes: number }> {
  const files = await walk(src);
  let copied = 0;
  let bytes = 0;
  for (const rel of files) {
    const from = join(/*turbopackIgnore: true*/ src, rel);
    const to = join(/*turbopackIgnore: true*/ dst, rel);
    const s = await stat(/*turbopackIgnore: true*/ from).catch(() => null);
    if (!s) continue;
    bytes += s.size;
    const d = await stat(/*turbopackIgnore: true*/ to).catch(() => null);
    if (d && d.size === s.size) continue;
    await mkdir(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ to, ".."), { recursive: true });
    await copyFile(/*turbopackIgnore: true*/ from, `${to}.tmp`);
    await rename(/*turbopackIgnore: true*/ `${to}.tmp`, to);
    copied++;
  }
  return { files: files.length, copied, bytes };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 500);

// ---------- «занято»: копия или проверка идёт (одна на все копии сайта) ----------

const LOCK_KEY = "backup.lock";
const ATTEMPT_KEY = "backup.lastAttempt";
const LAST_CHECK_KEY = "backup.lastCheck";
type Lock = { what: "backup" | "check"; name: string; at: string; who: string };

async function takeLock(l: Omit<Lock, "at">): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try {
      await prisma.setting.create({ data: { key: LOCK_KEY, value: json({ ...l, at: new Date().toISOString() }) } });
      return true;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      // зависшая отметка (сайт выключили посреди копии) — через 3 часа снимаем
      const cur = await currentLock();
      if (cur && Date.now() - Date.parse(cur.at) < 3 * 3600_000) return false;
      await prisma.setting.deleteMany({ where: { key: LOCK_KEY } });
    }
  }
  return false;
}
const dropLock = () => prisma.setting.deleteMany({ where: { key: LOCK_KEY } });
/** Что сейчас идёт (копия или проверка), или null. */
export async function currentLock(): Promise<Lock | null> {
  const row = await prisma.setting.findUnique({ where: { key: LOCK_KEY } });
  return (row?.value as Lock | undefined) ?? null;
}

// ---------- сделать копию ----------

export type BackupResult = { ok: boolean; name: string; error?: string; manifest: BackupManifest };

/**
 * Сделать копию (ждёт окончания). Занято (идёт другая копия/проверка) — BackupError. Ошибка — копия помечается неудачной,
 * ночная — ещё и тревогой в Telegram. После удачной — выгрузка во второе хранилище и удаление старых копий.
 */
export async function createBackup(p: { kind: BackupKind; who: string; now?: Date }): Promise<BackupResult> {
  const name = backupName(p.now ?? new Date(), p.kind);
  if (!(await takeLock({ what: "backup", name, who: p.who }))) throw new BackupError("Уже идёт копирование или проверка — подождите несколько минут.");
  const dir = join(/*turbopackIgnore: true*/ backupDir(), name);
  const m: BackupManifest = { version: 1, name, kind: p.kind, who: p.who, startedAt: new Date().toISOString(), finishedAt: "", ok: false };
  try {
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    m.via = pgRunner().label;
    const before = await countRows(prisma);
    const dumpFile = join(/*turbopackIgnore: true*/ dir, BACKUP_FILES.db);
    await pgDump(dumpFile);
    const after = await countRows(prisma);
    const size = (await stat(/*turbopackIgnore: true*/ dumpFile)).size;
    if (size < 1024) throw new BackupError("файл базы получился пустым");
    m.db = { size, sha256: await fileSha256(dumpFile) };
    m.counts = { before, after };
    const k = secretsKeyMaterial();
    await writeFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, BACKUP_FILES.key), `${k.material}\n`, { mode: 0o600 });
    m.key = { fingerprint: keyFingerprint(k.material), source: k.source };
    const md = mediaDir();
    m.media = { dir: md, ...(await mirrorFiles(md, mirrorDir())) };
    m.ok = true;
  } catch (e) {
    m.error = errMsg(e);
  }
  m.finishedAt = new Date().toISOString();
  try {
    await writeManifest(dir, m);
    if (m.ok) {
      m.offsite = await uploadOffsite(dir, m);
      if (m.offsite) await writeManifest(dir, m);
      await pruneBackups();
    }
  } catch (e) {
    if (m.ok) logError("[backup] после копии:", errMsg(e));
    else m.error = `${m.error}; ${errMsg(e)}`;
  } finally {
    await dropLock();
  }
  if (!m.ok) logError(`[backup] копия ${name} не сделана:`, m.error);
  if (p.kind === "auto" && !m.ok) await notifyManagers(`❗ Резервная копия не сделана: ${m.error}. Сайт попробует ещё раз через час. «Резервные копии» в админке.`).catch(() => {});
  if (p.kind === "auto" && m.offsite && !m.offsite.ok) await notifyManagers(`⚠️ Копия сделана, но не выгружена во второе хранилище: ${m.offsite.error}. Проверьте «Интеграции → Резервные копии».`).catch(() => {});
  return { ok: m.ok, name, error: m.error, manifest: m };
}

/** Выгрузка во второе хранилище: файл базы, ключ, описание и новые фото (фото — не дольше `mediaBudgetMs`, остальное — в следующий раз). */
async function uploadOffsite(dir: string, m: BackupManifest, mediaBudgetMs = 45 * 60_000): Promise<BackupManifest["offsite"]> {
  const c = await offsiteConfig();
  if (!c) return null;
  const at = new Date().toISOString();
  try {
    for (const f of [BACKUP_FILES.db, BACKUP_FILES.key]) await putObject(c, `db/${m.name}/${f}`, await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, f)));
    await putObject(c, `db/${m.name}/${BACKUP_FILES.manifest}`, Buffer.from(JSON.stringify(m, null, 2)));
    // фото: что уже выгружено — список в offsite-media.txt (имя файла фото = отпечаток адреса, содержимое не меняется)
    const done = new Set((await readFile(/*turbopackIgnore: true*/ offsiteMediaList(), "utf8").catch(() => "")).split("\n").filter(Boolean));
    const todo = (await walk(mirrorDir())).map((r) => r.split(sep).join("/")).filter((r) => !done.has(r));
    const deadline = Date.now() + mediaBudgetMs;
    let uploaded = 0;
    for (let i = 0; i < todo.length && Date.now() < deadline; i += 4) {
      const part = todo.slice(i, i + 4);
      await Promise.all(part.map(async (rel) => putObject(c, `media/${rel}`, await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ mirrorDir(), rel)))));
      await appendFile(/*turbopackIgnore: true*/ offsiteMediaList(), `${part.join("\n")}\n`);
      uploaded += part.length;
    }
    return { ok: true, at, mediaUploaded: uploaded, mediaLeft: todo.length - uploaded };
  } catch (e) {
    return { ok: false, at, error: errMsg(e) };
  }
}

/** Удалить старые копии по правилу 14/8 (+ из второго хранилища). */
export async function pruneBackups(): Promise<string[]> {
  const list = await listBackups();
  const drop = pickBackupsToDrop(list.filter((b) => b.state !== "running").map((b) => ({ name: b.name, ok: b.state === "ok" })));
  const c = drop.length ? await offsiteConfig().catch(() => null) : null;
  for (const name of drop) {
    const p = backupPath(name);
    if (!p) continue;
    await rm(/*turbopackIgnore: true*/ p, { recursive: true, force: true });
    if (c) {
      for (const f of Object.values(BACKUP_FILES)) await deleteObject(c, `db/${name}/${f}`).catch((e) => logError("[backup] второе хранилище:", errMsg(e)));
    }
  }
  return drop;
}

// ---------- список ----------

export type BackupRow = {
  name: string; kind: BackupKind;
  /** ok — копия готова; failed — не получилась; running — идёт сейчас; broken — папка без описания (оборвалась) */
  state: "ok" | "failed" | "running" | "broken";
  manifest: BackupManifest | null;
  /** размер файла базы + ключа */
  size: number;
};

/** Копии в папке, новые сверху. */
export async function listBackups(): Promise<BackupRow[]> {
  const root = backupDir();
  let names: string[] = [];
  try {
    names = (await readdir(/*turbopackIgnore: true*/ root, { withFileTypes: true })).filter((e) => e.isDirectory() && parseBackupName(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
  const lock = await currentLock().catch(() => null);
  const rows = await Promise.all(
    names.map(async (name): Promise<BackupRow> => {
      const dir = join(/*turbopackIgnore: true*/ root, name);
      const m = await readManifest(dir);
      let size = 0;
      for (const f of [BACKUP_FILES.db, BACKUP_FILES.key]) size += (await stat(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, f)).catch(() => null))?.size ?? 0;
      const state = m ? (m.ok ? "ok" : "failed") : lock?.what === "backup" && lock.name === name ? "running" : "broken";
      return { name, kind: parseBackupName(name)!.kind, state, manifest: m, size };
    }),
  );
  return rows.sort((a, b) => (a.name < b.name ? 1 : -1));
}

// ---------- проверка восстановления ----------

export type VerifyResult = { name: string | null } & CheckInfo;

/**
 * Восстановить копию (по умолчанию — последнюю удачную) во временную базу «<база>_restore_check», сверить число строк в главных
 * таблицах и то, что ключ из копии расшифровывает ключи «Интеграций»; временную базу удалить. Не получилось — тревога в Telegram.
 */
export async function verifyBackup(p: { who: string; name?: string; alert?: boolean } = { who: "сайт" }): Promise<VerifyResult> {
  const started = Date.now();
  const list = await listBackups();
  const target = p.name ? list.find((b) => b.name === p.name && b.state === "ok") : list.find((b) => b.state === "ok");
  if (!(await takeLock({ what: "check", name: target?.name ?? "", who: p.who }))) throw new BackupError("Уже идёт копирование или проверка — подождите несколько минут.");
  const problems: string[] = [];
  let counts: RowCounts | undefined;
  let secrets: CheckInfo["secrets"];
  const tmpDb = `${dbTarget().db}_restore_check`.slice(0, 60);
  try {
    if (!target?.manifest) throw new BackupError(p.name ? "Такой готовой копии нет." : "Нет ни одной готовой копии.");
    const dir = join(/*turbopackIgnore: true*/ backupDir(), target.name);
    const m = target.manifest;
    const dump = join(/*turbopackIgnore: true*/ dir, BACKUP_FILES.db);
    if (!existsSync(/*turbopackIgnore: true*/ dump)) throw new BackupError("Файла базы в копии нет.");
    if (m.db && (await fileSha256(dump)) !== m.db.sha256) throw new BackupError("Файл базы в копии испорчен (не совпадает контрольная сумма).");
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${tmpDb}" WITH (FORCE)`);
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${tmpDb}"`);
    await pgRestore(dump, tmpDb);
    const tmp = new PrismaClient({ datasourceUrl: urlWithDb(tmpDb) });
    try {
      counts = await countRows(tmp);
      if (m.counts) problems.push(...compareCounts(m.counts.before, m.counts.after, counts));
      const material = (await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, BACKUP_FILES.key), "utf8").catch(() => "")).trim();
      if (!material) problems.push("в копии нет ключа шифрования (secrets.key)");
      else if (m.key && keyFingerprint(material) !== m.key.fingerprint) problems.push("ключ шифрования в копии не тот, что был при копировании");
      const rows = await tmp.integrationSecret.findMany({ select: { sealed: true } });
      const k = deriveKey(material || "-");
      secrets = { total: rows.length, opened: rows.filter((r) => openSecret(r.sealed, k) !== null).length };
      if (secrets.opened < secrets.total) problems.push(`ключ из копии не открывает ${secrets.total - secrets.opened} из ${secrets.total} ключей «Интеграций»`);
    } finally {
      await tmp.$disconnect();
    }
  } catch (e) {
    problems.push(errMsg(e));
  } finally {
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${tmpDb}" WITH (FORCE)`).catch(() => {});
    await dropLock();
  }
  const info: CheckInfo = { ok: problems.length === 0, at: new Date().toISOString(), who: p.who, problems, seconds: Math.round((Date.now() - started) / 1000), counts, secrets };
  if (target?.manifest) {
    const dir = join(/*turbopackIgnore: true*/ backupDir(), target.name);
    const fresh = (await readManifest(dir)) ?? target.manifest;
    await writeManifest(dir, { ...fresh, check: info }).catch(() => {});
  }
  const last = { ...info, name: target?.name ?? null };
  await prisma.setting.upsert({ where: { key: LAST_CHECK_KEY }, create: { key: LAST_CHECK_KEY, value: json(last) }, update: { value: json(last) } });
  if (!info.ok && p.alert !== false) {
    await notifyManagers(`❗ Проверка резервной копии не прошла${target ? ` (${target.name})` : ""}: ${problems.slice(0, 3).join("; ")}. Откройте «Резервные копии» в админке.`).catch(() => {});
  }
  return last;
}

/** Последняя проверка восстановления (любой копии). */
export async function lastCheck(): Promise<VerifyResult | null> {
  return ((await prisma.setting.findUnique({ where: { key: LAST_CHECK_KEY } }))?.value as VerifyResult | undefined) ?? null;
}

// ---------- в фоне: ночью из runJobs и по кнопке ----------

const g = globalThis as unknown as { hmBackupRun?: Promise<unknown> | null };

/** Запустить в фоне (кнопка в админке): false — уже что-то идёт. */
export async function startInBackground(what: "backup" | "check", who: string): Promise<boolean> {
  if (g.hmBackupRun || (await currentLock())) return false;
  const job = what === "backup" ? createBackup({ kind: "manual", who }) : verifyBackup({ who, alert: false });
  g.hmBackupRun = job;
  job.catch((e) => logError(`[backup] ${what}:`, errMsg(e))).finally(() => {
    g.hmBackupRun = null;
  });
  return true;
}

/** Дождаться фоновой копии/проверки (тесты, скрипты). */
export const backupSettled = async () => {
  await g.hmBackupRun?.catch(() => {});
};

/**
 * Из `runJobs` раз в минуту: ночная копия (с 03:30; не получилось — ещё 2 попытки через час) и проверка восстановления
 * (раз в 7 дней с 04:30). Работает в фоне, чтобы не задерживать остальные задачи. Выключить: HM_BACKUPS=off (тесты).
 */
export async function runBackupJobs(now = new Date()): Promise<"backup" | "check" | null> {
  if (process.env.HM_BACKUPS === "off" || g.hmBackupRun || (await currentLock())) return null;
  const ymd = kyivClock(now).ymd;
  if (backupDue(now)) {
    const doneToday = (await listBackups()).some((b) => b.kind === "auto" && b.state === "ok" && b.name.startsWith(ymd));
    if (!doneToday) {
      const a = ((await prisma.setting.findUnique({ where: { key: ATTEMPT_KEY } }))?.value ?? null) as { ymd: string; n: number; at: string } | null;
      const n = a?.ymd === ymd ? a.n : 0;
      if (n < 3 && (!a || a.ymd !== ymd || now.getTime() - Date.parse(a.at) >= 3600_000)) {
        const v = json({ ymd, n: n + 1, at: now.toISOString() });
        await prisma.setting.upsert({ where: { key: ATTEMPT_KEY }, create: { key: ATTEMPT_KEY, value: v }, update: { value: v } });
        const job = createBackup({ kind: "auto", who: "сайт", now });
        g.hmBackupRun = job;
        job.catch((e) => logError("[backup]", errMsg(e))).finally(() => {
          g.hmBackupRun = null;
        });
        return "backup";
      }
    }
  }
  const last = await lastCheck();
  if (restoreCheckDue(last ? new Date(last.at) : null, now) && (await listBackups()).some((b) => b.state === "ok")) {
    const job = verifyBackup({ who: "сайт" });
    g.hmBackupRun = job;
    job.catch((e) => logError("[backup] проверка:", errMsg(e))).finally(() => {
      g.hmBackupRun = null;
    });
    return "check";
  }
  return null;
}

// ---------- для раздела «Резервные копии» ----------

export type BackupOverview = {
  dir: string; mediaDir: string; via: string | null; viaError: string | null;
  list: BackupRow[]; lastOk: BackupRow | null; running: Lock | null; lastCheck: VerifyResult | null;
  offsite: { configured: boolean; endpoint: string | null; bucket: string | null };
  keySource: "SECRETS_KEY" | "file";
};

export async function backupOverview(): Promise<BackupOverview> {
  let via: string | null = null;
  let viaError: string | null = null;
  try {
    via = pgRunner().label;
  } catch (e) {
    viaError = errMsg(e);
  }
  const [list, running, check, c] = await Promise.all([listBackups(), currentLock(), lastCheck(), offsiteConfig().catch(() => null)]);
  return {
    dir: backupDir(), mediaDir: mediaDir(), via, viaError, list, lastOk: list.find((b) => b.state === "ok") ?? null, running, lastCheck: check,
    offsite: { configured: Boolean(c), endpoint: c?.endpoint ?? null, bucket: c?.bucket ?? null },
    keySource: process.env.SECRETS_KEY?.trim() ? "SECRETS_KEY" : "file",
  };
}

/** Путь к файлу копии для «Скачать» (только db.dump и secrets.key); чужое имя — null. */
export function backupFileFor(name: string, file: "db" | "key"): string | null {
  const dir = backupPath(name);
  if (!dir) return null;
  const p = join(/*turbopackIgnore: true*/ dir, BACKUP_FILES[file]);
  return existsSync(/*turbopackIgnore: true*/ p) ? p : null;
}

// ---------- восстановление вручную (pnpm backup:restore) ----------

export type RestoreReport = {
  name: string;
  /** копия текущей базы, сделанная перед восстановлением (или null — база была пустой / отказались) */
  safety: string | null;
  key: "same" | "written" | "replaced" | "env-differs" | "missing";
  /** куда отложен прежний файл ключа (key = replaced) */
  keyBackup?: string;
  media: { files: number; copied: number } | null;
};

/**
 * Восстановить копию в рабочую базу (DATABASE_URL) — ВСЁ, что в базе сейчас, заменяется данными копии. Сайт перед этим остановить.
 * `folder` — папка копии (в ней db.dump, secrets.key, manifest.json). Перед восстановлением — копия текущей базы (`safety`),
 * если в ней есть данные. Ключ шифрования кладётся на место (прежний файл — рядом с пометкой), фото — из BACKUP_DIR/media копии.
 */
export async function restoreBackup(folder: string, opts: { safety?: boolean; log?: (s: string) => void } = {}): Promise<RestoreReport> {
  const log = opts.log ?? (() => {});
  const dump = join(/*turbopackIgnore: true*/ folder, BACKUP_FILES.db);
  if (!existsSync(/*turbopackIgnore: true*/ dump)) throw new BackupError(`В папке ${folder} нет файла ${BACKUP_FILES.db}.`);
  const m = await readManifest(folder);
  if (m?.db && (await fileSha256(dump)) !== m.db.sha256) throw new BackupError("Файл базы в копии испорчен (не совпадает контрольная сумма) — возьмите другую копию.");
  const rep: RestoreReport = { name: m?.name ?? basename(folder), safety: null, key: "missing", media: null };

  const live = await countRows(prisma).catch(() => ({}) as RowCounts);
  if (opts.safety !== false && Object.values(live).some((n) => n > 0)) {
    log("Сначала — копия текущей базы (на случай, если восстановили не ту копию)…");
    const r = await createBackup({ kind: "pre-restore", who: "восстановление" });
    if (!r.ok) throw new BackupError(`Не удалось сделать копию текущей базы: ${r.error}. Восстановление не начато.`);
    rep.safety = r.name;
  }

  log(`Восстанавливаю базу из ${dump}…`);
  await pgRestore(dump, dbTarget().db, { clean: true });
  // копия снималась, пока стояла отметка «идёт копирование» (она в той же базе) — иначе после восстановления копии не делались бы 3 часа
  await prisma.setting.deleteMany({ where: { key: LOCK_KEY } });

  const material = (await readFile(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ folder, BACKUP_FILES.key), "utf8").catch(() => "")).trim();
  if (material) {
    const fromEnv = process.env.SECRETS_KEY?.trim();
    if (fromEnv) rep.key = keyFingerprint(fromEnv) === keyFingerprint(material) ? "same" : "env-differs";
    else {
      const file = secretsKeyFile();
      const cur = existsSync(/*turbopackIgnore: true*/ file) ? (await readFile(/*turbopackIgnore: true*/ file, "utf8")).trim() : null;
      if (cur !== null && keyFingerprint(cur) === keyFingerprint(material)) rep.key = "same";
      else {
        await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
        if (cur !== null) {
          rep.keyBackup = `${file}.before-restore-${Date.now()}`;
          await rename(/*turbopackIgnore: true*/ file, rep.keyBackup);
        }
        await writeFile(/*turbopackIgnore: true*/ file, `${material}\n`, { mode: 0o600 });
        rep.key = cur === null ? "written" : "replaced";
        resetSecretsKey();
      }
    }
  }

  const mirror = join(/*turbopackIgnore: true*/ folder, "..", "media");
  if (existsSync(/*turbopackIgnore: true*/ mirror)) {
    log(`Копирую фото в ${mediaDir()}…`);
    const r = await mirrorFiles(mirror, mediaDir());
    rep.media = { files: r.files, copied: r.copied };
  }
  await prisma.auditLog.create({ data: { who: "восстановление", action: "backup.restore", target: rep.name, details: json({ safety: rep.safety, key: rep.key }) } }).catch(() => {});
  return rep;
}
