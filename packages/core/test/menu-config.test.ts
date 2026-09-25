import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU_GROUPS, TASKS, defaultMenuConfig, parseMenuConfig, claimOf, moveClaim, addGroup, addSub, removeSub, removeGroup, addTask, removeTask,
  lostCategories, assignCategories, freeId, type CatNode, type MenuConfig,
} from "../src/catalog";

const tree: CatNode[] = [
  { id: "acc", parentId: null }, { id: "acc-a", parentId: "acc" }, { id: "acc-a-x", parentId: "acc-a" }, { id: "acc-b", parentId: "acc" },
];
const cfg = (): MenuConfig => ({
  groups: [{ id: "g1", nameUk: "Г1", nameRu: "Г1", hintUk: "", hintRu: "", quickPick: [], subs: [
    { id: "s1", nameUk: "С1", nameRu: "С1", categoryIds: ["acc-a"] },
    { id: "s2", nameUk: "С2", nameRu: "С2", categoryIds: [], ownIds: ["acc"] },
  ] }],
  tasks: [],
});
const direct = new Map([["acc", 5], ["acc-a-x", 3], ["acc-b", 2]]);

test("стандартное меню: копия независима, читается обратно без потерь", () => {
  const d = defaultMenuConfig();
  assert.equal(d.groups.length, MENU_GROUPS.length);
  assert.equal(d.tasks.length, TASKS.length);
  d.groups[0].nameUk = "Изменено";
  assert.notEqual(MENU_GROUPS[0].nameUk, "Изменено");
  const back = parseMenuConfig(JSON.parse(JSON.stringify(defaultMenuConfig())));
  assert.deepEqual(back, defaultMenuConfig());
});

test("сломанные настройки меню не принимаются (сайт возьмёт стандартное)", () => {
  assert.equal(parseMenuConfig(null), null);
  assert.equal(parseMenuConfig({ groups: "x", tasks: [] }), null);
  assert.equal(parseMenuConfig({ groups: [{ id: "g" }], tasks: [] }), null);
  assert.equal(parseMenuConfig({ groups: [], tasks: [{ id: "t", nameUk: "a", nameRu: "b", categoryIds: [1] }] }), null);
  assert.deepEqual(parseMenuConfig({ groups: [], tasks: [] }), { groups: [], tasks: [] });
});

test("перенос категории между подгруппами сохраняет вид привязки", () => {
  const moved = moveClaim(cfg(), "acc-a", "s2");
  assert.equal(claimOf(moved, "acc-a")?.subId, "s2");
  assert.equal(claimOf(moved, "acc-a")?.own, false, "«с вложенными» остаётся «с вложенными»");
  const own = moveClaim(cfg(), "acc", "s1");
  assert.deepEqual(claimOf(own, "acc"), { subId: "s1", own: true });
  assert.equal(claimOf(cfg(), "acc-a")?.subId, "s1", "исходные настройки не меняются");
});

test("убранная из меню категория считается потерянной, вернули — нет", () => {
  // «acc» заявлена «только сама», поэтому acc-b от неё не наследуется и теряется
  const lost = lostCategories(tree, direct, cfg()).map((l) => l.id);
  assert.deepEqual(lost, ["acc-b"]);
  const fixed = moveClaim(cfg(), "acc-b", "s1");
  assert.deepEqual(lostCategories(tree, direct, fixed), []);
  const removed = moveClaim(cfg(), "acc-a", null);
  assert.ok(lostCategories(tree, direct, removed).some((l) => l.id === "acc-a-x"), "вложенная категория тоже теряется");
});

test("добавление и удаление групп, подгрупп, задач", () => {
  let c = addGroup(cfg(), "Новая", "Новая");
  const gid = c.groups[1].id;
  assert.match(gid, /^custom-group-\d+$/);
  c = addSub(c, gid, "Под", "Под");
  const sid = c.groups[1].subs[0].id;
  assert.notEqual(sid, gid);
  assert.ok(removeGroup(c, gid).error, "в группе есть подгруппа — удалить нельзя");
  assert.ok(!removeSub(c, sid).error, "пустую подгруппу удалить можно");
  assert.ok(removeSub(c, "s1").error, "подгруппу с категориями удалить нельзя (товары потеряются)");
  assert.ok(!removeGroup(removeSub(c, sid).cfg, gid).error);
  const t = addTask(cfg(), "Задача", "Задача");
  assert.equal(t.tasks.length, 1);
  assert.equal(removeTask(t, t.tasks[0].id).tasks.length, 0);
  assert.equal(freeId("x", ["x-1", "x-2"]), "x-3");
});

test("стандартное меню не теряет товары: привязка не даёт конфликтов", () => {
  const nodes: CatNode[] = [...new Set(MENU_GROUPS.flatMap((g) => g.subs.flatMap((s) => [...s.categoryIds, ...(s.ownIds ?? [])])))].map((id) => ({ id, parentId: null }));
  const { conflicts, subOf } = assignCategories(nodes);
  assert.deepEqual(conflicts, []);
  assert.equal(subOf.size, nodes.length);
});
