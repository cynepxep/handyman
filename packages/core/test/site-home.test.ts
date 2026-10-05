import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HOME, HOME_BLOCKS, INSTOCK_MAX, bannerVisible, parseInstockSkus, toggleInstock, mergeHints, normalizeQuery, parseHidden, deliveryPageDraft, parseHomeSettings, renderPageBody, safeBannerHref, validateHomeForm, listingQuery, parseListing, clearFilters,
} from "../src/site";
import { DEFAULT_CHECKOUT } from "../src/shop";

test("главная: без настроек — все блоки по порядку, баннер выключен", () => {
  const s = parseHomeSettings(null);
  assert.deepEqual(s.blocks.map((b) => b.id), [...HOME_BLOCKS]);
  assert.ok(s.blocks.every((b) => b.on));
  assert.equal(bannerVisible(s.banner), false);
  assert.deepEqual(s, DEFAULT_HOME);
});

test("главная: сохранённый порядок, выключенные блоки, мусор и новые блоки", () => {
  const s = parseHomeSettings({ blocks: [{ id: "sale", on: false }, { id: "hits" }, { id: "xxx" }, { id: "sale" }, 5], banner: { on: true, titleUk: "Знижки", href: "javascript:alert(1)", image: "http://x/a.png" } });
  assert.deepEqual(s.blocks.slice(0, 3), [{ id: "banner", on: true }, { id: "callback", on: true }, { id: "tasks", on: true }]); // первые по умолчанию — в начало
  assert.deepEqual(s.blocks.filter((b) => b.id === "sale" || b.id === "hits"), [{ id: "sale", on: false }, { id: "hits", on: true }]); // сохранённый порядок не тронут
  assert.equal(s.blocks.length, HOME_BLOCKS.length);
  assert.equal(s.banner.href, ""); // опасная ссылка отброшена
  assert.equal(s.banner.image, ""); // только https
  assert.equal(bannerVisible(s.banner), true);
});

test("главная: новый блок «Є в наявності» встаёт сразу после «Каталога», а не в конец", () => {
  // так сохранено у владельца до появления блока: свой порядок, «Каталог» поднят выше задач
  const old = ["banner", "groups", "tasks", "battery", "hits", "sale", "new", "viewed", "trust", "help"].map((id) => ({ id, on: id !== "battery" }));
  const s = parseHomeSettings({ blocks: old });
  assert.deepEqual(s.blocks.map((b) => b.id), ["banner", "callback", "groups", "instock", "tasks", "battery", "hits", "sale", "new", "viewed", "trust", "help"]);
  assert.equal(s.blocks.find((b) => b.id === "instock")?.on, true);
  assert.equal(s.blocks.find((b) => b.id === "battery")?.on, false);
  assert.deepEqual(s.instock, []);
});

test("главная: новый блок «Передзвонимо» встаёт сразу после баннера (под заголовком), включённым; выключенный владельцем — остаётся выключенным", () => {
  const old = ["groups", "banner", "instock", "tasks", "battery", "hits", "sale", "new", "viewed", "trust", "help"].map((id) => ({ id, on: true }));
  const s = parseHomeSettings({ blocks: old });
  assert.deepEqual(s.blocks.slice(0, 3).map((b) => b.id), ["groups", "banner", "callback"]);
  assert.equal(s.blocks.find((b) => b.id === "callback")?.on, true);
  const off = parseHomeSettings({ blocks: [...old, { id: "callback", on: false }] });
  assert.equal(off.blocks.find((b) => b.id === "callback")?.on, false);
  assert.equal(off.blocks.at(-1)?.id, "callback", "сохранённое место не трогаем");
});

test("главная: список «Є в наявності» — артикулы по порядку, без повторов и мусора", () => {
  assert.deepEqual(parseInstockSkus(" 000237651 \n\nAB-12, 000237651; X9 "), ["000237651", "AB-12", "X9"]);
  assert.deepEqual(parseInstockSkus(["a", 5, "b", "x".repeat(41)]), ["a", "b"]);
  assert.equal(parseInstockSkus(Array.from({ length: 100 }, (_, i) => `s${i}`).join("\n")).length, INSTOCK_MAX);
  assert.deepEqual(parseHomeSettings({ instock: ["1", "2", "1"] }).instock, ["1", "2"]);
  // из карточки товара: добавленный — первым (свежее видео), повторное добавление поднимает наверх, снятие убирает
  assert.deepEqual(toggleInstock(["a", "b"], "c", true), ["c", "a", "b"]);
  assert.deepEqual(toggleInstock(["a", "b"], "b", true), ["b", "a"]);
  assert.deepEqual(toggleInstock(["a", "b"], "a", false), ["b"]);
  const form: Record<string, string> = { "instock.skus": "111\n222\n111" };
  const r = validateHomeForm(form);
  assert.ok(r.ok && r.value.instock.join() === "111,222");
});

