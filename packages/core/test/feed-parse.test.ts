import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeed, FeedFormatError, decodeXmlEntities, sanitizeHtml, htmlToText } from "../src/catalog";

const here = path.dirname(fileURLToPath(import.meta.url));
// Образец — 25 настоящих товаров Vitals + полное дерево категорий (см. docs/CATALOG-IMPORT.md)
const sample = fs.readFileSync(path.join(here, "fixtures", "vitals-sample.xml"));

const wrap = (items: string, cats = '<category id="1">Инструмент</category><category id="2" parentId="1">Дрели</category>') =>
  `<?xml version="1.0" encoding="UTF-8"?><price date="2026-01-01"><shop><currency code="UAH">1.00</currency><catalog>${cats}</catalog><items>${items}</items></shop></price>`;

test("образец Vitals: товары, категории, служебные записи", () => {
  const r = parseFeed(sample);
  assert.equal(r.info.format, "items");
  assert.equal(r.info.currency, "UAH");
  assert.equal(r.info.totalRows, 25);
  assert.equal(r.categories.length, 345);
  // две записи с названием «-» отброшены с понятным сообщением
  assert.equal(r.items.length, 23);
  assert.equal(r.issues.length, 2);
  assert.match(r.issues[0].message, /названия/);
});

test("артикул — строка с ведущими нулями, цена — число, старая цена только если она выше", () => {
  const r = parseFeed(sample);
  const p = r.items.find((i) => i.sku === "000237651")!;
  assert.ok(p, "артикул 000237651 должен сохранить нули");
  assert.equal(p.price, 1599);
  assert.equal(p.oldPrice, 1909);
  assert.equal(p.articleCode, "237651");
  assert.equal(p.categoryId, "99432");
  assert.equal(p.categoryPath?.[0], "Садово-паркова техніка");
  assert.equal(p.pictures.length, 2);
});

test("наличие: true = есть, пустой <available> = нет", () => {
  const r = parseFeed(sample);
  assert.equal(r.items.find((i) => i.sku === "000237651")!.available, true);
  assert.equal(r.items.find((i) => i.sku === "000223813")!.available, false); // пустой тег
});

test("характеристики: кавычки из &quot; раскрыты, значения не пустые", () => {
  const p = parseFeed(sample).items.find((i) => i.sku === "000237651")!;
  assert.equal(p.params.length, 9);
  assert.deepEqual(p.params.find((x) => x.name.startsWith("Довжина шини")), { name: "Довжина шини, дюйм (см)", value: '6" (15)' });
});

test("описание: экранированный HTML очищен от атрибутов и style", () => {
  const p = parseFeed(sample).items.find((i) => i.sku === "000237651")!;
  assert.match(p.descriptionHtml, /^<h2>Особливості моделі/); // features_text идёт первым
  assert.ok(p.descriptionHtml.includes("<h2>Опис пили"));
  assert.ok(!/style=|&quot;text-align/.test(p.descriptionHtml));
  assert.ok(!p.descriptionHtml.includes("&lt;p"));
});

test("товар из архива определяется по пути категории", () => {
  const p = parseFeed(sample).items.find((i) => i.sku === "000223813")!;
  assert.equal(p.categoryPath?.[0], "Архів продукції");
});

test("вместо XML пришла веб-страница: понятная ошибка и диагностика", () => {
  assert.throws(
    () => parseFeed("<html><head><title>Just a moment</title></head><body><div>Checking your browser</div></body></html>"),
    (e: unknown) => e instanceof FeedFormatError && e.info.isHtml && /вручную/.test(e.message),
  );
});

test("YML-формат: offer, available в атрибуте, запятая в цене, дубль артикула", () => {
  const xml = `<yml_catalog date="2026-01-01"><shop><currency id="UAH" rate="1"/><categories><category id="1">Инструмент</category></categories><offers>
    <offer id="a1" available="false"><vendorCode>A-1</vendorCode><name>Дрель А</name><price>1 200,50</price><categoryId>1</categoryId></offer>
    <offer id="a2" available="true"><vendorCode>A-2</vendorCode><name>Дрель Б</name><price>900</price><categoryId>1</categoryId></offer>
    <offer id="a3"><vendorCode>A-2</vendorCode><name>Дубль</name><price>901</price><categoryId>1</categoryId></offer>
  </offers></shop></yml_catalog>`;
  const r = parseFeed(xml);
  assert.equal(r.info.format, "offers");
  assert.deepEqual(r.items.map((i) => [i.sku, i.price, i.available]), [["A-1", 1200.5, false], ["A-2", 900, true]]);
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0].message, /повторяется/);
});

test("нет цены, нет артикула, неизвестная категория — в список замечаний, разбор продолжается", () => {
  const xml = wrap(
    `<item id="1"><vendorCode>X1</vendorCode><name>Без цены</name><categoryId>2</categoryId></item>
     <item id="2"><name>Без артикула</name></item>
     <item><vendorCode>X3</vendorCode><name>Хорошая дрель</name><price>500.0000</price><categoryId>777</categoryId><available>true</available></item>`,
  );
  // третий товар: id нет, но артикул есть; категория 777 не описана
  const r = parseFeed(xml);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].sku, "X3");
  assert.equal(r.items[0].categoryId, null);
  assert.equal(r.issues.length, 3);
});

test("windows-1251 читается по объявлению кодировки", () => {
  const xml = `<?xml version="1.0" encoding="windows-1251"?>` + wrap(`<item id="1"><vendorCode>W1</vendorCode><name>Дриль</name><price>10</price></item>`);
  // кодируем строку в windows-1251 вручную
  const win = new TextDecoder("windows-1251");
  const table: Record<string, number> = {};
  for (let b = 0x80; b <= 0xff; b++) table[win.decode(Uint8Array.of(b))] = b;
  const bytes = Uint8Array.from([...xml].map((ch) => (ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : table[ch])));
  const r = parseFeed(bytes);
  assert.equal(r.items[0].name, "Дриль");
});

test("сущности раскрываются за один проход (&amp;quot; остаётся &quot;)", () => {
  assert.equal(decodeXmlEntities("6&quot; &amp;quot; &#1082;&#x43a; &unknown;"), '6" &quot; кк &unknown;');
});

test("очистка HTML: чужие теги, скрипты, ссылки", () => {
  const dirty = '<div class="x"><script>alert(1)</script><h1>Заголовок</h1><p style="a" onclick="b()">Текст <b>жирный</b><a href="javascript:alert(1)">плохая</a> <a href="https://vitals.ua/x?a=1&amp;b=2">хорошая</a></p><p> </p><img src="x.png"> 2 < 3</div>';
  const clean = sanitizeHtml(dirty);
  assert.equal(clean, '<h2>Заголовок</h2><p>Текст <b>жирный</b><a>плохая</a> <a href="https://vitals.ua/x?a=1&b=2" rel="nofollow noopener">хорошая</a></p> 2 &lt; 3');
});

test("htmlToText: текст для поиска без тегов", () => {
  assert.equal(htmlToText("<h2>Опис</h2><p>Пила&nbsp;<b>Vitals</b></p><ul><li>раз</li><li>два</li></ul>"), "Опис Пила Vitals раз два");
});
