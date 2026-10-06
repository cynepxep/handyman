// Подсказка «куда положить категорию в меню» для категорий, которых нет в меню (обычно — разделы нового поставщика после импорта).
// По словам: название категории сравнивается с подгруппами меню — их названиями и названиями категорий, которые в них уже лежат.
// Нет подходящей подгруппы — предлагается новая подгруппа с названием категории (одинаковые разделы разных серий — «M18 › Гайковерти»
// и «M12 › Гайковерти» — в одну). Аккумуляторный инструмент — только в группу аккумуляторного, остальное — в другие группы.
// Чистая логика, без базы; решение принимает владелец на экране «Сайт → Меню и задачи».

import { SYNONYM_GROUPS } from "./search-text";
import { addSub, assignCategories, cleanName, moveClaim, type MenuConfig, type MenuGroup } from "./storefront-menu";

export type NamedCat = { id: string; parentId: string | null; nameUk: string; nameRu?: string | null };

/** В существующую подгруппу или в новую (новые с одинаковым `key` — одна подгруппа). */
export type MenuSuggestion =
  | { kind: "sub"; subId: string; score: number }
  | { kind: "new"; groupId: string; key: string; nameUk: string; nameRu: string; score: number };

const STOP = new Set([
  "для", "та", "або", "інші", "інше", "інший", "інша", "прочие", "прочее", "другие", "под", "без", "все", "усі", "всі", "від", "от",
  "набір", "набори", "набор", "наборы", "комплект", "комплекти", "серія", "серия", "milwaukee", "мілуокі", "милуоки",
  "інструмент", "інструменти", "инструмент", "инструменты", "fuel", "one", "key",
]);
/** Слова, по которым не выбирают подгруппу: они есть почти у всего (аккумуляторный, электро-, от сети). */
const GENERIC = new Set(["акумн", "елект", "элект", "мереж", "сети"]);

/** Аккумуляторный инструмент и всё к нему (по названию категории или её родителей). */
const BATTERY_RE = /акумулятор|аккумулятор|\bm1[28]\b|\bm4\b|m-?type|smartline|\bmx\b/i;
/** Слова серий и «аккумуляторный» убираются из названия новой подгруппы: «Акумуляторні гайковерти M18» → «Гайковерти». */
const NAME_NOISE_RE = /\b(?:m1[28]|m4|mx|fuel|one-key|milwaukee)\b|акумуляторн\p{L}*|аккумуляторн\p{L}*/giu;

