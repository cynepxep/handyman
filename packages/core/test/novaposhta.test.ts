// Нова Пошта (шаг 3.4): настройки, статусы посылки и статус заказа, расписание опроса, вес, наложенный платёж, бесплатная доставка,
// форма ТТН, тело запросов, разбор ответов НП, адрес печати, отчёт по отказам.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NP_SETTINGS, autoOrderStatus, blacklistAllowsPay, codDefault, counterpartyProps, defaultTtnForm, isNpFree, isStuck, npDate, npErrorText,
  npFreeLeft, npNextCheck, npPrintUrl, npStateOf, npToday, parcelWeight, parseCheckoutSettings, parseNpSettings, readCounterparty,
  readRefList, readTracking, readTtnSave, recipientNames, refusalStats, senderMissing, shouldBlacklist, ttnProps, validateCheckoutSettingsForm,
  validateNpParcelForm, validateTtnForm, weightKgFromAttr,
} from "../src/shop";

const R = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

test("настройки НП: мусор → по умолчанию, коды только настоящие, чего не хватает для ТТН", () => {
  const s = parseNpSettings({ senderRef: "abc", cityRef: R(1), seats: 3, codKind: "control", autoStatuses: false, dims: { l: 30, w: 20, h: 10 }, senderPhone: "+380933662407" });
  assert.equal(s.senderRef, "");
  assert.equal(s.cityRef, R(1));
  assert.equal(s.seats, 3);
  assert.equal(s.codKind, "control");
  assert.equal(s.autoStatuses, false);
  assert.deepEqual(s.dims, { l: 30, w: 20, h: 10 });
  assert.deepEqual(senderMissing(s), ["отправитель", "контактное лицо и телефон", "город и отделение отправки"]);
  const full = { ...s, senderRef: R(2), contactRef: R(3), warehouseRef: R(4) };
  assert.deepEqual(senderMissing(full), []);
  assert.deepEqual(parseNpSettings(null), DEFAULT_NP_SETTINGS);
});

test("форма настроек посылки: вес, места, размеры все три или ни одного, правила", () => {
  const base = { seats: "1", description: "Інструмент", stuckDays: "3", refusalsToBlacklist: "2", autoStatuses: "on" };
  const ok = validateNpParcelForm(base);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.dims, null);
    assert.equal(ok.value.autoStatuses, true);
    assert.equal(ok.value.arrivedMessage, false);
    assert.equal(ok.value.refusalsToBlacklist, 2);
  }
  assert.equal(validateNpParcelForm({ ...base, seats: "0" }).ok, false);
  assert.equal(validateNpParcelForm({ ...base, dimL: "30" }).ok, false);
  const d = validateNpParcelForm({ ...base, dimL: "30", dimW: "20", dimH: "10" });
  assert.ok(d.ok && d.value.dims?.h === 10);
  assert.equal(validateNpParcelForm({ ...base, description: "" }).ok, false);
});

test("код статуса НП → посылка; посылка → статус заказа (отмену не трогаем)", () => {
  assert.equal(npStateOf(1), "created");
  assert.equal(npStateOf("5"), "transit");
  assert.equal(npStateOf("7"), "arrived");
  assert.equal(npStateOf("8"), "arrived");
  assert.equal(npStateOf("9"), "received");
  assert.equal(npStateOf("11"), "received");
  assert.equal(npStateOf("103"), "refused");
  assert.equal(npStateOf("105"), "refused");
  assert.equal(npStateOf("2"), "deleted");
  assert.equal(npStateOf("3"), "unknown");
  assert.equal(npStateOf("999"), "transit");
  assert.equal(autoOrderStatus("transit", "PAID"), "SHIPPED");
  assert.equal(autoOrderStatus("arrived", "PACKED"), "SHIPPED");
  assert.equal(autoOrderStatus("transit", "SHIPPED"), null);
  assert.equal(autoOrderStatus("received", "SHIPPED"), "DONE");
  assert.equal(autoOrderStatus("received", "PAID"), "DONE");
  assert.equal(autoOrderStatus("received", "CANCELLED"), null);
  assert.equal(autoOrderStatus("refused", "SHIPPED"), null);
  assert.equal(autoOrderStatus("created", "NEW"), null);
});

