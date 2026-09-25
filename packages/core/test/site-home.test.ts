import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HOME, HOME_BLOCKS, bannerVisible, deliveryPageDraft, parseHomeSettings, renderPageBody, safeBannerHref, validateHomeForm, listingQuery, parseListing,
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
  assert.deepEqual(s.blocks.slice(0, 2), [{ id: "sale", on: false }, { id: "hits", on: true }]);
  assert.equal(s.blocks.length, HOME_BLOCKS.length); // остальные дописаны в конец
  assert.equal(s.banner.href, ""); // опасная ссылка отброшена
  assert.equal(s.banner.image, ""); // только https
  assert.equal(bannerVisible(s.banner), true);
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
