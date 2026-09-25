// Короткие характеристики на карточке товара («18 В · 900 Вт · Безщітковий», «Ø 8 мм · 117 мм»).
// У поставщика одна и та же характеристика называется по-разному («Номінальна потужність, Вт», «Потужність, кВт / к.с.»…):
// здесь словарь понятных характеристик — каждая узнаётся по любому варианту названия и пишется коротко.
// Какие показывать — решается для каждого подраздела по данным (planCardSpecs): те, что есть у большинства товаров
// и отличаются от товара к товару, в порядке важности. Без зависимостей: работает и в браузере, и в тестах.

export type SpecLang = "uk" | "ru";
type Param = { name: string; value: string };

/** Название характеристики к виду для сравнения: строчные, одни апострофы и пробелы, без двоеточий в конце. */
export const normName = (s: string) =>
  s.toLowerCase().replace(/[’ʼ`'‘]/g, "'").replace(/\s+/g, " ").replace(/[:\s]+$/, "").trim();

const num = (s: string) => {
  const m = /-?\d+(?:[.,]\d+)?/.exec(s);
  return m ? Number(m[0].replace(",", ".")) : null;
};
/** Число по-украински: 3.5 → «3,5», 11000 → «11 000». */
const fmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  const [i, f] = String(r).split(".");
  const int = i.length > 4 ? i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : i;
  return f ? `${int},${f}` : int;
};
/** Последнее число строки (для «0-1400», «1-й режим: 32, 2-й: 17» берём максимум). */
const maxNum = (s: string) => {
  const all = [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  return all.length ? Math.max(...all) : null;
};
const short = (s: string, max = 22) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

type Def = {
  key: string;
  /** важность: меньше — важнее (в карточку попадают 3 самых важных из подходящих разделу) */
  priority: number;
  /** узнать по названию (уже normName) */
  match: RegExp;
  /** не путать: названия, которые похожи, но это другое */
  not?: RegExp;
  format: (value: string, lang: SpecLang, name: string) => string | null;
};

const W = (uk: string, ru: string) => (lang: SpecLang) => (lang === "ru" ? ru : uk);
const pcs = W("шт", "шт");

export const CARD_SPECS: Def[] = [
  {
    key: "voltage", priority: 10, match: /напруга/, not: /частота|заряджання|діапазон|струм/,
    format: (v) => { const n = num(v); return n != null && n > 0 && n <= 1000 ? `${fmt(n)} В` : null; },
  },
  {
    key: "power", priority: 12, match: /потужність/, not: /коефіцієнт/,
    format: (v, _l, name) => {
      const pair = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/.exec(v);
      // «к.с.» — только с точкой и отдельным словом («максимальна» тоже содержит «кс»)
      const hp = /(^|[\s,(/])к\.\s?с\.?/.test(name);
      const hpFirst = /(^|[\s,(/])к\.\s?с\.?\s*\/\s*квт/.test(name); // «к.с./кВт: 2,0/1,5» — кВт второе число
      const n = hpFirst && pair ? Number(pair[2].replace(",", ".")) : num(v);
      if (n == null || n <= 0) return null;
      if (hpFirst) return `${fmt(n)} кВт`;
      if (/ква|кв[·.]\s?а/.test(name)) return `${fmt(n)} кВА`;
      if (hp && !/квт/.test(name)) return `${fmt(n)} к.с.`;
      if (/квт/.test(name)) return n >= 1000 ? `${fmt(n)} Вт` : `${fmt(n)} кВт`;
      return pair && /вт\/год|\//.test(v) ? `${fmt(Number(pair[1].replace(",", ".")))}/${fmt(Number(pair[2].replace(",", ".")))} Вт` : `${fmt(n)} Вт`;
    },
  },
  {
    key: "capacity", priority: 14, match: /ємність.*(а\.?[·.]?\s?год|ач)|ємність акумулятор/,
    format: (v, _l, name) => {
      const n = num(v);
      if (!n) return null;
      return /ма[·.]?\s?год|мач/.test(name) || n > 500 ? `${fmt(n)} мА·год` : `${fmt(n)} А·год`;
    },
  },
  {
    key: "engine", priority: 16, match: /^тип двигуна/,
    format: (v, lang) => {
      const s = v.toLowerCase();
      if (/безщітк|безколектор|brushless/.test(s)) return W("Безщітковий", "Бесщёточный")(lang);
      if (/щітк|колектор/.test(s)) return W("Щітковий", "Щёточный")(lang);
      if (/2-?такт|двотакт/.test(s)) return W("2-тактний", "2-тактный")(lang);
      if (/4-?такт|чотиритакт/.test(s)) return W("4-тактний", "4-тактный")(lang);
      return null;
    },
  },
  {
    key: "torque", priority: 11, match: /крутний момент|крутящий момент/,
    format: (v) => { const n = maxNum(v); return n ? `${fmt(n)} Н·м` : null; },
  },
  {
    key: "drillDiameter", priority: 20, match: /^діаметр свердла/,
    format: (v) => { const n = num(v); return n ? `Ø ${fmt(n)} мм` : null; },
  },
  {
    key: "diameter", priority: 20,
    match: /^(max\.? )?(максимальний )?діаметр( диска| відрізного диска| скошування диском)?(,? ?мм|,? ?дюйм|,? ?см)?$/,
    format: (v, _l, name) => {
      if (/дюйм/.test(name)) { const m = /\d+(?:\/\d+)?/.exec(v); return m ? `Ø ${m[0]}"` : null; }
      const n = num(v);
      if (!n) return null;
      return /см/.test(name) ? `Ø ${fmt(n)} см` : `Ø ${fmt(n)} мм`;
    },
  },
  {
    key: "bar", priority: 21, match: /^довжина шини/,
    format: (v, lang) => {
      const cm = /\((\d+(?:[.,]\d+)?)\s*(?:см)?\)/.exec(v) ?? /(\d+(?:[.,]\d+)?)\s*см/.exec(v);
      const n = cm ? Number(cm[1].replace(",", ".")) : num(v);
      if (!n) return null;
      const val = cm ? n : n <= 24 ? Math.round(n * 2.54) : n; // «15» — это дюймы
      return `${W("шина", "шина")(lang)} ${fmt(val)} см`;
    },
  },
  {
    key: "size", priority: 23, match: /^(тип шліца|розміри|розмір головок, мм|шліц)$/,
    format: (v) => {
      const parts = v.split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
      if (!parts.length) return null;
      return parts.length > 3 ? short(`${parts.slice(0, 3).join(", ")}…`, 24) : short(parts.join(", "), 24);
    },
  },
  {
    key: "length", priority: 26,
    match: /^(довжина|загальна довжина|довжина свердла)(,? ?мм|,? ?м|,? ?см)?$/,
    format: (v, _l, name) => {
      if (/;/.test(v)) return null; // «75; 100; 150» — это набор, а не одна длина
      const n = num(v);
      if (!n) return null;
      if (/(^|[\s,])см$/.test(name) || /\d\s*см/.test(v)) return `${fmt(n)} см`;
      if (/(^|[\s,])м$/.test(name) || /\d\s*м$/.test(v)) return `${fmt(n)} м`;
      return `${fmt(n)} мм`;
    },
  },
  {
    key: "teeth", priority: 28, match: /кількість зуб|зубів на дюйм|зубців на дюйм/,
    format: (v, lang, name) => {
      const n = num(v);
      if (!n) return null;
      if (/дюйм/.test(name) || /tpi/i.test(v)) return `${fmt(n)} TPI`;
      return `${fmt(n)} ${W("зубів", "зубьев")(lang)}`;
    },
  },
  {
    key: "grit", priority: 28, match: /^зернистість/,
    format: (v) => { const n = num(v); return n ? `P${fmt(n)}` : null; },
  },
  {
    key: "landing", priority: 30, match: /посад(ков|оч)/, not: /кільц/,
    format: (v, lang) => { const m = /\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?/.exec(v); return m ? `${W("посадка", "посадка")(lang)} ${m[0].replace(".", ",")}` : null; },
  },
  {
    key: "chuck", priority: 32, match: /^тип патрона/,
    format: (v) => { const s = /sds[‑-]?\s?(plus|max|hex)/i.exec(v); return s ? `SDS-${cap(s[1].toLowerCase())}` : short(v.replace(/^квадрат/i, "□"), 16); },
  },
  {
    key: "shank", priority: 33, match: /^(тип )?хвостовик(а)?( вала)?$/,
    format: (v) => short(v.replace(/sds[‑-]?\s?\+/i, "SDS-Plus"), 16),
  },
  {
    key: "impact", priority: 34, match: /сила удару|енергія удару/,
    format: (v) => { const n = maxNum(v); return n ? `${fmt(n)} Дж` : null; },
  },
  {
    key: "fuel", priority: 36, match: /^(тип палива|паливо)$/,
    format: (v, lang) => {
      const s = v.toLowerCase();
      if (/дизел/.test(s)) return W("Дизель", "Дизель")(lang);
      if (/суміш/.test(s)) return W("Бензин + мастило", "Бензин + масло")(lang);
      if (/бензин/.test(s)) return W("Бензин", "Бензин")(lang);
      return null;
    },
  },
  {
    key: "displacement", priority: 37, match: /робочий об'?єм/,
    format: (v) => { const n = num(v); return n ? `${fmt(n)} см³` : null; },
  },
  {
    key: "chainPitch", priority: 38, match: /^крок ланцюга/,
    format: (v, lang) => { const m = /\d\/\d+|0[.,]\d+/.exec(v); return m ? `${W("крок", "шаг")(lang)} ${m[0].replace(",", ".")}"` : null; },
  },
  {
    key: "area", priority: 40, match: /площа опалення/,
    format: (v, lang) => { const n = maxNum(v); return n ? `${W("до", "до")(lang)} ${fmt(n)} м²` : null; },
  },
  {
    key: "pressure", priority: 40, match: /тиск робочий|робочий тиск/,
    format: (v) => { const n = maxNum(v); return n ? `${fmt(n)} бар` : null; },
  },
  {
    key: "current", priority: 41, match: /(робочий|зварювальний) струм|максимальний +робочий струм/,
    format: (v) => { const n = maxNum(v); return n ? `${fmt(n)} А` : null; },
  },
  {
    key: "clamp", priority: 42, match: /^ширина (затиску|захвату|губок)/,
    format: (v, lang) => { const n = num(v); return n ? `${W("захват", "захват")(lang)} ${fmt(n)} мм` : null; },
  },
  {
    key: "tank", priority: 44, match: /об'?єм паливного бака|ємність паливного бака/,
    format: (v, lang, name) => { const n = num(v); return n ? `${W("бак", "бак")(lang)} ${fmt(n)} ${/мл/.test(name) ? "мл" : "л"}` : null; },
  },
  {
    key: "packQty", priority: 50,
    match: /^(кількість (в|у) (упаковці|пачці|пакованні|наборі|комплекті)|кіл-сть в упаковці|кількість одиниць( у наборі)?|кількість лез|кількість)(,? ?шт\.?)?$/,
    format: (v, lang) => { const n = num(v); return n && n > 1 ? `${fmt(n)} ${pcs(lang)}` : null; },
  },
  {
    key: "material", priority: 55, match: /^(матеріал|матеріал виготовлення|матеріал стрижня викрутки|матеріал леза|матеріал полотна|сталь)$/,
    format: (v) => short(v.replace(/^сталь (марки )?/i, "").replace(/\s*\(.*?\)\s*/g, " "), 18),
  },
  {
    key: "workMaterial", priority: 60, match: /^(робочий матеріал|призначення)$/,
    format: (v) => short(v, 22),
  },
  {
    key: "rpm", priority: 70, match: /(швидкість|частота) (обертання|обертів)|максимальна кількість обертів|максимальна швидкість, об/,
    format: (v) => { const n = maxNum(v); return n && n > 100 ? `${fmt(n)} об/хв` : null; },
  },
  {
    key: "weight", priority: 80, match: /^(вага|маса)( нетто)?( ?\/ ?брутто)?(,? ?кг|,? ?г)?$|^робоча вага|^маса споряджена/,
    format: (v, _l, name) => { const n = num(v); if (!n) return null; return /(^|[\s,])г$/.test(name) ? `${fmt(n)} г` : `${fmt(n)} кг`; },
  },
];

