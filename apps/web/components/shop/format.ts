// Форматирование, одинаковое на сервере и в браузере (иначе React ругается на расхождение разметки).

/** 1599 → «1 599 ₴» (неразрывные пробелы, чтобы цена не переносилась). */
export function formatPrice(n: number): string {
  const [int, frac] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped}${frac === "00" ? "" : `,${frac}`} ₴`;
}
