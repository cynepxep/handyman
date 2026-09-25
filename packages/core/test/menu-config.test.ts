import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU_GROUPS, TASKS, defaultMenuConfig, parseMenuConfig, claimOf, moveClaim, addGroup, addSub, removeSub, removeGroup, addTask, removeTask,
  lostCategories, assignCategories, freeId, ensureSlugs, isValidSlug, slugFromName, findGroupBySlug, findSubBySlug, findTaskBySlug,
  subCategoryMap, menuPlaceOf, changeSlug, findGroup, findSub, findTask, type CatNode, type MenuConfig,
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

test("адреса страниц меню: из названия, уникальные, свои сохраняются, кривые заменяются", () => {
  const d = defaultMenuConfig();
  assert.ok(d.groups.every((g) => g.slug && isValidSlug(g.slug)) && d.tasks.every((t) => t.slug && isValidSlug(t.slug)));
  assert.equal(findGroupBySlug(d, "dysky-ta-kruhy")?.id, "discs");
  assert.equal(findTaskBySlug(d, "rizaty-metal")?.id, "cut");
  const discs = findGroupBySlug(d, "dysky-ta-kruhy")!;
  assert.equal(findSubBySlug(discs, "vidrizni-po-metalu")?.id, "discs-cut");
  assert.equal(new Set(d.groups.map((g) => g.slug)).size, d.groups.length);
  for (const g of d.groups) assert.equal(new Set(g.subs.map((s) => s.slug)).size, g.subs.length, `подгруппы ${g.id}`);

  const grp = (id: string, nameUk: string, extra: Record<string, unknown> = {}) => ({ id, nameUk, nameRu: nameUk, hintUk: "", hintRu: "", quickPick: [], subs: [], ...extra });
  const twins = ensureSlugs({ groups: [grp("g1", "Диски"), grp("g2", "Диски"), grp("g3", "Інше", { slug: "Плохой адрес" })], tasks: [] });
  assert.deepEqual(twins.groups.map((g) => g.slug), ["dysky", "dysky-2", "inshe"], "одинаковые названия и неверный адрес → уникальные адреса из названия");
  assert.equal(slugFromName("№ 1"), "razdil", "слишком короткий адрес заменяется");
  const own = parseMenuConfig({ groups: [grp("g1", "Група", { slug: "moia-hrupa" })], tasks: [] })!;
  assert.equal(own.groups[0].slug, "moia-hrupa", "адрес владельца сохраняется");
  assert.ok(isValidSlug("dysky-125") && !isValidSlug("a") && !isValidSlug("Dysky") && !isValidSlug("dy--sky") && !isValidSlug("-dy"));
  assert.equal(slugFromName("Диски та круги"), "dysky-ta-kruhy");
});

test("смена адреса: прежний запоминается и находится (для перенаправления), сохраняется в настройках", () => {
  const d = defaultMenuConfig();
  const discs = findGroupBySlug(d, "dysky-ta-kruhy")!;
  const sub = findSubBySlug(discs, "vidrizni-po-metalu")!;
  changeSlug(sub, "kruhy-po-metalu");
  assert.deepEqual(findSub(discs, "kruhy-po-metalu"), { item: sub, moved: false });
  assert.deepEqual(findSub(discs, "vidrizni-po-metalu"), { item: sub, moved: true }, "старый адрес ведёт на новый");
  changeSlug(sub, "vidrizni-po-metalu");
  assert.equal(sub.slug, "vidrizni-po-metalu", "вернули старый адрес — он снова текущий");
  assert.deepEqual(sub.oldSlugs, ["kruhy-po-metalu"]);
  for (let i = 0; i < 15; i++) changeSlug(sub, `adresa-${i}`);
  assert.equal(sub.oldSlugs?.length, 10, "не больше 10 прежних адресов");
  const back = parseMenuConfig(JSON.parse(JSON.stringify(d)))!;
  assert.deepEqual(findSub(findGroupBySlug(back, "dysky-ta-kruhy")!, "adresa-5")?.moved, true, "прежний адрес сохраняется в настройках");
  assert.equal(findSub(findGroupBySlug(back, "dysky-ta-kruhy")!, "adresa-3"), undefined, "самые старые (больше 10) забываются");
  changeSlug(discs, "dysky");
  assert.equal(findGroup(d, "dysky-ta-kruhy")?.moved, true);
  assert.equal(findTask(d, "rizaty-metal")?.moved, false);
});

test("категории подгрупп для поиска совпадают с подсчётом меню; место товара в меню", () => {
  const nodes: CatNode[] = [{ id: "acc", parentId: null }, { id: "acc-a", parentId: "acc" }, { id: "acc-a-x", parentId: "acc-a" }, { id: "acc-b", parentId: "acc" }];
  const sb = (id: string, categoryIds: string[], ownIds?: string[]) => ({ id, nameUk: id, nameRu: id, categoryIds, ownIds });
  const groups = [{ id: "g", nameUk: "Г", nameRu: "Г", hintUk: "", hintRu: "", quickPick: [], subs: [sb("s1", ["acc-a"]), sb("s2", ["acc-b"], ["acc"])] }];
  const map = subCategoryMap(nodes, groups);
  assert.deepEqual(map.get("s1")?.sort(), ["acc-a", "acc-a-x"]);
  assert.deepEqual(map.get("s2")?.sort(), ["acc", "acc-b"]);
  assert.equal(menuPlaceOf(nodes, groups, "acc-a-x")?.sub.id, "s1");
  assert.equal(menuPlaceOf(nodes, groups, "нет"), null);
});

test("стандартное меню не теряет товары: привязка не даёт конфликтов", () => {
  const nodes: CatNode[] = [...new Set(MENU_GROUPS.flatMap((g) => g.subs.flatMap((s) => [...s.categoryIds, ...(s.ownIds ?? [])])))].map((id) => ({ id, parentId: null }));
  const { conflicts, subOf } = assignCategories(nodes);
  assert.deepEqual(conflicts, []);
  assert.equal(subOf.size, nodes.length);
});
