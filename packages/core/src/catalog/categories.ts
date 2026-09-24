// Сопоставление категорий фида поставщика с нашими и построение подкатегорий.
// Логика перенесена из старого autoCategory (handyman/src/feed.js) и адаптирована под украинские названия Vitals.

/** Разделитель в пути категории, как показывается владельцу и хранится в FeedCategoryMap.path. */
export const PATH_SEP = " / ";
/** Условный путь для товаров без категории в фиде. */
export const NO_CATEGORY_PATH = "(без категорії)";
/** Наши 7 стартовых категорий (сид Этапа 0). */
export const OUR_CATEGORY_IDS = ["ak", "el", "gr", "hand", "acc", "bld", "pw"] as const;
/**
 * Системная категория «Нераспределённые»: сюда импорт кладёт товары без категории в фиде.
 * Покупателям такие товары не показываются (не попадают в поиск), пока их не перенесут в обычную категорию.
 */
export const UNSORTED_ID = "unsorted";
export const UNSORTED_NAME_UK = "Нерозподілені";
export const UNSORTED_NAME_RU = "Нераспределённые";
/** Сколько уровней подкатегорий создаём под нашей категорией (глубже — сворачиваем). */
export const MAX_SUB_LEVELS = 2;

export type CategoryDecision =
  | { kind: "skip"; reason: string }
  /** depth — сколько первых сегментов пути «съела» наша категория; остальные становятся подкатегориями. */
  | { kind: "category"; categoryId: string; depth: number }
  | { kind: "new"; categoryId: string; name: string; depth: number };

/** Решения владельца: ключ — путь категории фида через PATH_SEP. */
export type StoredMapping = ReadonlyMap<string, { categoryId: string | null; skip: boolean }>;

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ж: "zh", з: "z", и: "y", і: "i", ї: "yi", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch",
  ш: "sh", щ: "shch", ь: "", ю: "yu", я: "ya", ъ: "", ы: "y", э: "e", ё: "yo",
};

/** Латинский «слаг» для кода категории и будущих адресов: «Кутові шліфувальні машини» → kutovi-shlifuvalni-mashyny. */
export function slugify(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) {
    if (ch in TRANSLIT) out += TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "-";
  }
  return out.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).slice(0, 5);
}

/** Код подкатегории: родитель + слаг названия; слишком длинный сокращается с хвостом-хэшем. */
export function subCategoryId(parentId: string, name: string): string {
  const slug = slugify(name) || shortHash(name);
  const id = `${parentId}-${slug}`;
  return id.length <= 80 ? id : `${id.slice(0, 72)}-${shortHash(id)}`;
}

const ARCHIVE = /^архів/i;
const BATTERY = /акумуляторн|smartline|m-type|м-type/i; // в фиде встречается и латинская M, и кириллическая М
const ACCESSORY = /витратн|аксесуар|оснастк|насадк|комплектуюч/i;
const POWER = /генератор|компресор|зарядн|пуско|стабілізатор|безперебійн|мотопомп|двигун|мотор|станці|дбж|інвертор/i;
const BUILDING = /бетонозмішувач|віброплит|віброрейк|вібротрамбов|затиральн|бензоріз|тачк/i;

/** Автоподсказка по названиям категорий (по умолчанию, пока владелец не выбрал сам). */
export function suggestDecision(path: string[]): CategoryDecision {
  if (path.some((s) => ARCHIVE.test(s.trim()))) return { kind: "skip", reason: "Архів продукції" };
  const root = path[0].toLowerCase();
  if (root.includes("будівельна хімія")) {
    return { kind: "skip", reason: "Будівельна хімія (будматеріали не входять в асортимент)" };
  }
  if (root.startsWith("силова")) return { kind: "category", categoryId: "pw", depth: 1 };

  const firstMatch = (re: RegExp, from = 0): number => path.findIndex((s, i) => i >= from && re.test(s));
  const battery = firstMatch(BATTERY);
  if (battery >= 0) return { kind: "category", categoryId: "ak", depth: battery + 1 };
  const acc = firstMatch(ACCESSORY, 1);
  if (acc >= 0) return { kind: "category", categoryId: "acc", depth: acc + 1 };
  const pw = firstMatch(POWER, 1);
  if (pw >= 0) return { kind: "category", categoryId: "pw", depth: pw + 1 };
  if (root.startsWith("будівельне обладнання")) return { kind: "category", categoryId: "bld", depth: 1 };
  const bld = firstMatch(BUILDING, 1);
  if (bld >= 0) return { kind: "category", categoryId: "bld", depth: bld + 1 };
  if (root.startsWith("ручний інструмент")) return { kind: "category", categoryId: "hand", depth: 1 };
  if (root.startsWith("електроінструмент")) return { kind: "category", categoryId: "el", depth: 1 };
  if (root.startsWith("садово")) return { kind: "category", categoryId: "gr", depth: 1 };
  // Зварювальне обладнання, Лазерна техніка, Обігрівачі и т.п.: своя категория с названием корня фида.
  return { kind: "new", categoryId: slugify(path[0]) || `feed-${shortHash(path[0])}`, name: path[0], depth: 1 };
}

/** Итоговое решение для пути: самое длинное решение владельца, иначе автоподсказка. */
export function decideCategory(path: string[] | null, stored: StoredMapping): CategoryDecision {
  if (!path || !path.length) {
    // Товары без категории по умолчанию попадают в «Нераспределённые» — владелец раскладывает их вручную.
    const s = stored.get(NO_CATEGORY_PATH);
    if (s?.skip) return { kind: "skip", reason: "Выбрано «не загружать»" };
    return { kind: "category", categoryId: s?.categoryId ?? UNSORTED_ID, depth: 0 };
  }
  for (let k = path.length; k >= 1; k--) {
    const s = stored.get(path.slice(0, k).join(PATH_SEP));
    if (!s) continue;
    if (s.skip || !s.categoryId) return { kind: "skip", reason: "Выбрано «не загружать»" };
    return { kind: "category", categoryId: s.categoryId, depth: k };
  }
  return suggestDecision(path);
}

export type CategoryPlacement = {
  /** Категория верхнего уровня (нашей структуры). */
  topId: string;
  /** Если категорию надо создать (для «new») — её название. */
  topNewName: string | null;
  /** Подкатегории по порядку сверху вниз: их коды и названия (до MAX_SUB_LEVELS). */
  subs: { id: string; name: string }[];
};

/** Куда положить товар: категория + цепочка подкатегорий из оставшихся сегментов пути. */
export function placeInTree(path: string[] | null, decision: CategoryDecision): CategoryPlacement | null {
  if (decision.kind === "skip") return null;
  const rest = (path ?? []).slice(decision.depth, decision.depth + MAX_SUB_LEVELS);
  const subs: { id: string; name: string }[] = [];
  let parent = decision.categoryId;
  for (const name of rest) {
    const id = subCategoryId(parent, name);
    subs.push({ id, name });
    parent = id;
  }
  return { topId: decision.categoryId, topNewName: decision.kind === "new" ? decision.name : null, subs };
}

/** Код категории, в которую попадёт товар (самая глубокая из цепочки). */
export function placementLeafId(p: CategoryPlacement): string {
  return p.subs.length ? p.subs[p.subs.length - 1].id : p.topId;
}
