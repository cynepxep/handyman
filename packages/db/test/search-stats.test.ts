// Статистика поиска на базе handyman_test: запоминаются только нормальные запросы, частые — первыми, «не нашли» отдельно.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, skipMsg } from "./helpers";

let ready = false;
let stats: typeof import("../src/search-stats");

before(async () => {
  const s = await setupTestDb();
  if (!s.ok) return;
  stats = await import("../src/search-stats");
  ready = true;
});

test("запросы покупателей: счёт, фильтр личных данных, «нашли» и «не нашли»", async (t) => {
  if (!ready) return t.skip(skipMsg);
  for (let i = 0; i < 3; i++) await stats.logSearch("Круг 125", 12);
  await stats.logSearch("круг  125", 12);
  await stats.logSearch("болгарка", 5);
  await stats.logSearch("стусло", 0);
  await stats.logSearch("+380933662407", 0); // телефон не запоминаем
  await stats.logSearch("000237651", 1); // артикул не запоминаем
  const found = await stats.topQueries({ found: true });
  assert.deepEqual(found.map((q) => [q.query, q.count]), [["круг 125", 4], ["болгарка", 1]]);
  assert.deepEqual((await stats.topQueries({ found: false })).map((q) => q.query), ["стусло"]);
  assert.equal((await stats.topQueries()).length, 3);
});