const DEF = new Map(CARD_SPECS.map((d) => [d.key, d]));

/** «АКБ у комплекті» — по названию (Kit) или по «Комплектації». Особая характеристика: только у аккумуляторного инструмента. */
function kitOf(params: Param[], productName: string): "with" | "without" | null {
  if (/\bkit\b/i.test(productName)) return "with";
  const k = params.find((p) => /^комплектація/.test(normName(p.name)));
  if (k && /не вход|не в комплект/i.test(k.value)) return "without";
  return null;
}
const KIT_TEXT = { with: W("З АКБ і ЗП", "С АКБ и ЗУ"), without: W("Без АКБ", "Без АКБ") };

/** Какие понятные характеристики есть у товара: ключ → исходное значение (для подсчёта разнообразия) и название. */
export function readCardSpecs(params: Param[], productName = ""): Map<string, { value: string; name: string }> {
  const out = new Map<string, { value: string; name: string }>();
  for (const p of params) {
    const name = normName(p.name);
    const value = p.value.trim();
    if (!name || !value) continue;
    for (const d of CARD_SPECS) {
      if (out.has(d.key) || !d.match.test(name) || d.not?.test(name)) continue;
      if (d.format(value, "uk", name) == null) continue;
      out.set(d.key, { value, name });
      break;
    }
  }
  const kit = kitOf(params, productName);
  if (kit) out.set("kit", { value: kit, name: "kit" });
  return out;
}

