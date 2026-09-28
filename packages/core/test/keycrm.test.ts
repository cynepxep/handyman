// KeyCRM (шаг 3.5): тело «создать заказ» (цены со скидкой, доставка, комментарий менеджеру, тест), ответы и ошибки, вебхук,
// таблица статусов и подсказка, повторы, настройки.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_KEYCRM_SETTINGS, KEYCRM_MAX_ATTEMPTS, findByUuid, guessOurStatus, keycrmErrorText, keycrmOrderBody, keycrmRetryDelayMin, keycrmStatusName,
  keycrmUuid, mapKeycrmStatus, normalizeKeycrmSettings, readKeycrmOrder, readKeycrmOrderList, readKeycrmStatuses, readKeycrmWebhook, type KeycrmOrderInput,
} from "../src/shop";

const base: KeycrmOrderInput = {
  no: "HM-0007", uuid: "HM-0007", isTest: false, name: "Петренко Іван", phone: "+380933662407",
  items: [{ sku: "000123", name: "Круг 125", qty: 3, unitPrice: 33.333 }, { sku: "000777", name: "Болгарка", qty: 1, unitPrice: 1400 }],
  delivery: "NOVA_POSHTA", deliveryType: "warehouse", city: "Київ", address: null, npPoint: "Відділення №12: вул. Хрещатик, 1", pickupName: null,
  payMode: "PREPAY", total: 1500, dueNow: 200, paid: 0, discountPct: 3, comment: "Подзвоніть після 18:00", source: "site", noCallback: false,
};

test("тело заказа: источник, номер, покупатель, товары по цене со скидкой, Нова Пошта, комментарии", () => {
  const b = keycrmOrderBody(base, 5);
  assert.equal(b.source_id, 5);
  assert.equal(b.source_uuid, "HM-0007");
  assert.deepEqual(b.buyer, { full_name: "Петренко Іван", phone: "+380933662407" });
  assert.deepEqual(b.products, [{ sku: "000123", name: "Круг 125", quantity: 3, price: 33.33 }, { sku: "000777", name: "Болгарка", quantity: 1, price: 1400 }]);
  assert.deepEqual(b.shipping, { shipping_service: "Нова Пошта", shipping_address_city: "Київ", shipping_receive_point: "Відділення №12: вул. Хрещатик, 1" });
  assert.equal(b.buyer_comment, "Подзвоніть після 18:00");
  assert.equal("discount_percent" in b, false, "скидка уже в ценах — второй раз не передаём");
  const mc = String(b.manager_comment);
  assert.match(mc, /Заказ HM-0007 с сайта/);
  assert.match(mc, /Оплата: Предоплата, сейчас 200 ₴/);
  assert.match(mc, /Скидка клиента 3% уже учтена/);
  assert.match(mc, /Сумма на сайте: 1 500 ₴/);
  assert.doesNotMatch(mc, /ТЕСТ/);
});

test("тело заказа: курьер НП, курьер по Одессе, самовывоз, «1 клик» без имени и доставки", () => {
  assert.deepEqual(keycrmOrderBody({ ...base, deliveryType: "address", npPoint: "вул. Садова, 5, кв. 2" }, 1).shipping, {
    shipping_service: "Нова Пошта", shipping_address_city: "Київ", shipping_secondary_line: "вул. Садова, 5, кв. 2",
  });
  assert.deepEqual(keycrmOrderBody({ ...base, delivery: "COURIER_ODESA", city: "Одеса", address: "Дерибасівська, 1", npPoint: null }, 1).shipping, {
    shipping_service: "Кур'єр по Одесі", shipping_address_city: "Одеса", shipping_secondary_line: "Дерибасівська, 1",
  });
  assert.deepEqual(keycrmOrderBody({ ...base, delivery: "PICKUP", city: "Одеса", pickupName: "Магазин на Балківській", address: "Балківська, 10", npPoint: null }, 1).shipping, {
    shipping_service: "Самовивіз", shipping_address_city: "Одеса", shipping_receive_point: "Магазин на Балківській, Балківська, 10",
  });
  const one = keycrmOrderBody({ ...base, name: "", delivery: "TO_CONFIRM", city: null, npPoint: null, payMode: "LATER", dueNow: 0, discountPct: 0, comment: null, source: "one_click", noCallback: true }, 1);
  assert.deepEqual(one.buyer, { phone: "+380933662407" });
  assert.equal("shipping" in one, false);
  assert.equal("buyer_comment" in one, false);
  assert.match(String(one.manager_comment), /Купить в 1 клик/);
  assert.match(String(one.manager_comment), /Доставку и оплату уточнить/);
  assert.match(String(one.manager_comment), /Просит не звонить/);
});

test("Нова Пошта с ID службы в KeyCRM: код отделения (warehouse_ref); без ID или курьер НП — только текст", () => {
  const withRef = { ...base, npPointRef: "1ec09d88-e1c2-11e3-8c4a-0050568002cf" };
  assert.deepEqual(keycrmOrderBody(withRef, 5, 3).shipping, {
    shipping_service: "Нова Пошта", shipping_address_city: "Київ", shipping_receive_point: "Відділення №12: вул. Хрещатик, 1",
    delivery_service_id: 3, warehouse_ref: "1ec09d88-e1c2-11e3-8c4a-0050568002cf",
  });
  assert.equal("warehouse_ref" in (keycrmOrderBody(withRef, 5).shipping as object), false);
  assert.equal("warehouse_ref" in (keycrmOrderBody({ ...withRef, deliveryType: "address" }, 5, 3).shipping as object), false);
});

