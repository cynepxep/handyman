import { test } from "node:test";
import assert from "node:assert/strict";
import { kyivDayStart, parseOrderFilters, validateManualOrder, validateSeller } from "../src/shop";

const KNOWN = { statuses: ["NEW", "DONE"], pays: ["PREPAY"], deliveries: ["NOVA_POSHTA"] };

test("фильтры заказов: неизвестное отбрасывается, «требуют действия», даты только ГГГГ-ММ-ДД, тестовые по умолчанию видны", () => {
  assert.deepEqual(parseOrderFilters({ status: "action", source: "manual", pay: "PREPAY", delivery: "XXX", from: "2026-09-01", to: "вчера", test: "hide", page: "3", q: "  093 " }, KNOWN), {
    q: "093", status: "action", source: "manual", pay: "PREPAY", delivery: "", from: "2026-09-01", to: "", test: "hide", page: 3,
  });
  const d = parseOrderFilters({ status: "LOST", source: "evil", page: "-1" }, KNOWN);
  assert.equal(d.status, "");
  assert.equal(d.source, "");
  assert.equal(d.test, "all");
  assert.equal(d.page, 1);
});

test("сутки по Киеву: летом начало дня — 21:00 UTC накануне, зимой — 22:00 UTC; «по» включает весь день", () => {
  assert.equal(kyivDayStart("2026-09-26").toISOString(), "2026-09-25T21:00:00.000Z");
  assert.equal(kyivDayStart("2026-09-26", true).toISOString(), "2026-09-26T21:00:00.000Z");
  assert.equal(kyivDayStart("2026-01-15").toISOString(), "2026-01-14T22:00:00.000Z");
});

test("заказ по звонку: телефон обязателен, одинаковые товары складываются, для НП нужны город и отделение", () => {
  const ok = validateManualOrder({ phone: "093 366 24 07", name: " Іван ", items: JSON.stringify([{ sku: "A", qty: 2 }, { sku: "A", qty: "1" }, { sku: "B", qty: 0 }, { sku: "", qty: 1 }]), delivery: "courier", address: "Дерибасівська, 1", pay: "card", isTest: "on" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.items, [{ sku: "A", qty: 3 }]);
  assert.equal(ok.value.phone, "+380933662407");
  assert.equal(ok.value.isTest, true);
  assert.equal(validateManualOrder({ phone: "", items: '[{"sku":"A","qty":1}]' }).ok, false);
  assert.equal(validateManualOrder({ phone: "0933662407", items: "не json" }).ok, false);
  assert.equal(validateManualOrder({ phone: "0933662407", items: '[{"sku":"A","qty":1}]', delivery: "np", city: "Київ" }).ok, false);
  const later = validateManualOrder({ phone: "0933662407", items: '[{"sku":"A","qty":1}]' });
  assert.ok(later.ok && later.value.delivery === "to_confirm" && later.value.pay === "later");
});

test("реквизиты продавца: IBAN UA+27 цифр (пробелы убираются), код 8 или 10 цифр, пустые — можно", () => {
  const ok = validateSeller({ name: "ФОП Іваненко І. І.", code: "1234567890", iban: "ua21 3223 1300 0002 6007 2335 6600 1" });
  assert.ok(ok.ok && ok.value.iban === "UA213223130000026007233566001");
  assert.equal(validateSeller({ iban: "UA12" }).ok, false);
  assert.equal(validateSeller({ code: "123" }).ok, false);
  assert.ok(validateSeller({}).ok);
});
