import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backupDue, backupName, compareCounts, formatBytes, keyFingerprint, parseBackupName, pickBackupsToDrop, readS3Check, restoreCheckDue, s3ObjectUrl,
  s3Region, sha256Hex, signS3,
} from "../src/backups";
import { validateField } from "../src/integrations";

test("имя копии — время по Киеву; разбор имени; чужие и опасные имена не принимаются", () => {
  assert.equal(backupName(new Date("2026-09-28T00:30:05Z"), "auto"), "2026-09-28_033005-auto"); // летнее время: UTC+3
  assert.equal(backupName(new Date("2026-12-01T13:07:00Z"), "manual"), "2026-12-01_150700-manual"); // зимнее: UTC+2
  assert.deepEqual(parseBackupName("2026-09-28_033005-auto"), { name: "2026-09-28_033005-auto", ymd: "2026-09-28", time: "03:30", kind: "auto", isoWeek: "2026-W40" });
  assert.equal(parseBackupName("2026-09-28_033005-pre-restore")?.kind, "pre-restore");
  for (const bad of ["../etc", "2026-09-28_033005-auto/../../x", "2026-09-28_253005-auto", "2026-13-40_033005-auto", "media", "2026-09-28_033005"]) {
    assert.equal(parseBackupName(bad), null, bad);
  }
});

/** Ночные копии за n дней подряд, начиная с `from` назад. */
const nightly = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `${new Date(Date.parse(`${from}T12:00:00Z`) - i * 86400_000).toISOString().slice(0, 10)}_033000-auto`, ok: true }));

test("хранение: 14 ежедневных + 8 еженедельных; самая новая остаётся всегда", () => {
  const list = nightly("2026-09-28", 90); // 90 ночей подряд
  const drop = new Set(pickBackupsToDrop(list));
  const kept = list.filter((b) => !drop.has(b.name)).map((b) => b.name);
  // 14 последних дней
  for (const b of list.slice(0, 14)) assert.ok(kept.includes(b.name), b.name);
  // недельные: по одной (самой новой) в каждой из 8 последних недель; 14 дней с понедельника 28.09 задевают 3 недели — ещё 5 недельных
  const weeks = new Set(kept.map((n) => parseBackupName(n)!.isoWeek));
  assert.equal(weeks.size, 8);
  assert.equal(kept.length, 14 + 5);
  assert.ok(!kept.includes(list[89].name), "самая старая удалена");
  // одна копия — не удаляется
  assert.deepEqual(pickBackupsToDrop([{ name: "2020-01-01_033000-auto", ok: true }]), []);
});

test("хранение: за день остаётся самая новая; 5 последних «вручную» — сверх правила; неудачные — только последняя", () => {
  const list = [
    { name: "2026-09-28_033000-auto", ok: true },
    { name: "2026-09-28_150000-manual", ok: true },
    { name: "2026-09-28_160000-auto", ok: false },
    { name: "2026-09-27_033000-auto", ok: false },
    ...Array.from({ length: 7 }, (_, i) => ({ name: `2026-09-20_1${i}0000-manual`, ok: true })),
  ];
  const drop = pickBackupsToDrop(list);
  assert.ok(drop.includes("2026-09-28_033000-auto"), "в тот же день есть копия новее");
  assert.ok(!drop.includes("2026-09-28_150000-manual"));
  assert.ok(!drop.includes("2026-09-28_160000-auto"), "последняя неудачная остаётся — видна ошибка");
  assert.ok(drop.includes("2026-09-27_033000-auto"));
  // «вручную» 20.09: одна из них — ежедневная этого дня (самая новая), ещё 4 — по правилу «5 последних вручную» (первая — 28.09)
  const kept20 = list.filter((b) => b.name.startsWith("2026-09-20") && !drop.includes(b.name));
  assert.equal(kept20.length, 4);
  assert.ok(pickBackupsToDrop([{ name: "не-копия", ok: true }]).length === 0, "чужие папки не трогаем");
});

test("когда: ночная копия с 03:30 по Киеву; проверка — раз в 7 дней с 04:30", () => {
  assert.equal(backupDue(new Date("2026-09-28T00:29:00Z")), false); // 03:29
  assert.equal(backupDue(new Date("2026-09-28T00:30:00Z")), true); // 03:30
  assert.equal(backupDue(new Date("2026-09-28T20:00:00Z")), true); // вечером (сайт был выключен ночью)
  assert.equal(backupDue(new Date("2026-12-01T01:29:00Z")), false); // зимой 03:29
  const at = new Date("2026-09-28T02:00:00Z"); // 05:00
  assert.equal(restoreCheckDue(null, at), true);
  assert.equal(restoreCheckDue(null, new Date("2026-09-28T01:00:00Z")), false, "04:00 — ещё рано");
  assert.equal(restoreCheckDue(new Date("2026-09-25T02:00:00Z"), at), false, "3 дня назад");
  assert.equal(restoreCheckDue(new Date("2026-09-21T02:10:00Z"), at), true, "неделю назад (чуть позже по часам — всё равно пора)");
});

