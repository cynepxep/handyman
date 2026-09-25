// Фирменный стиль фото товара (выбор владельца 2026-09-26): светлый плавный фон, товар «парит» — приподнят, мягкая тень ниже с зазором,
// маленькая жёлтая метка с круглыми краями. Скругление углов делает рамка на сайте (карточка), в файле фото — квадрат.
// Фон поставщика убирается «разливом» от краёв фото (цвет фона — медиана краёв; внутренние светлые детали товара не трогаем).
// Если фон неоднородный (вырезать надёжно нельзя) — фото кладётся целиком, без вырезки: лучше без эффекта, чем испортить товар.
import sharp, { type OverlayOptions } from "sharp";

/** Версия стиля: поменяли вид — увеличить число, и «Применить стиль» переделает все фото (старые файлы лежат в своей папке). */
export const STYLE_VERSION = 1;
export const STYLE_SIZE = 1000;

const BG = { center: "#ffffff", edge: "#f0efe9" };
const TOL = 26;

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

/** Вырезать фон от краёв. null — фон неоднородный или товар почти во всё фото (вырезать ненадёжно). */
async function cutBackground(input: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const border: number[][] = [];
  for (let x = 0; x < w; x += 4) border.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y += 4) border.push([0, y], [w - 1, y]);
  const px = (x: number, y: number) => (y * w + x) * 4;
  const med = (c: number) => border.map(([x, y]) => data[px(x, y) + c]).sort((a, b) => a - b)[border.length >> 1];
  const ref = [med(0), med(1), med(2)];
  const dist = (i: number) => Math.max(Math.abs(data[i] - ref[0]), Math.abs(data[i + 1] - ref[1]), Math.abs(data[i + 2] - ref[2]));
  // фон должен быть светлым и одинаковым по краям: иначе это фото «в интерьере» — не режем
  const light = ref.every((v) => v >= 200);
  const sameBorder = border.filter(([x, y]) => dist(px(x, y)) <= TOL).length / border.length;
  if (!light || sameBorder < 0.7) return null;

  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const k = y * w + x;
    if (bg[k] || dist(k * 4) > TOL) return;
    bg[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % w, y = (k / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  let bgCount = 0;
  for (let k = 0; k < w * h; k++) bgCount += bg[k];
  const share = bgCount / (w * h);
  if (share < 0.08 || share > 0.985) return null; // почти нет фона или почти нет товара — не режем
  // прозрачность: фон 0, товар 255, край — среднее по соседям 3×3 (без «лесенки»)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += bg[yy * w + xx] ? 0 : 255;
          n++;
        }
      }
      data[(y * w + x) * 4 + 3] = Math.round(sum / n);
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Нарисовать фото товара в фирменном стиле. Возвращает WebP 1000×1000 и признак, удалось ли вырезать фон. */
export async function renderStyled(input: Buffer): Promise<{ webp: Buffer; cut: boolean }> {
  const T = STYLE_SIZE;
  const cutOut = await cutBackground(input).catch(() => null);
  const cut = cutOut != null;
  let src = cutOut ?? (await sharp(input).png().toBuffer());
  if (cut) src = await sharp(src).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 18 }).png().toBuffer();
  const box = Math.round(T * (cut ? 0.74 : 0.84));
  const item = await sharp(src).resize({ width: box, height: box, fit: "inside", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  const m = await sharp(item).metadata();
  const w = m.width ?? box, h = m.height ?? box;
  const left = Math.round((T - w) / 2);
  const top = Math.round((T - h) / 2) - (cut ? Math.round(T * 0.06) : 0);
  const layers: OverlayOptions[] = [];
  if (cut) {
    // тень на «полу» ниже товара, с зазором — товар «парит»
    const floorY = top + h + Math.round(T * 0.075);
    layers.push({
      input: svg(T, T, `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${T * 0.03}"/></filter></defs>
        <ellipse cx="${T / 2}" cy="${Math.min(floorY, T - 30)}" rx="${Math.round(w * 0.36)}" ry="${Math.round(T * 0.022)}" fill="rgba(55,50,35,0.22)" filter="url(#b)"/>`),
      left: 0, top: 0,
    });
  }
  layers.push({ input: item, left, top });
  const pillW = Math.round(T * 0.1), pillH = Math.round(T * 0.016);
  layers.push({ input: svg(pillW, pillH, `<rect width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#ffc61a"/>`), left: Math.round(T * 0.06), top: T - Math.round(T * 0.06) - pillH });
  const back = svg(T, T, `<defs><radialGradient id="g" cx="50%" cy="40%" r="78%"><stop offset="0" stop-color="${BG.center}"/><stop offset="1" stop-color="${BG.edge}"/></radialGradient></defs>
    <rect width="${T}" height="${T}" fill="url(#g)"/>`);
  const webp = await sharp(back).composite(layers).webp({ quality: 82 }).toBuffer();
  return { webp, cut };
}
