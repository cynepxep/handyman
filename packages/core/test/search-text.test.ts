import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixKeyboardLayout, synonymMap, extractFacets, seriesFromCategories, FACET_DEFS, parseFeed, normalizeNumber, sortFacetValues } from "../src/catalog";

const here = path.dirname(fileURLToPath(import.meta.url));

test("раскладка: rheu → круг, ghbdtn → привет, кириллица и цифры не трогаются", () => {
  assert.deepEqual(fixKeyboardLayout("rheu"), ["круг"]);
  assert.deepEqual(fixKeyboardLayout("Rheu 125"), ["Круг 125"]);
  assert.equal(fixKeyboardLayout("ghbdtn")[0], "привет");
  assert.deepEqual(fixKeyboardLayout("круг"), []);
  assert.deepEqual(fixKeyboardLayout("125"), []);
  assert.deepEqual(fixKeyboardLayout(""), []);
});

test("раскладка: украинские буквы i/ї/є получаются из s ] ' (украинский вариант первым)", () => {
  const v = fixKeyboardLayout("gth]");
  assert.equal(v[0], "перї"); // украинская раскладка
  assert.equal(v[1], "перъ"); // русская
});

test("синонимы двусторонние и без повторов", () => {
  const m = synonymMap([["болгарка", "ушм"], ["болгарка", "кутова шліфмашина"]]);
  assert.deepEqual(m["болгарка"].sort(), ["кутова шліфмашина", "ушм"]);
  assert.deepEqual(m["ушм"], ["болгарка"]);
  assert.deepEqual(m["кутова шліфмашина"], ["болгарка"]);
});

test("фильтры: разные названия характеристик сводятся к одному фильтру", () => {
  const f = extractFacets([
    { name: "Діаметр, мм", value: "125" },
    { name: "Номінальна напруга, В", value: "18" },
    { name: "Напруга живлення, В", value: "18" }, // дубль значения не добавляется
    { name: "Потужність, Вт", value: "400" },
    { name: "Габарити упаковки, мм", value: "400х340х110" }, // технические — не фильтр
    { name: "Маса нетто/брутто, кг", value: "2,56/2,64" },
    { name: "Матеріал", value: "  Метал   нержавіюча сталь " },
    { name: "Тип", value: "x".repeat(80) }, // слишком длинное значение
  ]);
  assert.deepEqual(f, { diameter: ["125"], voltage: ["18"], power: ["400"], material: ["Метал нержавіюча сталь"] });
});

test("размеры в фильтрах приводятся к одному виду: «3.0 мм», «3,0» и «3» — одно значение", () => {
  assert.equal(normalizeNumber("13.0 мм"), "13");
  assert.equal(normalizeNumber("4.5 мм"), "4,5");
  assert.equal(normalizeNumber("2,0"), "2");
  assert.equal(normalizeNumber("22,2"), "22,2");
  assert.equal(normalizeNumber("18 В"), "18");
  assert.equal(normalizeNumber("2.5-4.5"), "2.5-4.5", "диапазон не трогаем");
  assert.equal(normalizeNumber("6\" (15)"), "6\" (15)", "текст не трогаем");
  assert.equal(normalizeNumber("1,5 м"), "1,5 м", "метры не превращаем в миллиметры");
  const f = extractFacets([
    { name: "Діаметр свердла", value: "3.0 мм" },
    { name: "Діаметр свердла", value: "3" },
    { name: "Довжина, мм", value: "75; 100; 150" },
    { name: "Матеріал", value: "Сталь 3.0" },
  ]);
  assert.deepEqual(f, { drillDiameter: ["3"], length: ["75", "100", "150"], material: ["Сталь 3.0"] });
  const sorted = sortFacetValues("drillDiameter", [{ value: "10" }, { value: "2,5" }, { value: "3" }]);
  assert.deepEqual(sorted.map((v) => v.value), ["2,5", "3", "10"]);
  assert.deepEqual(sortFacetValues("material", [{ value: "б" }, { value: "а" }]).map((v) => v.value), ["б", "а"], "не размеры — порядок как пришёл");
});

test("серия берётся из названий категорий", () => {
  assert.deepEqual(seriesFromCategories(["Акумуляторна техніка", "Серія М-Type 18", "Електроінструмент"]), ["М-Type 18"]);
  assert.deepEqual(extractFacets([], ["Акумуляторна техніка", "Серія SmartLine+"]), { series: ["SmartLine+"] });
});

test("на образце Vitals есть значимые фильтры и нет технических", () => {
  const feed = parseFeed(fs.readFileSync(path.join(here, "fixtures", "vitals-sample.xml")));
  const keys = new Set<string>();
  for (const it of feed.items) for (const k of Object.keys(extractFacets(it.params, it.categoryPath ?? []))) keys.add(k);
  assert.ok(keys.has("voltage") && keys.has("power") && keys.has("engine"), [...keys].join(","));
  assert.ok(FACET_DEFS.every((d) => /^[a-zA-Z]+$/.test(d.key)), "коды фильтров — латиница без пробелов");
});
