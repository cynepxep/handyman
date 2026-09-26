import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TEMPLATES, firstNameOf, renderTemplate, unknownVars, validateTemplateForm } from "../src/shop";

const STATUSES = ["NEW", "NO_ANSWER", "AWAITING_SUPPLIER", "PAID", "PACKED", "SHIPPED", "DONE", "CANCELLED", "RETURNED"];

test("шаблоны по умолчанию: у каждого статуса есть хотя бы один, тексты на двух языках без неизвестных подстановок", () => {
  for (const s of STATUSES) assert.ok(DEFAULT_TEMPLATES.some((t) => t.status === s), s);
  for (const t of DEFAULT_TEMPLATES) {
    assert.ok(t.textUk && t.textRu && t.titleRu);
    assert.deepEqual(unknownVars(t.textUk + t.textRu), [], t.titleRu);
  }
  assert.equal(DEFAULT_TEMPLATES.filter((t) => t.autoSend).map((t) => t.status).join(), "PAID"); // как в прототипе: автоматически — только «Оплата получена»
});

test("имя для обращения: «Прізвище Ім'я» → имя; одно слово → оно; пусто → «друже»/«друг»", () => {
  assert.equal(firstNameOf("Петренко Іван", "uk"), "Іван");
  assert.equal(firstNameOf("  Ваня ", "uk"), "Ваня");
  assert.equal(firstNameOf("", "uk"), "друже");
  assert.equal(firstNameOf(null, "ru"), "друг");
});

test("подстановки: имя, номер, ТТН (пусто → «—»), суммы с пробелами; остаток не бывает отрицательным", () => {
  const out = renderTemplate("{name}, №{no}: ТТН {ttn}, сума {sum}, при отриманні {due}", { name: "Іван", no: "HM-1024", ttn: null, sum: 12500.5, due: -3 });
  assert.equal(out, "Іван, №HM-1024: ТТН —, сума 12 500,5 ₴, при отриманні 0 ₴");
  assert.equal(renderTemplate("{ttn}", { name: "", no: "", ttn: " 20450000000000 ", sum: 0, due: 0 }), "20450000000000");
});

test("форма шаблона: нужен статус, название и оба текста; опечатка в подстановке — понятная ошибка", () => {
  const ok = validateTemplateForm({ status: "SHIPPED", titleRu: "Отправлен", textUk: "№{no}, ТТН {ttn}", textRu: "№{no}, ТТН {ttn}", autoSend: "on" }, STATUSES);
  assert.deepEqual(ok, { ok: true, value: { status: "SHIPPED", titleRu: "Отправлен", titleUk: "Отправлен", textUk: "№{no}, ТТН {ttn}", textRu: "№{no}, ТТН {ttn}", autoSend: true } });
  const typo = validateTemplateForm({ status: "NEW", titleRu: "x", textUk: "{nmae}", textRu: "a" }, STATUSES);
  assert.ok(!typo.ok && typo.error.includes("{nmae}"));
  assert.equal(validateTemplateForm({ status: "LOST", titleRu: "x", textUk: "a", textRu: "a" }, STATUSES).ok, false);
  assert.equal(validateTemplateForm({ status: "NEW", titleRu: "x", textUk: "a", textRu: "" }, STATUSES).ok, false);
});
