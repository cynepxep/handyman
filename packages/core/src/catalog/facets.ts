// Карта фильтров каталога: разные названия характеристик из фида сводятся к одному фильтру.
// В фиде Vitals ~2000 разных названий (с опечатками и единицами), поэтому фильтры — из проверенного списка.
// Список можно дополнять: добавьте запись в FACET_DEFS и пересоберите поиск (pnpm search:reindex).

import type { FeedParam } from "./feed-parse";

export type FacetDef = {
  /** Короткий код (часть имени поля в поиске: f_<key>). */
  key: string;
  label: string;
  /** Названия характеристик из фида, которые относятся к этому фильтру. */
  names: RegExp;
};

const n = (source: string) => new RegExp(`^(?:${source})$`, "i");

export const FACET_DEFS: FacetDef[] = [
  { key: "series", label: "Серія", names: n("серія") }, // дополняется из названий категорий (см. seriesFromCategories)
  { key: "diameter", label: "Діаметр, мм", names: n("діаметр,?\\s*мм|діаметр диска,?\\s*мм|зовнішній діаметр,?\\s*мм") },
  { key: "landing", label: "Посадковий отвір, мм", names: n("діаметр посадкового отвору,?\\s*мм|посадковий діаметр,?\\s*мм|посадковий отвір,?\\s*мм") },
  { key: "drillDiameter", label: "Діаметр свердла", names: n("діаметр свердла(?:,?\\s*мм)?") },
  { key: "length", label: "Довжина, мм", names: n("довжина,?\\s*мм|довжина свердла(?:,?\\s*мм)?") },
  { key: "thickness", label: "Товщина, мм", names: n("товщина(?:,?\\s*мм)?") },
  { key: "material", label: "Матеріал", names: n("матеріал|робочий матеріал|матеріал виробу|оброблюваний матеріал") },
  { key: "shank", label: "Хвостовик", names: n("хвостовик|тип хвостовика(?: вала)?") },
  { key: "slot", label: "Тип шліца", names: n("тип шліца|шліц|тип наконечника") },
  { key: "packQty", label: "Кількість в упаковці", names: n("кількість в упаковці|кількість у пачці|кількість у комплекті|кількість в наборі") },
  { key: "voltage", label: "Напруга, В", names: n("(?:номінальна )?напруга(?: живлення)?,?\\s*в") },
  { key: "power", label: "Потужність, Вт", names: n("(?:номінальна )?потужність,?\\s*вт") },
  { key: "engine", label: "Тип двигуна", names: n("тип двигуна") },
  { key: "fuel", label: "Паливо", names: n("тип палива|паливо") },
  { key: "grit", label: "Зернистість", names: n("зернистість") },
  { key: "purpose", label: "Призначення", names: n("призначення") },
  { key: "type", label: "Тип", names: n("тип") },
];

const MAX_VALUE_LEN = 40;

// Пробелы схлопываем, первую букву делаем заглавной: «колекторний» и «Колекторний» — одно значение.
const cleanValue = (v: string) => {
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

/** Категории-серии из названий цепочки категорий: «Серія М-Type 18» → «М-Type 18». */
export function seriesFromCategories(chain: string[]): string[] {
  const out: string[] = [];
  for (const name of chain) {
    const m = /^серія\s+(.+)$/i.exec(name.trim());
    if (m) out.push(cleanValue(m[1]));
  }
  return out;
}

/** Фильтры-размеры: значения приводятся к числу, чтобы «3.0 мм», «3,0» и «3» были одним значением. */
export const NUMERIC_FACETS: ReadonlySet<string> = new Set(["diameter", "landing", "drillDiameter", "length", "thickness", "voltage", "power"]);

/**
 * Число из значения размера: «13.0 мм» → «13», «4.5 мм» → «4,5», «2,0» → «2», «22,2» → «22,2».
 * Убирается только единица из подписи фильтра (мм, В, Вт); диапазоны («2.5-4.5») и текст остаются как есть.
 */
export function normalizeNumber(value: string): string {
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:мм|mm|в|v|вт|w)?\.?$/iu.exec(value.trim());
  if (!m) return value;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? String(n).replace(".", ",") : value;
}

/** Числовое значение для сортировки («4,5» → 4.5); не число — NaN. */
export const facetNumber = (value: string) => Number.parseFloat(value.replace(",", "."));

/** Значения фильтра в удобном порядке: размеры — по возрастанию (6, 8, 10), остальное — как пришло. */
export function sortFacetValues<V extends { value: string }>(key: string, values: V[]): V[] {
  if (!NUMERIC_FACETS.has(key) || !values.every((v) => Number.isFinite(facetNumber(v.value)))) return values;
  return [...values].sort((a, b) => facetNumber(a.value) - facetNumber(b.value) || a.value.localeCompare(b.value));
}

/** Значения фильтров товара: код фильтра → значения. Пустые и слишком длинные значения отбрасываются. */
export function extractFacets(params: FeedParam[], categoryChain: string[] = []): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (key: string, value: string) => {
    const v = cleanValue(value);
    if (!v || v.length > MAX_VALUE_LEN) return;
    const list = (out[key] ??= []);
    if (!list.includes(v)) list.push(v);
  };
  for (const p of params) {
    const name = cleanValue(p.name);
    const def = FACET_DEFS.find((d) => d.names.test(name));
    if (!def) continue;
    if (NUMERIC_FACETS.has(def.key)) {
      // «75; 100; 150» — несколько размеров в одном поле
      for (const part of p.value.split(";")) add(def.key, normalizeNumber(cleanValue(part)));
    } else add(def.key, p.value);
  }
  for (const s of seriesFromCategories(categoryChain)) add("series", s);
  return out;
}

export const facetField = (key: string) => `f_${key}`;
export const FACET_FIELDS = FACET_DEFS.map((d) => facetField(d.key));
