import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU_GROUPS, TASKS, assignCategories, menuRanks, taskCategoryIds, pickQuickPick, pickSpecs, formatSpec, extractFacets, type MenuGroup, type CatNode,
} from "../src/catalog";

const group = (subs: MenuGroup["subs"]): MenuGroup => ({ id: "g", nameUk: "Г", nameRu: "Г", hintUk: "", hintRu: "", quickPick: [], subs });
const sub = (id: string, categoryIds: string[], ownIds?: string[]) => ({ id, nameUk: id, nameRu: id, categoryIds, ownIds });

test("меню: коды групп, подгрупп и задач не повторяются, у групп есть подгруппы", () => {
  const groupIds = MENU_GROUPS.map((g) => g.id);
  assert.equal(new Set(groupIds).size, groupIds.length);
  const subIds = MENU_GROUPS.flatMap((g) => g.subs.map((s) => s.id));
  assert.equal(new Set(subIds).size, subIds.length);
  assert.ok(MENU_GROUPS.every((g) => g.subs.length > 0 && g.nameUk && g.nameRu));
  const taskIds = TASKS.map((t) => t.id);
  assert.equal(new Set(taskIds).size, taskIds.length);
  assert.ok(MENU_GROUPS.every((g) => g.subs.every((s) => s.categoryIds.length + (s.ownIds?.length ?? 0) > 0)));
});

test("привязка категорий: поддерево, «только сама», вложенное правило сильнее внешнего", () => {
  const nodes: CatNode[] = [
    { id: "acc", parentId: null },
    { id: "acc-a", parentId: "acc" },
    { id: "acc-a-x", parentId: "acc-a" },
    { id: "acc-b", parentId: "acc" },
    { id: "el", parentId: null },
    { id: "el-1", parentId: "el" },
  ];
  const groups = [group([sub("s1", ["acc-a"]), sub("s2", ["acc-b"], ["acc"]), sub("s3", ["el"]), sub("s4", ["el-1"])])];
  const { subOf, conflicts, missing } = assignCategories(nodes, groups);
  assert.equal(subOf.get("acc-a"), "s1");
  assert.equal(subOf.get("acc-a-x"), "s1", "вложенная категория идёт за родителем");
  assert.equal(subOf.get("acc"), "s2", "товары прямо в корне — по «только сама»");
  assert.equal(subOf.get("acc-b"), "s2");
  assert.equal(subOf.get("el"), "s3");
  assert.equal(subOf.get("el-1"), "s4", "ближайшее правило побеждает");
  assert.deepEqual(conflicts, []);
  assert.deepEqual(missing, []);
});

test("привязка категорий: конфликт и несуществующая категория замечаются", () => {
  const nodes: CatNode[] = [{ id: "a", parentId: null }, { id: "b", parentId: "a" }];
  const groups = [group([sub("s1", ["a"]), sub("s2", ["a", "zzz"])])];
  const { conflicts, missing } = assignCategories(nodes, groups);
  assert.ok(conflicts.some((c) => c.startsWith("a:")));
  assert.deepEqual(missing, ["zzz"]);
});

test("задача собирает категорию со всеми вложенными и «только сами»", () => {
  const nodes: CatNode[] = [{ id: "gr", parentId: null }, { id: "gr-1", parentId: "gr" }, { id: "acc", parentId: null }, { id: "acc-1", parentId: "acc" }];
  const ids = taskCategoryIds(nodes, { id: "t", nameUk: "", nameRu: "", hintUk: "", hintRu: "", icon: "", categoryIds: ["gr"], ownIds: ["acc"] });
  assert.deepEqual(ids.sort(), ["acc", "gr", "gr-1"]);
});

test("быстрый выбор размера: первый подходящий кандидат с ≥ 2 значениями", () => {
  const attrs = [
    { key: "drillDiameter", label: "Діаметр свердла", values: [{ value: "6", count: 5 }] },
    { key: "diameter", label: "Діаметр, мм", values: [{ value: "125", count: 5 }, { value: "180", count: 3 }] },
  ];
  assert.equal(pickQuickPick(["drillDiameter", "diameter"], attrs)?.key, "diameter");
  assert.equal(pickQuickPick(["power"], attrs), null);
  assert.equal(pickQuickPick([], attrs), null);
});

test("подпись характеристики: единица измерения переезжает за значение", () => {
  assert.equal(formatSpec("Діаметр, мм", "125"), "Діаметр 125 мм");
  assert.equal(formatSpec("Напруга, В", "18"), "Напруга 18 В");
  assert.equal(formatSpec("Матеріал", "Сталь"), "Матеріал: Сталь");
});

test("ключевые характеристики: не больше 3, по приоритету, без пустых", () => {
  const facets = extractFacets([
    { name: "Діаметр, мм", value: "125" },
    { name: "Посадковий отвір, мм", value: "22,2" },
    { name: "Матеріал", value: "сталь" },
    { name: "Кількість в упаковці", value: "10" },
    { name: "Тип", value: "відрізний" },
  ]);
  const specs = pickSpecs(facets);
  assert.equal(specs.length, 3);
  assert.deepEqual(specs.map((s) => s.key), ["diameter", "landing", "material"]);
  assert.equal(specs[0].text, "Діаметр 125 мм");
  assert.ok(!specs.some((s) => s.key === "type"), "«Тип» в карточку не берём");
  assert.deepEqual(pickSpecs({}), []);
  // порядок группы сильнее общего
  assert.equal(pickSpecs(facets, ["material"], 1)[0].key, "material");
});

test("место в меню: порядок категорий подгруппы (викрутки раньше біт), вложенные — как родитель, чужие — в конце", () => {
  const nodes: CatNode[] = [
    { id: "bits", parentId: null }, { id: "screwdrivers", parentId: null }, { id: "hex", parentId: null },
    { id: "bits-ph", parentId: "bits" }, { id: "other", parentId: null }, { id: "saw", parentId: null },
  ];
  const groups = [
    group([sub("hand", ["screwdrivers", "bits", "hex"])]),
    { ...group([sub("saws", ["saw"])]), id: "g2" },
  ];
  const r = menuRanks(nodes, groups);
  assert.ok(r.get("screwdrivers")! < r.get("bits")!);
  assert.ok(r.get("bits")! < r.get("hex")!);
  assert.equal(r.get("bits-ph"), r.get("bits"));
  assert.ok(r.get("hex")! < r.get("saw")!, "вторая группа после первой");
  assert.equal(r.get("other"), 999_999_999);
  // стандартное меню: в «Викрутки, біти, шестигранники» викрутки идут первыми
  const hs = MENU_GROUPS.flatMap((g) => g.subs).find((s) => s.id === "hand-screw");
  assert.ok(hs && hs.categoryIds[0].endsWith("vykrutky-ta-nabory-vykrutok"));
});