test("когда снова спрашивать НП", () => {
  const created = new Date("2026-09-29T08:00:00Z");
  const now = new Date("2026-09-29T10:00:00Z");
  assert.equal(npNextCheck("transit", created, now)?.toISOString(), "2026-09-29T11:00:00.000Z");
  assert.equal(npNextCheck("arrived", created, now)?.toISOString(), "2026-09-29T13:00:00.000Z");
  assert.equal(npNextCheck("created", created, now)?.toISOString(), "2026-09-29T12:00:00.000Z");
  assert.equal(npNextCheck("received", created, now), null);
  assert.equal(npNextCheck("refused", created, now), null);
  assert.equal(npNextCheck("unknown", created, new Date("2026-10-03T10:00:00Z")), null);
  assert.equal(npNextCheck("transit", created, new Date("2026-11-01T10:00:00Z")), null);
  assert.equal(isStuck(new Date("2026-09-26T09:00:00Z"), 3, now), true);
  assert.equal(isStuck(new Date("2026-09-27T09:00:00Z"), 3, now), false);
  assert.equal(isStuck(new Date("2026-09-20T09:00:00Z"), 0, now), false);
});

test("вес из характеристик и вес посылки", () => {
  assert.equal(weightKgFromAttr("Вага", "2,5 кг"), 2.5);
  assert.equal(weightKgFromAttr("Вага, кг", "1.8"), 1.8);
  assert.equal(weightKgFromAttr("Вага, г", "850"), 0.85);
  assert.equal(weightKgFromAttr("Вага", "850 г"), 0.85);
  assert.equal(weightKgFromAttr("Маса нетто", "3"), 3);
  assert.equal(weightKgFromAttr("Вага акумулятора", "0,6 кг"), null);
  assert.equal(weightKgFromAttr("Потужність", "900 Вт"), null);
  assert.equal(weightKgFromAttr("Вага", "—"), null);
  assert.deepEqual(parcelWeight([{ name: "Болгарка", kg: 1.8, qty: 1 }, { name: "Круг", kg: 0.2, qty: 5 }]), { kg: 3.1, knownKg: 3.1, missing: [] });
  assert.deepEqual(parcelWeight([{ name: "Круг", kg: 0.2, qty: 1 }, { name: "Бур", kg: null, qty: 1 }]), { kg: null, knownKg: 0.3, missing: ["Бур"] }, "хоть у одного нет веса — вписывает менеджер");
  assert.deepEqual(parcelWeight([{ name: "Бур", kg: null, qty: 3 }]), { kg: null, knownKg: 0, missing: ["Бур"] });
  assert.equal(parcelWeight([{ name: "Шайба", kg: 0.01, qty: 1 }]).kg, 0.1);
  assert.equal(parcelWeight([]).kg, null);
});

test("наложенный платёж по умолчанию, бесплатная доставка, чёрный список", () => {
  assert.equal(codDefault({ payMode: "PREPAY", total: 1500, dueNow: 200, paidAmount: 0 }), 1300);
  assert.equal(codDefault({ payMode: "PREPAY", total: 1500, dueNow: 200, paidAmount: 500 }), 1000);
  assert.equal(codDefault({ payMode: "LATER", total: 900, dueNow: 0, paidAmount: 0 }), 900);
  assert.equal(codDefault({ payMode: "FULL", total: 900, dueNow: 900, paidAmount: 0 }), 0);
  assert.equal(codDefault({ payMode: "CARD", total: 900, dueNow: 900, paidAmount: 0 }), 0);
  assert.equal(isNpFree(2000, 2000), true);
  assert.equal(isNpFree(1999, 2000), false);
  assert.equal(isNpFree(5000, 0), false);
  assert.equal(npFreeLeft(1500.4, 2000), 500);
  assert.equal(npFreeLeft(2500, 2000), 0);
  assert.equal(npFreeLeft(100, 0), 0);
  assert.equal(blacklistAllowsPay("prepay"), false);
  assert.equal(blacklistAllowsPay("full"), true);
  assert.equal(blacklistAllowsPay("card"), true);
  assert.equal(shouldBlacklist(1, 1), true);
  assert.equal(shouldBlacklist(1, 2), false);
  assert.equal(shouldBlacklist(5, 0), false);
});

