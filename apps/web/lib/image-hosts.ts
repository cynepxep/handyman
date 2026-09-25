// Сайты поставщиков, чьи фото наш сервер уменьшает «на лету» (next/image). Один список — и для next.config, и для витрины.
// Фото других сайтов (новый поставщик, пока его фото не скачаны в «Фото товаров») показываются как есть — без ошибки на странице.
export const IMAGE_HOSTS = ["vitals.ua"];

/** Можно ли отдавать фото через оптимизацию next/image: свои копии (/media/…) и фото с сайтов из списка. */
export function optimizable(src: string): boolean {
  if (src.startsWith("/")) return true;
  try {
    const u = new URL(src);
    return u.protocol === "https:" && IMAGE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}
