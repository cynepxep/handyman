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
    if (def) add(def.key, p.value);
  }
  for (const s of seriesFromCategories(categoryChain)) add("series", s);
  return out;
}

export const facetField = (key: string) => `f_${key}`;
export const FACET_FIELDS = FACET_DEFS.map((d) => facetField(d.key));