test("порог бесплатной доставки в настройках оформления", () => {
  assert.equal(parseCheckoutSettings({}).npFreeFrom, 0);
  assert.equal(parseCheckoutSettings({ npFreeFrom: 2000 }).npFreeFrom, 2000);
  assert.equal(parseCheckoutSettings({ npFreeFrom: -1 }).npFreeFrom, 0);
  const f = validateCheckoutSettingsForm({ prepayAmount: "200", fullPayDiscountPct: "0", "pay.prepay": "on", "delivery.np": "on", npFreeFrom: "2 000" });
  assert.ok(f.ok && f.value.npFreeFrom === 2000);
  assert.equal(validateCheckoutSettingsForm({ prepayAmount: "200", "pay.prepay": "on", "delivery.np": "on", npFreeFrom: "abc" }).ok, false);
});

test("форма ТТН: по умолчанию из заказа и проверка", () => {
  assert.equal(defaultTtnForm({ payMode: "FULL", total: 100, dueNow: 100, paidAmount: 0, npFreeShipping: false }, DEFAULT_NP_SETTINGS, null).weight, null, "вес неизвестен — поле пустое");
  assert.match((validateTtnForm({ weight: "", seats: "1", declared: "100", description: "Болгарка" }, 100) as { error: string }).error, /реальный вес/);
  const d = defaultTtnForm({ payMode: "PREPAY", total: 1499.5, dueNow: 200, paidAmount: 0, npFreeShipping: true }, DEFAULT_NP_SETTINGS, 3.1);
  assert.deepEqual(d, { weight: 3.1, seats: 1, dims: null, declared: 1500, payer: "Sender", cod: 1299.5, description: "Електроінструмент" });
  const ok = validateTtnForm({ weight: "3,1", seats: "1", declared: "1500", cod: "1299.5", payer: "Sender", description: "Болгарка" }, 1499.5);
  assert.ok(ok.ok && ok.value.payer === "Sender" && ok.value.cod === 1299.5);
  assert.equal(validateTtnForm({ weight: "3", seats: "1", declared: "1500", cod: "2000", description: "Болгарка" }, 1499.5).ok, false);
  assert.equal(validateTtnForm({ weight: "0", seats: "1", declared: "1500", description: "Болгарка" }, 1000).ok, false);
  assert.equal(validateTtnForm({ weight: "1", seats: "0", declared: "1500", description: "Болгарка" }, 1000).ok, false);
  const r = validateTtnForm({ weight: "1", seats: "1", declared: "10", description: "Болгарка" }, 1000);
  assert.ok(r.ok && r.value.payer === "Recipient" && r.value.cod === 0);
});

test("запросы: получатель, ТТН с наложенным платежом / контролем оплаты и габаритами", () => {
  assert.deepEqual(recipientNames("Петренко Іван Іванович"), { lastName: "Петренко", firstName: "Іван", middleName: "Іванович" });
  assert.deepEqual(recipientNames("Іван"), { lastName: "Іван", firstName: "Іван", middleName: "" });
  assert.deepEqual(counterpartyProps("Петренко Іван", "+380933662407"), {
    CounterpartyProperty: "Recipient", CounterpartyType: "PrivatePerson", FirstName: "Іван", LastName: "Петренко", MiddleName: "", Phone: "380933662407", Email: "",
  });
  const s = { ...DEFAULT_NP_SETTINGS, senderRef: R(1), contactRef: R(2), senderPhone: "+380501112233", cityRef: R(3), warehouseRef: R(4) };
  const recipient = { ref: R(5), contactRef: R(6), phone: "+380933662407", cityRef: R(7), pointRef: R(8) };
  const form = { weight: 3, seats: 2, dims: { l: 40, w: 30, h: 20 }, declared: 1500, payer: "Recipient" as const, cod: 1300, description: "Болгарка" };
  const p = ttnProps({ s, form, date: "29.09.2026", orderNo: "HM-1001", recipient });
  assert.equal(p.PayerType, "Recipient");
  assert.equal(p.PaymentMethod, "Cash");
  assert.equal(p.SendersPhone, "380501112233");
  assert.equal(p.RecipientsPhone, "380933662407");
  assert.equal(p.RecipientAddress, R(8));
  assert.equal(p.ServiceType, "WarehouseWarehouse");
  assert.equal(p.InfoRegClientBarcodes, "HM-1001");
  assert.deepEqual(p.BackwardDeliveryData, [{ PayerType: "Recipient", CargoType: "Money", RedeliveryString: "1300" }]);
  assert.equal(p.AfterpaymentOnGoodsCost, undefined);
  assert.equal((p.OptionsSeat as unknown[]).length, 2);
  assert.deepEqual((p.OptionsSeat as unknown[])[0], { volumetricLength: "40", volumetricWidth: "30", volumetricHeight: "20", weight: "1.5" });
  const c = ttnProps({ s: { ...s, codKind: "control", senderPayMethod: "NonCash" }, form: { ...form, payer: "Sender", dims: null }, date: "29.09.2026", orderNo: "HM-1", recipient });
  assert.equal(c.AfterpaymentOnGoodsCost, "1300");
  assert.equal(c.BackwardDeliveryData, undefined);
  assert.equal(c.PaymentMethod, "NonCash");
  assert.equal(c.OptionsSeat, undefined);
  const none = ttnProps({ s, form: { ...form, cod: 0 }, date: "29.09.2026", orderNo: "HM-1", recipient });
  assert.equal(none.BackwardDeliveryData, undefined);
  assert.match(npToday(new Date("2026-09-28T22:30:00Z")), /^29\.09\.2026$/);
});