test("главная: форма админки — порядок по номерам, проверки баннера", () => {
  const base: Record<string, string> = {};
  HOME_BLOCKS.forEach((id, i) => {
    base[`order.${id}`] = String(i + 1);
    base[`on.${id}`] = "on";
  });
  const r = validateHomeForm({ ...base, "order.hits": "0", "on.trust": "" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.blocks[0].id, "hits");
    assert.equal(r.value.blocks.find((b) => b.id === "trust")?.on, false);
  }
  assert.equal(validateHomeForm({ ...base, "banner.on": "on" }).ok, false); // нет заголовка
  assert.equal(validateHomeForm({ ...base, "banner.titleUk": "А", "banner.buttonUk": "Купити" }).ok, false); // кнопка без ссылки
  assert.equal(validateHomeForm({ ...base, "banner.href": "ftp://x" }).ok, false);
  const ok = validateHomeForm({ ...base, "banner.on": "on", "banner.titleUk": "Знижки −20%", "banner.href": "/catalog/dysky", "banner.image": "https://example.com/a.jpg" });
  assert.ok(ok.ok && ok.value.banner.on && ok.value.banner.href === "/catalog/dysky");
  assert.equal(safeBannerHref("//evil.com"), "");
});

test("адрес списка: «Усі хіти» и «Усі новинки»", () => {
  const s = parseListing(new URLSearchParams("hit=1&new=1"), []);
  assert.equal(s.hit, true);
  assert.equal(s.isNew, true);
  assert.equal(listingQuery(s), "?hit=1&new=1");
  assert.equal(parseListing(new URLSearchParams(""), []).hit, undefined);
});

test("черновик «Доставка і оплата» — только включённые способы и суммы из настроек", () => {
  const c = { addressUk: "Одеса, Богданівська 5", addressRu: "", hoursUk: "Пн–Сб 9–18", hoursRu: "" };
  const d = deliveryPageDraft(DEFAULT_CHECKOUT, c);
  assert.match(d.uk, /Нова Пошта/);
  assert.match(d.uk, /Богданівська 5/);
  assert.match(d.uk, /Передплата 200 ₴/);
  assert.match(d.uk, /3–4 дні/);
  assert.match(d.ru, /Богданівська 5/); // русского адреса нет — берём украинский
  assert.doesNotMatch(d.uk, /знижка/);
  const only = deliveryPageDraft({ ...DEFAULT_CHECKOUT, prepayAmount: 0, delivery: { np: true, pickup: false, courier: false }, pay: { prepay: true, full: false, card: false } }, c);
  assert.doesNotMatch(only.uk, /Самовивіз|Кур’єр по Одесі|реквізит/);
  assert.match(only.uk, /Оплата при отриманні/);
  // разметка страницы превращается в заголовки и списки
  const html = renderPageBody(d.uk);
  assert.match(html, /<h2>Доставка<\/h2>/);
  assert.match(html, /<li>/);
});


test("подсказки поиска: запрос без личных данных", () => {
  assert.equal(normalizeQuery("  Круг   125 "), "круг 125");
  assert.equal(normalizeQuery("«Болгарка»"), "болгарка");
  assert.equal(normalizeQuery("000237651"), null); // артикул
  assert.equal(normalizeQuery("+380 93 366 24 07"), null); // телефон
  assert.equal(normalizeQuery("мій номер 0933662407"), null);
  assert.equal(normalizeQuery("ivan@mail.com"), null);
  assert.equal(normalizeQuery("https://site.ua"), null);
  assert.equal(normalizeQuery("а"), null);
  assert.equal(normalizeQuery("x".repeat(41)), null);
});

test("подсказки поиска: сначала владелец, потом популярные и заказы, без повторов и скрытых", () => {
  const r = mergeHints({
    pinned: ["круг 125", "Болгарка"],
    popular: ["болгарка", "свердло 6", "лайно", "диск алмазний"],
    fromOrders: [{ text: "Відрізні по металу", href: "/catalog/x/y" }],
    hidden: parseHidden("лайно\n, "),
    max: 5,
  });
  assert.deepEqual(r.map((h) => h.text), ["круг 125", "Болгарка", "свердло 6", "диск алмазний", "Відрізні по металу"]);
  assert.equal(r[4].href, "/catalog/x/y");
  assert.equal(mergeHints({ pinned: ["a1", "b2", "c3"], popular: ["d4"], max: 2 }).length, 2);
});

test("главная: настройки подсказок поиска", () => {
  assert.deepEqual(parseHomeSettings({}).hints, { max: 8, hidden: [] });
  assert.deepEqual(parseHomeSettings({ hints: { max: 99, hidden: ["Лайно", 5] } }).hints, { max: 20, hidden: ["лайно"] });
  const r = validateHomeForm({ "hints.max": "5", "hints.hidden": "погане слово\nще одне", "hide.0": "Дурня", "hide.1": "" });
  assert.ok(r.ok && r.value.hints.max === 5 && r.value.hints.hidden.join("|") === "погане слово|ще одне|дурня");
});

test("список: часть подраздела ?part= — в адресе туда и обратно, мусор отбрасывается, «Скинути» её не сбрасывает", () => {
  const s = parseListing(new URLSearchParams("part=bity-ta-trymachi&avail=1"), []);
  assert.equal(s.part, "bity-ta-trymachi");
  assert.match(listingQuery(s), /part=bity-ta-trymachi/);
  assert.equal(parseListing(new URLSearchParams("part=<script>"), []).part, undefined);
  assert.equal(clearFilters(s).part, "bity-ta-trymachi");
  assert.equal(clearFilters(s).available, false);
});
