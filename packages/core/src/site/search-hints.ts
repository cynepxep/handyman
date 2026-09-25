// Подсказки поиска на главной и в строке поиска («часто шукають»): сначала то, что задал владелец (текст home.hints),
// потом самые частые запросы покупателей за 30 дней (которые находят товары), потом подразделы, из которых чаще всего заказывают.
// Владелец может скрыть любое слово. Запросы храним без личных данных: телефоны, почту, ссылки и длинные числа не запоминаем.

export type SearchHint = { text: string; href?: string };

const MIN = 2;
const MAX = 40;

/** Привести запрос к виду для статистики. null — не запоминать (слишком коротко/длинно, похоже на личные данные или артикул). */
export function normalizeQuery(raw: string): string | null {
  const q = String(raw ?? "")
    .toLowerCase()
    .replace(/[«»"'`’ʼ]/g, "")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  if (q.length < MIN || q.length > MAX) return null;
  if (!/\p{L}/u.test(q)) return null; // только цифры — это артикул или телефон
  if (/@|https?:|www\.|\.(com|ua|net|org)\b/.test(q)) return null; // почта, ссылки
  if ((q.match(/\d/g) ?? []).length > 6) return null; // телефон или номер документа
  return q;
}

/** Слова, которые владелец скрыл (по одному в строке или через запятую) → нормализованный список. */
export function parseHidden(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\n,]/);
  return [...new Set(list.map((s) => normalizeQuery(s) ?? "").filter(Boolean))].slice(0, 200);
}

/**
 * Итоговый список подсказок: сначала заданные владельцем, затем популярные запросы, затем популярные подразделы;
 * без повторов (без учёта регистра) и без скрытых; не больше `max`.
 */
export function mergeHints(opts: {
  pinned: string[];
  popular: string[];
  fromOrders?: SearchHint[];
  hidden?: string[];
  max: number;
}): SearchHint[] {
  const hidden = new Set(opts.hidden ?? []);
  const seen = new Set<string>();
  const out: SearchHint[] = [];
  const push = (h: SearchHint) => {
    const key = normalizeQuery(h.text) ?? h.text.toLowerCase().trim();
    if (!h.text.trim() || seen.has(key) || hidden.has(key) || out.length >= opts.max) return;
    seen.add(key);
    out.push({ ...h, text: h.text.trim() });
  };
  for (const t of opts.pinned) push({ text: t });
  for (const t of opts.popular) push({ text: t });
  for (const h of opts.fromOrders ?? []) push(h);
  return out;
}