test("тестовый заказ: номер TEST-…, пометка «ТЕСТ — не обрабатывать» первой строкой", () => {
  assert.equal(keycrmUuid("HM-0007", true), "TEST-HM-0007");
  assert.equal(keycrmUuid("HM-0007", false), "HM-0007");
  const b = keycrmOrderBody({ ...base, isTest: true, uuid: keycrmUuid("HM-0007", true) }, 1);
  assert.equal(b.source_uuid, "TEST-HM-0007");
  assert.match(String(b.manager_comment).split("\n")[0], /^🧪 ТЕСТ — не обрабатывать/);
});

test("ответы KeyCRM: заказ, список, поиск своего по номеру, статусы", () => {
  assert.deepEqual(readKeycrmOrder({ id: 321, status_id: 1, source_uuid: "HM-0007", source_id: 5, grand_total: 1500 }), { id: 321, statusId: 1, sourceUuid: "HM-0007", sourceId: 5 });
  assert.equal(readKeycrmOrder({ message: "ok" }), null);
  const list = readKeycrmOrderList({ data: [{ id: 1, source_uuid: "HM-0001", source_id: 5 }, { id: 2, source_uuid: "HM-0007", source_id: 9 }, { id: 3, source_uuid: "HM-0007", source_id: 5 }] });
  assert.equal(findByUuid(list, "HM-0007", 5)?.id, 3, "тот же номер из другого источника (старый магазин) — не наш");
  assert.equal(findByUuid(list, "HM-0099", 5), null);
  assert.deepEqual(readKeycrmStatuses({ data: [{ id: 1, name: "Новий", alias: "new" }, { id: 2, name: "Старий", is_active: false }, { name: "без id" }] }), [{ id: 1, name: "Новий", alias: "new" }]);
});

test("ошибки KeyCRM — понятным текстом", () => {
  assert.match(keycrmErrorText(401, null), /не принял API-ключ/);
  assert.match(keycrmErrorText(429, null), /подождать/);
  assert.match(keycrmErrorText(503, null), /временно недоступен \(код 503\)/);
  assert.equal(
    keycrmErrorText(422, { message: "The given data was invalid.", errors: { source_id: ["Джерело не знайдено"], "products.0.price": ["must be a number"] } }),
    "KeyCRM ответил ошибкой 422: The given data was invalid.; source_id: Джерело не знайдено; products.0.price: must be a number",
  );
  assert.equal(keycrmErrorText(400, "<html>"), "KeyCRM ответил ошибкой 400.");
});

test("вебхук: смена статуса заказа; не заказ — null", () => {
  assert.deepEqual(readKeycrmWebhook({ event: "order.change_order_status", context: { id: 321, status_id: 4, source_uuid: "HM-0007", source_id: 5, buyer: { phone: "+380…" } } }), {
    event: "order.change_order_status", keycrmId: 321, statusId: 4, sourceUuid: "HM-0007", sourceId: 5,
  });
  assert.equal(readKeycrmWebhook({ event: "lead.change_status", context: { id: 1 } }), null);
  assert.equal(readKeycrmWebhook({ event: "order.change_order_status" }), null);
  assert.equal(readKeycrmWebhook("мусор"), null);
});

test("таблица статусов: соответствие, «не менять», название; подсказка по названию", () => {
  const s = normalizeKeycrmSettings({
    enabled: true, statusMap: { "4": "SHIPPED", "5": "", "6": "НЕТ_ТАКОГО", x: "DONE" }, statuses: [{ id: 4, name: "Відправлено" }], statusesAt: "2026-09-29T10:00:00Z",
  });
  assert.deepEqual(s.statusMap, { "4": "SHIPPED", "5": "" });
  assert.equal(mapKeycrmStatus(s, 4), "SHIPPED");
  assert.equal(mapKeycrmStatus(s, 5), null);
  assert.equal(mapKeycrmStatus(s, 99), null);
  assert.equal(keycrmStatusName(s, 4), "Відправлено");
  assert.equal(keycrmStatusName(s, 77), "№ 77");
  assert.deepEqual(normalizeKeycrmSettings(null), DEFAULT_KEYCRM_SETTINGS);
  assert.equal(normalizeKeycrmSettings({ enabled: "yes" }).enabled, false, "включено — только явное true");

  assert.equal(guessOurStatus("Новий", "new"), "NEW");
  assert.equal(guessOurStatus("Не дозвонились"), "NO_ANSWER");
  assert.equal(guessOurStatus("Очікуємо товар від постачальника"), "AWAITING_SUPPLIER");
  assert.equal(guessOurStatus("Оплачено"), "PAID");
  assert.equal(guessOurStatus("Не оплачено"), "");
  assert.equal(guessOurStatus("Комплектується"), "PACKED");
  assert.equal(guessOurStatus("Відправлено"), "SHIPPED");
  assert.equal(guessOurStatus("Виконано"), "DONE");
  assert.equal(guessOurStatus("Скасовано"), "CANCELLED");
  assert.equal(guessOurStatus("Повернення"), "RETURNED");
  assert.equal(guessOurStatus("Узгодження"), "");
});

test("повторы: 1, 2, 5, 10, 30, 60, 120 минут, после последней попытки — только кнопкой", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(keycrmRetryDelayMin), [1, 2, 5, 10, 30]);
  assert.equal(keycrmRetryDelayMin(KEYCRM_MAX_ATTEMPTS - 1), 120);
  assert.equal(keycrmRetryDelayMin(KEYCRM_MAX_ATTEMPTS), null);
});
