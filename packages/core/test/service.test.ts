import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKyivDateTime, taskBucket, toKyivInput, validateServiceCase, validateTask } from "../src/shop";

test("дата и время напоминания — по Киеву (летом +3, зимой +2) и обратно в поле", () => {
  assert.equal(parseKyivDateTime("2026-09-26T18:00")?.toISOString(), "2026-09-26T15:00:00.000Z");
  assert.equal(parseKyivDateTime("2026-01-10T09:30")?.toISOString(), "2026-01-10T07:30:00.000Z");
  assert.equal(parseKyivDateTime("2026-09-26T25:00"), null);
  assert.equal(parseKyivDateTime(""), null);
  assert.equal(toKyivInput(new Date("2026-09-26T15:00:00Z")), "2026-09-26T18:00");
});

test("задача: просрочена / сегодня / позже / без срока", () => {
  const now = new Date("2026-09-26T12:00:00Z"); // 15:00 по Киеву
  assert.equal(taskBucket(new Date("2026-09-26T11:00:00Z"), now), "overdue");
  assert.equal(taskBucket(new Date("2026-09-26T18:00:00Z"), now), "today"); // 21:00 по Киеву
  assert.equal(taskBucket(new Date("2026-09-26T21:30:00Z"), now), "later"); // уже 27-е по Киеву
  assert.equal(taskBucket(null, now), "none");
});

test("форма задачи и гарантийного обращения: нужны текст/товар/неисправность, неверная дата — ошибка", () => {
  const t = validateTask({ title: "  перезвонить ", dueAt: "2026-09-26T18:00" });
  assert.ok(t.ok && t.value.title === "перезвонить" && t.value.dueAt?.toISOString() === "2026-09-26T15:00:00.000Z");
  assert.equal(validateTask({ title: "" }).ok, false);
  assert.equal(validateTask({ title: "x", dueAt: "завтра" }).ok, false);
  const c = validateServiceCase({ productName: "Шуруповерт", problem: "не крутит", orderNo: "hm-1002" });
  assert.ok(c.ok && c.value.orderNo === "HM-1002");
  assert.equal(validateServiceCase({ productName: "", problem: "x" }).ok, false);
  assert.equal(validateServiceCase({ productName: "x", problem: " " }).ok, false);
});
