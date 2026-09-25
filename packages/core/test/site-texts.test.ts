import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEXT_ENTRIES, TEXT_BY_KEY, TEXT_GROUPS, defaultTexts, resolveTexts, normalizeTextEdit, fillText, missingVars, pluralIndex, countWord, groupedEntries,
  type TextOverrideRow,
} from "../src/site";

test("реестр: ключи уникальны, у каждого есть укр. и рус. текст и известная группа", () => {
  const keys = TEXT_ENTRIES.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, "ключи не должны повторяться");
  assert.ok(TEXT_ENTRIES.every((e) => e.uk.trim() && e.ru.trim()), "пустых стандартных текстов быть не должно");
  assert.ok(TEXT_ENTRIES.every((e) => (TEXT_GROUPS as readonly string[]).includes(e.group)), "группа должна быть из списка");
  assert.ok(TEXT_ENTRIES.length >= 190, "перенесено 152 старых текста и добавлены новые");
  assert.ok(!TEXT_ENTRIES.some((e) => e.uk.includes("[object")), "вложенные тексты не должны сломаться");
});

test("реестр: все переменные {n} одинаковы в укр. и рус. тексте (иначе сайт покажет «{n}» буквально)", () => {
  for (const e of TEXT_ENTRIES) {
    const v = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(v(e.uk), v(e.ru), `переменные ключа ${e.key}`);
  }
});

test("старые тексты перенесены в свои группы, статусы заказов развёрнуты", () => {
  assert.equal(TEXT_BY_KEY.get("odNote")?.group, "Доставка");
  assert.equal(TEXT_BY_KEY.get("card")?.group, "Оплата");
  assert.equal(TEXT_BY_KEY.get("st.paid")?.group, "Профиль и уровни");
  assert.equal(TEXT_BY_KEY.get("st.paid")?.uk, "Оплачено");
  assert.equal(TEXT_BY_KEY.get("lvls")?.uk, "Старт,Майстер,Профі,Легенда");
  assert.ok(groupedEntries().length >= 10);
  assert.equal(groupedEntries()[0].group, "Главная страница", "витрина идёт первой");
});

test("правка владельца побеждает стандартный текст, только на своём языке", () => {
  const ov: TextOverrideRow[] = [{ key: "home.title", lang: "UK", value: "Наш магазин" }];
  assert.equal(resolveTexts(ov, "uk")["home.title"], "Наш магазин");
  assert.equal(resolveTexts(ov, "ru")["home.title"], defaultTexts("ru")["home.title"]);
});

test("пустая правка и правка несуществующего ключа игнорируются", () => {
  const ov: TextOverrideRow[] = [{ key: "home.title", lang: "UK", value: "   " }, { key: "нет.такого", lang: "UK", value: "x" }];
  const r = resolveTexts(ov, "uk");
  assert.equal(r["home.title"], defaultTexts("uk")["home.title"]);
  assert.ok(!("нет.такого" in r));
});

test("сохранение поля: пустое и равное стандартному = убрать правку; лишнее вырезается", () => {
  const std = TEXT_BY_KEY.get("home.title")!.uk;
  assert.equal(normalizeTextEdit("home.title", "uk", ""), null);
  assert.equal(normalizeTextEdit("home.title", "uk", `  ${std}  `), null);
  assert.equal(normalizeTextEdit("home.title", "uk", "  Новий заголовок \r\n"), "Новий заголовок");
  assert.equal(normalizeTextEdit("home.title", "uk", "a\u0000b"), "ab");
  assert.equal(normalizeTextEdit("home.title", "uk", "я".repeat(900))?.length, 600);
  assert.equal(normalizeTextEdit("нет.такого", "uk", "x"), null);
});

test("переменные: подстановка и защита от потери {n} при правке", () => {
  assert.equal(fillText("Показано {n} з {total}", { n: 12, total: 617 }), "Показано 12 з 617");
  assert.equal(fillText("Ще {x}", {}), "Ще {x}", "неизвестная переменная не пропадает");
  const entry = TEXT_BY_KEY.get("category.shown")!;
  assert.deepEqual(missingVars(entry, "Показано {n}"), ["total"]);
  assert.deepEqual(missingVars(entry, "Всего {total}, показано {n}"), []);
});

test("склонение: 1 товар, 2 товари, 5 товарів, 11 товарів, 21 товар, 132 товари", () => {
  const t = defaultTexts("uk");
  assert.equal(countWord(t, "goods", 1), "1 товар");
  assert.equal(countWord(t, "goods", 2), "2 товари");
  assert.equal(countWord(t, "goods", 5), "5 товарів");
  assert.equal(countWord(t, "goods", 11), "11 товарів");
  assert.equal(countWord(t, "goods", 14), "14 товарів");
  assert.equal(countWord(t, "goods", 21), "21 товар");
  assert.equal(countWord(t, "goods", 132), "132 товари");
  assert.equal(countWord(defaultTexts("ru"), "goods", 3), "3 товара");
  assert.equal(pluralIndex(0), "many");
});
