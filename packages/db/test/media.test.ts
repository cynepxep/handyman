// Свои копии фото: скачивание (заглушка вместо сайта поставщика), уменьшение, защита путей, фоновый запуск, повторный импорт.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { setupTestDb, waitDone, cleanup, sampleText, skipMsg, file } from "./helpers";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hm-media-"));
process.env.MEDIA_DIR = DIR;

let ready = false;
let prisma: typeof import("../src/client").prisma;
let media: typeof import("../src/media");
let s: Awaited<ReturnType<typeof setupTestDb>>;
let calls = 0;
let png: Buffer;

before(async () => {
  media = await import("../src/media");
  png = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#e53935" } }).png().toBuffer();
  // «сайт поставщика»: фото с «broken» в адресе — ошибка 522, «html» — не картинка, остальные — большая PNG
  media.setMediaFetch(async (url) => {
    calls++;
    const bad = url.includes("broken");
    const html = url.includes("html");
    return {
      ok: !bad, status: bad ? 522 : 200,
      headers: { get: (n: string) => (n === "content-type" ? (html ? "text/html" : "image/png") : null) },
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer,
    };
  });
  s = await setupTestDb();
  if (!s.ok) return;
  prisma = s.prisma;
  ready = true;
});

after(async () => {
  media?.setMediaFetch(null);
  if (ready) await prisma.$disconnect();
  fs.rmSync(DIR, { recursive: true, force: true });
  cleanup();
});

test("фото: скачать, уменьшить до 1200 px в WebP, второй раз не качать; ошибки — понятными словами", async () => {
  const r = await media.storeImage("https://example.com/big.jpg");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.match(r.localUrl, /^\/media\/[0-9a-f]{2}\/[0-9a-f]{40}\.webp$/);
  const meta = await sharp(fs.readFileSync(media.mediaFilePath(r.localUrl)!)).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 900);
  assert.ok(r.bytes < png.length, "копия меньше исходника");
  const before = calls;
  assert.ok((await media.storeImage("https://example.com/big.jpg")).ok);
  assert.equal(calls, before, "уже скачанное фото не качается повторно");
  const bad = await media.storeImage("https://example.com/broken.jpg");
  assert.ok(!bad.ok && /522/.test(bad.error));
  const html = await media.storeImage("https://example.com/page.html");
  assert.ok(!html.ok && /не картинка/.test(html.error));
  assert.equal(media.existingLocalUrl("https://example.com/big.jpg"), r.localUrl);
  assert.equal(media.existingLocalUrl("https://example.com/new.jpg"), null);
});

test("фото: адрес /media/… не выпускает за пределы папки", () => {
  assert.equal(media.mediaFilePath("/media/../../.env"), null);
  assert.equal(media.mediaFilePath("/media/ab/../../x.webp"), null);
  assert.equal(media.mediaFilePath("/media/zz/" + "a".repeat(40) + ".webp"), null);
  assert.equal(media.mediaFilePath("/media/aa/" + "b".repeat(40) + ".webp"), null, "папка — первые 2 знака имени");
  assert.ok(media.mediaFilePath("/media/ab/ab" + "0".repeat(38) + ".webp")?.startsWith(DIR));
});

test("фото поставщика: фоновое скачивание, ход в MediaSyncRun, ошибки не мешают остальным, повторный импорт сохраняет копии", async (t) => {
  if (!ready || !s.ok) return t.skip(skipMsg);
  const runId = await s.imp.startPreview({ supplierId: s.supplierId, source: file(sampleText), who: "test" });
  await s.imp.startApply({ runId, approvedSkus: [], who: "test" });
  await waitDone(s.imp, runId);
  const total = await prisma.productImage.count({ where: { product: { supplierId: s.supplierId } } });
  assert.ok(total > 5, "в образце фида есть фото");
  // одно фото «сломаем» — сайт поставщика отвечает 522
  const victim = await prisma.productImage.findFirstOrThrow({ orderBy: { id: "asc" } });
  await prisma.productImage.update({ where: { id: victim.id }, data: { url: "https://example.com/broken-1.jpg" } });

  media.setMediaBatchSize(3); // несколько пачек: ни одно фото не должно пропасть на стыке (была такая ошибка)
  const { runId: mediaRun, total: planned } = await media.startMediaSync({ supplierId: s.supplierId }, "test");
  assert.equal(planned, total);
  let run = await media.getMediaRun(mediaRun);
  for (let i = 0; i < 300 && run?.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    run = await media.getMediaRun(mediaRun);
  }
  assert.equal(run?.status, "done");
  assert.equal(run?.done, total - 1);
  assert.equal(run?.failed, 1);
  const broken = await prisma.productImage.findUniqueOrThrow({ where: { id: victim.id } });
  assert.equal(broken.localUrl, null);
  assert.match(broken.localError ?? "", /522/);
  const stats = (await media.mediaStats()).find((x) => x.supplierId === s.supplierId)!;
  assert.equal(stats.local, total - 1);
  assert.equal(stats.errors, 1);

  // второй запуск: только недостающие (повтор ошибки), остальное не трогаем
  const again = await media.startMediaSync({ supplierId: s.supplierId }, "test");
  assert.equal(again.total, 1);
  // «только новые» (после импорта) — ошибки прошлых попыток не повторяет
  await new Promise((r) => setTimeout(r, 500));
  const onlyNew = await media.startMediaSync({ supplierId: s.supplierId }, "test", { onlyNew: true });
  assert.equal(onlyNew.total, 0);

  // товар пересоздан импортом (фото удалены и записаны заново) — копия находится сразу, без скачивания
  const img = await prisma.productImage.findFirstOrThrow({ where: { localUrl: { not: null } } });
  await prisma.productImage.delete({ where: { id: img.id } });
  const [row] = media.imageRows([img.url]);
  assert.equal(row.localUrl, img.localUrl);
  const back = await media.readMediaFile(img.localUrl!);
  assert.ok(back && back.length > 100);
});

