import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFeed, slugify, subCategoryId, suggestDecision, decideCategory, placeInTree, placementLeafId,
  NO_CATEGORY_PATH, PATH_SEP, UNSORTED_ID, type StoredMapping,
} from "../src/catalog";

const here = path.dirname(fileURLToPath(import.meta.url));
const feed = parseFeed(fs.readFileSync(path.join(here, "fixtures", "vitals-sample.xml")));
const none: StoredMapping = new Map();
const p = (s: string) => s.split(PATH_SEP);

test("слаг: украинская транслитерация", () => {
  assert.equal(slugify("Кутові шліфувальні машини"), "kutovi-shlifuvalni-mashyny");
  assert.equal(slugify("Серія М-Type 18"), "seriya-m-type-18");
  assert.equal(slugify("Їжак, щітка / ґудзик"), "yizhak-shchitka-gudzyk");
  assert.equal(slugify("***"), "");
});

test("код подкатегории детерминирован и не длиннее 80 символов", () => {
  assert.equal(subCategoryId("hand", "Слюсарно-столярний інструмент"), "hand-slyusarno-stolyarnyy-instrument");
  const long = subCategoryId("hand", "Дуже ".repeat(40));
  assert.ok(long.length <= 80);
  assert.equal(long, subCategoryId("hand", "Дуже ".repeat(40)));
});

test("автоподсказка на реальных ветках Vitals", () => {
  const cases: [string, string, number][] = [
    ["Електроінструмент / Кутові шліфувальні машини", "el", 1],
    ["Садово-паркова техніка / Газонокосарки", "gr", 1],
    ["Акумуляторна техніка / Серія SmartLine+ / Електроінструмент", "ak", 1],
    ["Садово-паркова техніка / Акумуляторна техніка / Серія М-Type 18 / Садово-паркова техніка / Акумуляторні пили", "ak", 2],
    ["Електроінструмент / Викрутки акумуляторні", "ak", 2],
    ["Силова техніка / Генератори", "pw", 1],
    ["Силова техніка / Портативні акумуляторні станції", "pw", 1],
    ["Садово-паркова техніка / Мотори човнові", "pw", 2],
    ["Ручний інструмент та витратні матеріали / Слюсарно-столярний інструмент / Ножівки", "hand", 1],
    ["Ручний інструмент та витратні матеріали / Витратні матеріали / Круги відрізні", "acc", 2],
    ["Садово-паркова техніка / Аксесуари для мийок високого тиску", "acc", 2],
    ["Будівельне обладнання / Віброплити", "bld", 1],
  ];
  for (const [pathStr, id, depth] of cases) {
    const d = suggestDecision(p(pathStr));
    assert.deepEqual([d.kind, (d as { categoryId?: string }).categoryId, (d as { depth?: number }).depth], ["category", id, depth], pathStr);
  }
});

test("архив и строительная химия пропускаются, незнакомые корни — новая категория", () => {
  assert.equal(suggestDecision(p("Архів продукції / Електроінструмент")).kind, "skip");
  assert.equal(suggestDecision(p("Будівельна хімія / Піна монтажна")).kind, "skip");
  const w = suggestDecision(p("Зварювальне обладнання / Маски зварника"));
  assert.deepEqual(w, { kind: "new", categoryId: "zvaryuvalne-obladnannya", name: "Зварювальне обладнання", depth: 1 });
});

test("решение владельца важнее подсказки; берётся самое длинное совпадение", () => {
  const stored: StoredMapping = new Map([
    ["Електроінструмент", { categoryId: "hand", skip: false }],
    ["Електроінструмент / Дрилі", { categoryId: null, skip: true }],
  ]);
  const drill = decideCategory(p("Електроінструмент / Дрилі"), stored);
  assert.equal(drill.kind, "skip");
  const saw = decideCategory(p("Електроінструмент / Пили торцювальні"), stored);
  assert.deepEqual(saw, { kind: "category", categoryId: "hand", depth: 1 });
  // без решений работает подсказка
  assert.equal((decideCategory(p("Електроінструмент / Дрилі"), none) as { categoryId: string }).categoryId, "el");
});

test("товары без категории: по умолчанию в «Нераспределённые», можно назначить или не загружать", () => {
  assert.deepEqual(decideCategory(null, none), { kind: "category", categoryId: UNSORTED_ID, depth: 0 });
  assert.equal(UNSORTED_ID, "unsorted");
  const assigned: StoredMapping = new Map([[NO_CATEGORY_PATH, { categoryId: "acc", skip: false }]]);
  assert.deepEqual(decideCategory(null, assigned), { kind: "category", categoryId: "acc", depth: 0 });
  const skipped: StoredMapping = new Map([[NO_CATEGORY_PATH, { categoryId: null, skip: true }]]);
  assert.equal(decideCategory(null, skipped).kind, "skip");
  const place = placeInTree(null, decideCategory(null, none))!;
  assert.deepEqual([place.topId, place.subs.length], [UNSORTED_ID, 0]);
});

test("подкатегории: не глубже двух уровней, коды цепочкой", () => {
  const pathArr = p("Садово-паркова техніка / Акумуляторна техніка / Серія М-Type 18 / Садово-паркова техніка / Акумуляторні пили");
  const place = placeInTree(pathArr, decideCategory(pathArr, none))!;
  assert.equal(place.topId, "ak");
  assert.deepEqual(place.subs.map((s) => s.name), ["Серія М-Type 18", "Садово-паркова техніка"]);
  assert.equal(place.subs[0].id, "ak-seriya-m-type-18");
  assert.equal(placementLeafId(place), "ak-seriya-m-type-18-sadovo-parkova-tekhnika");
  const root = ["Електроінструмент"];
  assert.equal(placementLeafId(placeInTree(root, decideCategory(root, none))!), "el");
});

test("на всех 345 категориях образца подсказка не падает; коды подкатегорий уникальны по пути", () => {
  const kinds: Record<string, number> = { skip: 0, category: 0, new: 0 };
  const idToPath = new Map<string, string>();
  for (const c of feed.categories) {
    const d = decideCategory(c.path, none);
    kinds[d.kind]++;
    const place = placeInTree(c.path, d);
    if (!place) continue;
    for (const s of place.subs) {
      const key = `${place.topId}|${s.id}`;
      const chain = place.subs.slice(0, place.subs.indexOf(s) + 1).map((x) => x.name).join(PATH_SEP);
      const prev = idToPath.get(key);
      assert.ok(!prev || prev === chain, `конфликт кода ${s.id}: «${prev}» и «${chain}»`);
      idToPath.set(key, chain);
    }
  }
  assert.ok(kinds.skip > 50, "архив даёт много пропусков");
  assert.ok(kinds.category > 100);
  assert.ok(kinds.new > 5);
});
