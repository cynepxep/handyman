// Какое фото показывать покупателю: в фирменном стиле (если включён в «Фото товаров» и уже сделан), иначе своя копия, иначе фото поставщика.
// Отдельный маленький модуль без других зависимостей: его читают поиск, заказы и витрина.
import { prisma } from "./client";

export const STYLE_SETTING_KEY = "media.style";
let memo: { at: number; on: boolean } | null = null;

/** Включён ли фирменный стиль фото на сайте. Запоминается на 10 секунд (не спрашивать базу на каждую карточку). */
export async function photoStyleOn(): Promise<boolean> {
  if (memo && Date.now() - memo.at < 10_000) return memo.on;
  const row = await prisma.setting.findUnique({ where: { key: STYLE_SETTING_KEY } }).catch(() => null);
  const on = (row?.value as { on?: unknown } | null)?.on === true;
  memo = { at: Date.now(), on };
  return on;
}

/** Запомнить новое значение сразу (после переключения в админке). */
export function rememberPhotoStyle(on: boolean) {
  memo = { at: Date.now(), on };
}

export function pickImage(img: { url: string; localUrl?: string | null; styledUrl?: string | null }, styleOn: boolean): string {
  return (styleOn && img.styledUrl) || img.localUrl || img.url;
}