/**
 * Какие характеристики показывать в подразделе: есть хотя бы у четверти товаров и отличаются между товарами (одинаковая у всех —
 * бесполезна для выбора), в порядке важности; «АКБ у комплекті» — первой, если в разделе такое встречается. Не больше `max`:
 * кандидатов берём с запасом, а на карточку попадают первые три, которые есть у самого товара (у гайковерта — момент, у пилы — мощность).
 */
export function planCardSpecs(products: Array<Map<string, { value: string; name: string }>>, max = 4): string[] {
  const n = products.length;
  if (!n) return [];
  const stats = new Map<string, { count: number; values: Set<string> }>();
  for (const p of products) {
    for (const [key, { value }] of p) {
      const s = stats.get(key) ?? stats.set(key, { count: 0, values: new Set() }).get(key)!;
      s.count++;
      s.values.add(value.toLowerCase());
    }
  }
  const good = [...stats.entries()]
    .filter(([key, s]) => (key === "kit" ? s.count / n >= 0.1 : s.count / n >= 0.25 && s.values.size >= 2))
    .map(([key]) => key)
    .sort((a, b) => (a === "kit" ? -1 : b === "kit" ? 1 : (DEF.get(a)?.priority ?? 99) - (DEF.get(b)?.priority ?? 99)));
  // «Ø» два раза не нужен: диаметр свердла важнее просто диаметра
  const res = good.filter((k, _i, arr) => !(k === "diameter" && arr.includes("drillDiameter")));
  return res.slice(0, max);
}

/** Тексты характеристик товара для карточки по плану подраздела (если чего-то нет у товара — пропускается). */
export function cardSpecTexts(found: Map<string, { value: string; name: string }>, plan: string[], lang: SpecLang, max = 3): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  for (const key of plan) {
    if (out.length >= max) break;
    const f = found.get(key);
    if (!f) continue;
    const text = key === "kit" ? KIT_TEXT[f.value as "with" | "without"]?.(lang) : DEF.get(key)?.format(f.value, lang, f.name);
    if (text) out.push({ key, text });
  }
  return out;
}
