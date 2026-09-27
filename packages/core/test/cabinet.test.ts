import { test } from "node:test";
import assert from "node:assert/strict";
import { consumablesFor, isToolCategory, mergeCartSync, toolKind } from "../src/shop";

const A = { sku: "A", qty: 1 };
const B = { sku: "B", qty: 2 };

test("общая корзина: не менял — берём серверную; менял, сервер не менялся — сохраняем свою (и пустую)", () => {
  assert.deepEqual(mergeCartSync({ server: [A], serverVersion: 3, local: [], baseVersion: 2, dirty: false }), { lines: [A], save: false });
  assert.deepEqual(mergeCartSync({ server: [A], serverVersion: 3, local: [A, B], baseVersion: 3, dirty: true }), { lines: [A, B], save: true });
  assert.deepEqual(mergeCartSync({ server: [A], serverVersion: 3, local: [], baseVersion: 3, dirty: true }), { lines: [], save: true });
  assert.deepEqual(mergeCartSync({ server: [A], serverVersion: 3, local: [A], baseVersion: 3, dirty: true }), { lines: [A], save: false });
});

test("общая корзина: менялись оба или первый вход — объединяем, количество большее, мусор отбрасывается", () => {
  const r = mergeCartSync({ server: [A, { sku: "B", qty: 1 }], serverVersion: 5, local: [B, { sku: "C", qty: 1 }, { sku: "", qty: 3 }], baseVersion: 4, dirty: true });
  assert.deepEqual(r, { lines: [A, B, { sku: "C", qty: 1 }], save: true });
  // первый вход: сервер пуст, в браузере гостевая корзина
  assert.deepEqual(mergeCartSync({ server: [], serverVersion: 0, local: [B], baseVersion: 0, dirty: true }), { lines: [B], save: true });
});

test("«Мій інструмент»: инструмент — сетевой, аккумуляторный, садовый; не расходник, не аккумулятор, не ручной", () => {
  for (const c of ["el-kutovi-shlifuvalni-mashyny", "el", "gr-benzopyly-lantsyuhovi", "ak-seriya-m-type-18-elektroinstrument", "ak", "pw-heneratory"]) assert.equal(isToolCategory(c), true, c);
  for (const c of ["acc-dysky-vidrizni-po-metalu", "hand-slyusarno-stolyarnyy-instrument-molotky", "ak-seriya-m-type-18-akumulyatory", "ak-seriya-m-type-18-zaryadni-prystroyi", "unsorted", "elka"]) assert.equal(isToolCategory(c), false, c);
});

test("подбор расходников: болгарка → отрезные круги её диаметра, аккумуляторный — батареи своей серии", () => {
  const grinder = { categoryId: "el-kutovi-shlifuvalni-mashyny", name: "Кутова шліфмашина Vitals Ls 1209", facets: { diameter: ["125"] } };
  assert.equal(toolKind(grinder), "grinder");
  assert.deepEqual(consumablesFor(grinder), [{ key: "discs", groupId: "discs", subId: "discs-cut", facets: { diameter: "125" } }]);

  const cordless = { categoryId: "ak-seriya-m-type-18-elektroinstrument", name: "Акумуляторний шуруповерт Vitals AS 1820", facets: { series: ["M-Type 18"] } };
  assert.equal(toolKind(cordless), "screwdriver");
  assert.deepEqual(consumablesFor(cordless).map((l) => [l.key, l.facets?.series ?? null]), [["bits", null], ["drills", null], ["batteries", "M-Type 18"], ["chargers", "M-Type 18"]]);

  assert.equal(toolKind({ categoryId: "el-perforatory", name: "Перфоратор" }), "perforator");
  assert.equal(toolKind({ categoryId: "el-pyly-tsyrkulyarni", name: "Пила" }), "circularSaw");
  assert.deepEqual(consumablesFor({ categoryId: "gr-motokosy", name: "Мотокоса", facets: {} }), []);
});