test("сверка числа строк: копия между «до» и «после» — хорошо; меньше/больше/нет таблицы — расхождение", () => {
  assert.deepEqual(compareCounts({ Order: 10, Product: 5 }, { Order: 11, Product: 5 }, { Order: 11, Product: 5 }), []);
  assert.deepEqual(compareCounts({ Order: 10 }, { Order: 10 }, { Order: 3 }), ["Order: в копии 3 строк, а в базе было 10"]);
  assert.deepEqual(compareCounts({ Order: 10 }, { Order: 12 }, { Order: 13 }), ["Order: в копии 13 строк, а в базе было 10–12"]);
  assert.deepEqual(compareCounts({ Order: 1 }, { Order: 1 }, {}), ["таблицы Order нет в восстановленной базе"]);
});

test("размер и отпечаток ключа", () => {
  assert.equal(formatBytes(512), "512 байт");
  assert.equal(formatBytes(1536), "1,5 КБ");
  assert.equal(formatBytes(25 * 1024 * 1024), "25 МБ");
  assert.equal(keyFingerprint("abc"), keyFingerprint(" abc\n"));
  assert.notEqual(keyFingerprint("abc"), keyFingerprint("abd"));
  assert.equal(keyFingerprint("abc").length, 16);
});

test("S3: подпись Signature V4 совпадает с примерами AWS", () => {
  const creds = { region: "us-east-1", accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z") };
  const empty = sha256Hex("");
  const get = signS3({ ...creds, method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" }, payloadHash: empty });
  assert.match(get.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  assert.equal(get["x-amz-date"], "20130524T000000Z");
  assert.equal(get.host, undefined, "host ставит fetch");
  const list = signS3({ ...creds, method: "GET", url: "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", payloadHash: empty });
  assert.match(list.authorization, /Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/);
  const lc = signS3({ ...creds, method: "GET", url: "https://examplebucket.s3.amazonaws.com/?lifecycle", payloadHash: empty });
  assert.match(lc.authorization, /Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543$/);
});

test("S3: адрес объекта, регион по адресу, понятные ответы проверки", () => {
  const c = { endpoint: "https://acc.r2.cloudflarestorage.com/", bucket: "hm-backups" };
  assert.equal(s3ObjectUrl(c, "handyman/db/2026-09-28_033000-auto/db.dump"), "https://acc.r2.cloudflarestorage.com/hm-backups/handyman/db/2026-09-28_033000-auto/db.dump");
  assert.equal(s3ObjectUrl(c, "a b(1).webp"), "https://acc.r2.cloudflarestorage.com/hm-backups/a%20b%281%29.webp");
  assert.equal(s3Region("https://acc.r2.cloudflarestorage.com"), "auto");
  assert.equal(s3Region("https://s3.eu-central-003.backblazeb2.com"), "eu-central-003");
  assert.equal(s3Region("https://s3.eu-central-1.wasabisys.com"), "eu-central-1");
  assert.equal(s3Region("https://minio.local:9000"), "us-east-1");
  assert.equal(s3Region("https://x", " eu-west-2 "), "eu-west-2");
  assert.equal(readS3Check(200, "<ListBucketResult/>").ok, true);
  assert.match(readS3Check(404, "<Error><Code>NoSuchBucket</Code></Error>").message, /корзины/);
  assert.match(readS3Check(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>").message, /Секретный ключ/);
  assert.match(readS3Check(403, "<Error><Code>InvalidAccessKeyId</Code></Error>").message, /ключ доступа/);
  assert.match(readS3Check(400, "<Error><Code>AuthorizationHeaderMalformed</Code></Error>").message, /регион/);
});

test("интеграция «второе хранилище»: адрес https без пути, корзина по правилам S3", () => {
  assert.equal(validateField("backup", "endpoint", "https://acc.r2.cloudflarestorage.com"), null);
  assert.equal(validateField("backup", "endpoint", "http://localhost:9000"), null);
  assert.ok(validateField("backup", "endpoint", "http://example.com"));
  assert.ok(validateField("backup", "endpoint", "https://acc.r2.cloudflarestorage.com/hm-backups"));
  assert.equal(validateField("backup", "bucket", "handyman-backups"), null);
  assert.ok(validateField("backup", "bucket", "Handyman Backups"));
});