/** Основа слова: строчные, без апострофов; длинные слова — первые 5 букв, короткие — без окончания («дрилі», «дриль» → «дрил»). */
export function wordStem(word: string): string | null {
  const w = word.toLowerCase().replace(/ё/g, "е").replace(/[’ʼ'`‘]/g, "");
  if (w.length < 3 || /^\d/.test(w) || /^m\d+$/.test(w) || STOP.has(w)) return null; // M18, M12 — серии, не вид товара
  if (/^ак+умуляторн/.test(w)) return "акумн"; // «акумуляторний» (прилагательное) — общее слово; «акумулятори» — сам товар
  if (w.length >= 6) return w.slice(0, 5);
  const s = w.replace(/[аеиіоуяюєїьйы]+$/u, "");
  return s.length >= 3 ? s : w;
}

/** Синонимы из поиска (одно слово ↔ одно слово): «дрель» и «дриль», «болгарка» и «кшм» — одна основа. */
const CANON: Map<string, string> = (() => {
  const out = new Map<string, string>();
  for (const group of SYNONYM_GROUPS) {
    const single = group.filter((w) => !/\s/.test(w)).map(wordStem).filter((s): s is string => s != null);
    for (const s of single) if (!out.has(s)) out.set(s, single[0]);
  }
  return out;
})();

/** Основы слов текста (без повторов). */
export function textStems(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[^\p{L}\p{N}’ʼ'`‘]+/u)) {
    const s = wordStem(raw);
    if (s) out.add(CANON.get(s) ?? s);
  }
  return [...out];
}

const namesOf = (c: { nameUk: string; nameRu?: string | null }) => `${c.nameUk} ${c.nameRu ?? ""}`;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Название новой подгруппы из названия категории: без серий и «акумуляторні», с заглавной. */
export function subNameFrom(name: string): string {
  const s = cleanName(name.replace(NAME_NOISE_RE, " ").replace(/\s+([,.;])/g, "$1").replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, ""));
  return cap(s || cleanName(name));
}

/** Группа аккумуляторного инструмента: «cordless» или группа со словом «акумулятор» в названии. */
const batteryGroupOf = (groups: MenuGroup[]) => groups.find((g) => g.id === "cordless") ?? groups.find((g) => BATTERY_RE.test(namesOf(g)));

/**
 * Для каждой категории из `ids` — подгруппа меню с наибольшим совпадением слов, иначе новая подгруппа в подходящей группе,
 * иначе ничего (владелец выберет сам). Своё название категории весит втрое больше, чем названия её родителей.
 */
export function suggestMenuPlacement(cats: NamedCat[], cfg: MenuConfig, ids: string[]): Map<string, MenuSuggestion> {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const { subOf } = assignCategories(cats, cfg.groups);

  // словарь подгруппы — её название и названия категорий, которые уже в ней показываются; словарь группы — её название и все подгруппы
  const subWords = new Map<string, Set<string>>();
  const groupOfSub = new Map<string, string>();
  for (const g of cfg.groups) {
    for (const s of g.subs) {
      if (s.hidden) continue;
      subWords.set(s.id, new Set(textStems(namesOf(s))));
      groupOfSub.set(s.id, g.id);
    }
  }
  for (const [catId, subId] of subOf) {
    const c = byId.get(catId);
    const p = subWords.get(subId);
    if (c && p) for (const s of textStems(namesOf(c))) p.add(s);
  }
  const groupWords = new Map<string, Set<string>>();
  for (const g of cfg.groups) {
    if (g.hidden) continue;
    const set = new Set(textStems(namesOf(g)));
    for (const s of g.subs) for (const w of subWords.get(s.id) ?? []) set.add(w);
    groupWords.set(g.id, set);
  }
  // вес слова: чем в меньшем числе подгрупп оно встречается, тем больше
  const df = new Map<string, number>();
  for (const p of subWords.values()) for (const s of p) df.set(s, (df.get(s) ?? 0) + 1);
  const n = Math.max(1, subWords.size);
  const idf = (s: string) => Math.log(1 + n / (df.get(s) ?? 0.5));
  const batteryGroup = batteryGroupOf(cfg.groups.filter((g) => !g.hidden));

  const out = new Map<string, MenuSuggestion>();
  const newKeys = new Map<string, { nameUk: string; nameRu: string }>();
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) continue;
    const chain: NamedCat[] = [];
    for (let cur = c.parentId ? byId.get(c.parentId) : undefined, i = 0; cur && i < 6; cur = cur.parentId ? byId.get(cur.parentId) : undefined, i++) chain.push(cur);
    const own = textStems(namesOf(c)).filter((s) => !GENERIC.has(s));
    const parents = [...new Set(chain.flatMap((p) => textStems(namesOf(p))))].filter((s) => !GENERIC.has(s) && !own.includes(s));
    const battery = BATTERY_RE.test([c, ...chain].map(namesOf).join(" "));
    // аккумуляторное — только в группу аккумуляторного инструмента, остальное — только в другие группы
    const allowed = (groupId: string) => !batteryGroup || (groupId === batteryGroup.id) === battery;

    let best: MenuSuggestion | null = null;
    for (const [subId, words] of subWords) {
      const groupId = groupOfSub.get(subId)!;
      if (!allowed(groupId)) continue;
      let ownScore = 0;
      for (const s of own) if (words.has(s)) ownScore += idf(s);
      if (ownScore === 0) continue; // без совпадения в своём названии не угадываем
      let score = ownScore * 3;
      for (const s of parents) if (words.has(s)) score += idf(s);
      if (!best || score > best.score) best = { kind: "sub", subId, score: Math.round(score * 100) / 100 };
    }
    if (!best && own.length) {
      // новая подгруппа: в группе аккумуляторного (если это он) или в группе, на которую больше всего похожи категория и её родители
      let groupId = battery ? batteryGroup?.id ?? null : null;
      let score = 0;
      if (!groupId) {
        for (const [gid, words] of groupWords) {
          if (!allowed(gid)) continue;
          let sc = 0;
          for (const s of own) if (words.has(s)) sc += 3 * idf(s);
          for (const s of parents) if (words.has(s)) sc += idf(s);
          if (sc > score) { score = sc; groupId = gid; }
        }
      }
      if (groupId) {
        const nameUk = subNameFrom(c.nameUk);
        const nameRu = subNameFrom(c.nameRu?.trim() || c.nameUk);
        const key = `${groupId}:${textStems(nameUk).filter((s) => !GENERIC.has(s)).sort().join("+") || nameUk.toLowerCase()}`;
        const first = newKeys.get(key) ?? newKeys.set(key, { nameUk, nameRu }).get(key)!;
        best = { kind: "new", groupId, key, nameUk: first.nameUk, nameRu: first.nameRu, score: Math.round(score * 100) / 100 };
      }
    }
    if (best) out.set(id, best);
  }
  return out;
}

/**
 * Применить выбор владельца: категория → код подгруппы или «new:<ключ>» (новая подгруппа из подсказки).
 * Новые подгруппы с одним ключом создаются один раз. Возвращает меню и сколько категорий разложено и подгрупп создано.
 */
export function applyMenuPlacement(
  cfg: MenuConfig, choices: Array<{ catId: string; target: string }>, suggestions: ReadonlyMap<string, MenuSuggestion>,
): { cfg: MenuConfig; placed: number; created: number } {
  let next = cfg;
  const createdByKey = new Map<string, string>();
  let placed = 0;
  for (const { catId, target } of choices) {
    let subId = target;
    if (target.startsWith("new:")) {
      const key = target.slice(4);
      const sug = [...suggestions.values()].find((s): s is Extract<MenuSuggestion, { kind: "new" }> => s.kind === "new" && s.key === key);
      if (!sug || !next.groups.some((g) => g.id === sug.groupId)) continue;
      subId = createdByKey.get(key) ?? "";
      if (!subId) {
        const before = new Set(next.groups.flatMap((g) => g.subs.map((s) => s.id)));
        next = addSub(next, sug.groupId, sug.nameUk, sug.nameRu);
        subId = next.groups.flatMap((g) => g.subs).find((s) => !before.has(s.id))?.id ?? "";
        if (!subId) continue;
        createdByKey.set(key, subId);
      }
    } else if (!next.groups.some((g) => g.subs.some((s) => s.id === subId))) continue;
    next = moveClaim(next, catId, subId);
    placed++;
  }
  return { cfg: next, placed, created: createdByKey.size };
}
