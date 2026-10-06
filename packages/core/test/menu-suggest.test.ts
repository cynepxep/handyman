import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMenuPlacement, assignCategories, defaultMenuConfig, lostCategories, subNameFrom, suggestMenuPlacement, textStems, type NamedCat,
} from "../src/catalog";

// Часть дерева Vitals (категории, которые уже в стандартном меню) + разделы нового поставщика (как у Milwaukee: серия › раздел)
const cats: NamedCat[] = [
  { id: "acc", parentId: null, nameUk: "Аксесуари" },
  { id: "acc-sverdla-po-metalu", parentId: "acc", nameUk: "Свердла по металу" },
  { id: "acc-koronky-po-betonu", parentId: "acc", nameUk: "Коронки по бетону" },
  { id: "el", parentId: null, nameUk: "Електроінструмент" },
  { id: "ak", parentId: null, nameUk: "Акумуляторний інструмент" },
  { id: "ak-seriya-m-type-18-akumulyatory", parentId: "ak", nameUk: "Акумулятори" },
  // новый поставщик
  { id: "ak-m18", parentId: "ak", nameUk: "M18" },
  { id: "ak-m18-gaikoverty", parentId: "ak-m18", nameUk: "Гайковерти" },
  { id: "ak-m12", parentId: "ak", nameUk: "M12" },
  { id: "ak-m12-gaikoverty", parentId: "ak-m12", nameUk: "Акумуляторні гайковерти M12" },
  { id: "ak-m18-batteries", parentId: "ak-m18", nameUk: "Акумулятори M18" },
  { id: "ak-m18-drili", parentId: "ak-m18", nameUk: "Дрилі-шуруповерти" },
  { id: "osn", parentId: null, nameUk: "Оснастка" },
  { id: "osn-sverdla-metal", parentId: "osn", nameUk: "Свердла по металу HSS-G" },
  { id: "osn-koronky", parentId: "osn", nameUk: "Коронки біметалеві" },
  { id: "el-bolgarky", parentId: "el", nameUk: "Кутові шліфмашини (болгарки)" },
  { id: "el-drili", parentId: "el", nameUk: "Дрилі мережеві" },
  { id: "zzz", parentId: null, nameUk: "Шоломи захисні" },
];
const lostIds = cats.filter((c) => !["acc", "el", "ak", "osn"].includes(c.id) && !c.id.startsWith("acc-") && c.id !== "ak-seriya-m-type-18-akumulyatory").map((c) => c.id);

test("основы слов: окончания, апострофы, синонимы рус./укр.", () => {
  assert.deepEqual(textStems("Дрилі"), textStems("дриль"));
  assert.deepEqual(textStems("Дрель"), textStems("дриль"));
  assert.deepEqual(textStems("Свердла по металу"), textStems("свердло металу"));
  assert.deepEqual(textStems("Набір інструменту для Milwaukee"), ["інстр"]);
});

test("название новой подгруппы: без серии и «акумуляторні»", () => {
  assert.equal(subNameFrom("Акумуляторні гайковерти M12"), "Гайковерти");
  assert.equal(subNameFrom("M18 FUEL Дрилі-шуруповерти"), "Дрилі-шуруповерти");
  assert.equal(subNameFrom("M18"), "M18");
});

test("подсказка: подходящая подгруппа по словам названия и уже лежащих в ней категорий", () => {
  const cfg = defaultMenuConfig();
  const s = suggestMenuPlacement(cats, cfg, lostIds);
  const sub = (id: string) => { const x = s.get(id); return x?.kind === "sub" ? x.subId : x?.kind; };
  assert.equal(sub("osn-sverdla-metal"), "drills-metal");
  assert.equal(sub("osn-koronky"), "drills-crowns");
  assert.equal(sub("ak-m18-batteries"), "cordless-batteries");
  assert.equal(sub("el-bolgarky"), "corded-grind");
  assert.equal(sub("el-drili"), "corded-drill");
});

test("подсказка: аккумуляторный — только в аккумуляторную группу; нет подгруппы — новая, одинаковые разделы серий — одна", () => {
  const cfg = defaultMenuConfig();
  const s = suggestMenuPlacement(cats, cfg, lostIds);
  const a = s.get("ak-m18-gaikoverty"), b = s.get("ak-m12-gaikoverty"), d = s.get("ak-m18-drili");
  assert.equal(a?.kind, "new");
  assert.equal(b?.kind, "new");
  assert.ok(a?.kind === "new" && b?.kind === "new" && a.key === b.key && a.groupId === "cordless" && a.nameUk === "Гайковерти" && b.nameUk === "Гайковерти");
  // «Дрилі-шуруповерти» под M18 — не в «Перфоратори, дрилі» от сети, а новая подгруппа аккумуляторного
  assert.ok(d?.kind === "new" && d.groupId === "cordless" && d.nameUk === "Дрилі-шуруповерти");
  // ни на что не похоже — без подсказки
  assert.equal(s.has("zzz"), false);
  assert.equal(s.has("ak-m18"), false);
});

test("применение: новые подгруппы создаются один раз, категории попадают в меню", () => {
  const cfg = defaultMenuConfig();
  const s = suggestMenuPlacement(cats, cfg, lostIds);
  const key = (id: string) => { const x = s.get(id)!; return x.kind === "new" ? `new:${x.key}` : x.subId; };
  const choices = ["ak-m18-gaikoverty", "ak-m12-gaikoverty", "osn-sverdla-metal"].map((catId) => ({ catId, target: key(catId) }));
  choices.push({ catId: "zzz", target: "нет-такой" });
  const r = applyMenuPlacement(cfg, choices, s);
  assert.equal(r.placed, 3);
  assert.equal(r.created, 1);
  const cordless = r.cfg.groups.find((g) => g.id === "cordless")!;
  const added = cordless.subs.filter((x) => x.nameUk === "Гайковерти");
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].categoryIds.sort(), ["ak-m12-gaikoverty", "ak-m18-gaikoverty"]);
  assert.ok(added[0].slug, "у новой подгруппы есть адрес страницы");
  const { subOf } = assignCategories(cats, r.cfg.groups);
  assert.equal(subOf.get("osn-sverdla-metal"), "drills-metal");
  const direct = new Map(cats.map((c) => [c.id, 1]));
  const lost = lostCategories(cats, direct, r.cfg).map((l) => l.id);
  assert.ok(!lost.includes("ak-m18-gaikoverty") && !lost.includes("osn-sverdla-metal"));
});