test("фото: сайт поставщика не работает — после 20 неудач подряд скачивание останавливается с понятной причиной", async (t) => {
  if (!ready || !s.ok) return t.skip(skipMsg);
  const imgs = await prisma.productImage.findMany({ select: { id: true } });
  for (const [i, im] of imgs.entries()) {
    await prisma.productImage.update({ where: { id: im.id }, data: { url: `https://example.com/broken-all-${i}.jpg`, localUrl: null, localError: null } });
  }
  const { runId, total } = await media.startMediaSync({ supplierId: s.supplierId }, "test");
  assert.ok(total > media.GIVE_UP_STREAK);
  let run = await media.getMediaRun(runId);
  for (let i = 0; i < 300 && run?.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    run = await media.getMediaRun(runId);
  }
  assert.equal(run?.status, "failed");
  assert.ok((run?.failed ?? 0) >= media.GIVE_UP_STREAK && (run?.failed ?? 0) < media.GIVE_UP_STREAK + 4, "остановка сразу после 20 неудач подряд");
  assert.match(run?.error ?? "", /сайт поставщика/);
});

test("фирменный стиль: товар на однотонном фоне вырезается и «парит», сложный фон — фото целиком; стиль выключается", async (t) => {
  const style = await import("../src/photo-style");
  // белый фон, красный прямоугольник в центре
  const product = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#ffffff" } })
    .composite([{ input: await sharp({ create: { width: 300, height: 400, channels: 3, background: "#d32f2f" } }).png().toBuffer(), left: 250, top: 200 }])
    .png().toBuffer();
  const a = await style.renderStyled(product);
  assert.equal(a.cut, true);
  const img = sharp(a.webp);
  const meta = await img.metadata();
  assert.equal(meta.width, style.STYLE_SIZE);
  const { data, info } = await sharp(a.webp).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  const corner = at(5, 5);
  assert.ok(corner.every((v) => v > 225), `угол — светлый фон: ${corner}`);
  const centre = at(500, 440);
  assert.ok(centre[0] > 150 && centre[1] < 90, `в середине — товар: ${centre}`);
  // «шумный» фон — не режем, фото кладётся целиком
  const noisy = await sharp(Buffer.from(Array.from({ length: 200 * 200 * 3 }, (_, i) => (i * 97) % 256)), { raw: { width: 200, height: 200, channels: 3 } }).png().toBuffer();
  const b = await style.renderStyled(noisy);
  assert.equal(b.cut, false);

  if (!ready || !s.ok) return t.skip(skipMsg);
  // фоновый запуск по поставщику: стиль делается из своих копий, адрес — /media/s1/…
  // прошлый тест «сломал» все фото — вернём пяти рабочие адреса и скачаем (заглушка отдаёт картинку)
  const five = await prisma.productImage.findMany({ take: 5, orderBy: { id: "asc" }, select: { id: true } });
  for (const [i, im] of five.entries()) await prisma.productImage.update({ where: { id: im.id }, data: { url: `https://example.com/ok-style-${i}.jpg`, localUrl: null, localError: null } });
  await prisma.productImage.updateMany({ data: { styledUrl: null, styledError: null } });
  const dl = await media.startMediaSync({ supplierId: s.supplierId }, "test", { onlyNew: true });
  for (let i = 0; i < 300 && (await media.getMediaRun(dl.runId))?.status === "running"; i++) await new Promise((r) => setTimeout(r, 100));
  const withLocal = await prisma.productImage.count({ where: { localUrl: { not: null }, product: { supplierId: s.supplierId } } });
  assert.ok(withLocal >= 5, `есть свои копии: ${withLocal}`);
  const { runId, total } = await media.startPhotoStyle({ supplierId: s.supplierId }, "test", { limit: 3 });
  assert.equal(total, Math.min(3, withLocal), "проба — не больше заданного");
  let run = await media.getMediaRun(runId);
  for (let i = 0; i < 300 && run?.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    run = await media.getMediaRun(runId);
  }
  assert.equal(run?.status, "done");
  const styled = await prisma.productImage.findFirstOrThrow({ where: { styledUrl: { not: null } } });
  assert.match(styled.styledUrl!, /^\/media\/s1\/[0-9a-f]{2}\/[0-9a-f]{40}\.webp$/);
  assert.ok((await media.readMediaFile(styled.styledUrl!))!.length > 100, "файл стиля отдаётся сайтом");
  assert.equal(media.pickImage(styled, false), styled.localUrl, "стиль выключен — своя копия");
  assert.equal(media.pickImage(styled, true), styled.styledUrl, "стиль включён — фото в стиле");
  assert.equal(media.pickImage({ url: "https://x/y.jpg", localUrl: null, styledUrl: null }, true), "https://x/y.jpg");
  await media.setPhotoStyle(true, "test");
  assert.equal(await media.photoStyleOn(), true);
  await media.setPhotoStyle(false, "test");
  assert.equal(await media.photoStyleOn(), false);
});