test("разбор ответов НП: контрагент, ТТН, статусы, дата, ошибки", () => {
  assert.deepEqual(readCounterparty({ success: true, data: [{ Ref: R(5), ContactPerson: { success: true, data: [{ Ref: R(6) }] } }] }), { ref: R(5), contactRef: R(6) });
  assert.equal(readCounterparty({ success: false, errors: ["x"] }), null);
  const saved = readTtnSave({ success: true, data: [{ Ref: R(9), IntDocNumber: "20450000012345", CostOnSite: 85, EstimatedDeliveryDate: "30.09.2026" }] });
  assert.equal(saved?.ttn, "20450000012345");
  assert.equal(saved?.cost, 85);
  assert.equal(saved?.estDate?.toISOString(), "2026-09-30T09:00:00.000Z");
  assert.equal(readTtnSave({ success: true, data: [{ Ref: "bad" }] }), null);
  const tr = readTracking({ success: true, data: [{ Number: "20450000012345", StatusCode: "7", Status: "Прибув на відділення", ScheduledDeliveryDate: "30-09-2026 13:00:00", DocumentCost: "85" }, { Number: "x" }] });
  assert.equal(tr.length, 1);
  assert.equal(tr[0].code, "7");
  assert.equal(tr[0].scheduled?.toISOString(), "2026-09-30T09:00:00.000Z");
  assert.equal(tr[0].cost, 85);
  assert.equal(npDate("мусор"), null);
  assert.match(npErrorText({ success: false, errors: ["API auth fail"] }), /API-ключ/);
  assert.match(npErrorText({ success: false, errors: ["FirstName is invalid"] }), /кириллицей/);
  assert.match(npErrorText({ success: false, errors: [] }), /без пояснения/);
  assert.deepEqual(readRefList({ success: true, data: [{ Ref: R(1), Description: "ФОП Петренко", Phones: "380501112233" }, { Ref: "x" }] }), [{ ref: R(1), name: "ФОП Петренко", phone: "380501112233" }]);
});

test("печать и отчёт по отказам", () => {
  assert.equal(npPrintUrl({ kind: "label", format: "100x100", ref: R(9), apiKey: "k1" }), `https://my.novaposhta.ua/orders/printMarking100x100/orders[]/${R(9)}/type/pdf/apiKey/k1`);
  assert.match(npPrintUrl({ kind: "label", format: "85x85", ref: R(9), apiKey: "k" }), /printMarking85x85/);
  assert.match(npPrintUrl({ kind: "document", format: "100x100", ref: R(9), apiKey: "k", base: "http://x/" }), /^http:\/\/x\/orders\/printDocument\//);
  assert.deepEqual(refusalStats([{ state: "received" }, { state: "received" }, { state: "received" }, { state: "refused" }, { state: "transit" }, { state: "deleted" }]), {
    total: 5, received: 3, refused: 1, inWork: 1, refusedPct: 25,
  });
  assert.deepEqual(refusalStats([]), { total: 0, received: 0, refused: 0, inWork: 0, refusedPct: 0 });
});
