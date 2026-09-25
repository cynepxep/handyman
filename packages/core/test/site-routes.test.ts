import { test } from "node:test";
import assert from "node:assert/strict";
import { routeStorefront, shopHref, stripLang, switchLang, paths, isShopLang, productSlug } from "../src/site/routes";
import { parseListing, listingQuery, toggleFacet, hasFilters, clearFilters, filterCount } from "../src/site/listing";

const KEYS = ["diameter", "series"];

test("фильтры из адреса: разбор, мусор отбрасывается, сборка обратно", () => {
  const s = parseListing(new URLSearchParams("f.diameter=125&f.diameter=180&f.diameter=125&f.zzz=1&avail=1&sale=0&min=500&max=100&sort=price_asc&page=3"), KEYS);
  assert.deepEqual(s.facets, { diameter: ["125", "180"] }, "повтор и неизвестный фильтр отброшены");
  assert.equal(s.available, true);
  assert.equal(s.sale, false);
  assert.deepEqual([s.min, s.max], [100, 500], "«от» больше «до» — меняем местами");
  assert.equal(s.sort, "price_asc");
  assert.equal(s.page, 3);
  assert.equal(listingQuery(s), "?f.diameter=125&f.diameter=180&avail=1&min=100&max=500&sort=price_asc&page=3");
  assert.equal(listingQuery(s, "круг").startsWith("?q=%D0%BA"), true);
  const bad = parseListing({ sort: "drop table", page: "-5", min: "abc" }, KEYS);
  assert.deepEqual(bad, { facets: {}, available: false, local: false, sale: false, page: 1 });
  const fast = parseListing({ fast: "1" }, KEYS);
  assert.equal(fast.local, true);
  assert.equal(listingQuery(fast), "?fast=1");
  assert.equal(parseListing({ page: "99999" }, KEYS).page, 200, "не больше 200 страниц");
  assert.equal(listingQuery(parseListing({}, KEYS)), "");
});

test("фильтры: включить/выключить значение, быстрый выбор, сброс", () => {
  let s = parseListing({ page: "4" }, KEYS);
  s = toggleFacet(s, "diameter", "125");
  assert.deepEqual(s.facets, { diameter: ["125"] });
  assert.equal(s.page, 1, "после смены фильтра — первая страница");
  s = toggleFacet(s, "diameter", "180");
  assert.deepEqual(s.facets.diameter, ["125", "180"]);
  assert.deepEqual(toggleFacet(s, "diameter", "230", true).facets.diameter, ["230"], "быстрый выбор оставляет одно значение");
  assert.deepEqual(toggleFacet(toggleFacet(s, "diameter", "125"), "diameter", "180").facets, {}, "последнее значение снято — фильтра нет");
  assert.equal(filterCount({ ...s, available: true, min: 5 }), 4);
  assert.equal(hasFilters(clearFilters({ ...s, sort: "new" })), false);
  assert.equal(clearFilters({ ...s, sort: "new" }).sort, "new", "сортировка при сбросе фильтров остаётся");
});

test("proxy: украинская версия без приставки показывается из /uk", () => {
  assert.deepEqual(routeStorefront("/"), { kind: "rewrite", path: "/uk" });
  assert.deepEqual(routeStorefront("/catalog"), { kind: "rewrite", path: "/uk/catalog" });
  assert.deepEqual(routeStorefront("/info/delivery"), { kind: "rewrite", path: "/uk/info/delivery" });
  assert.deepEqual(routeStorefront("/ukraine"), { kind: "rewrite", path: "/uk/ukraine" }, "«/ukraine» — не языковая приставка");
  assert.deepEqual(routeStorefront("/rus"), { kind: "rewrite", path: "/uk/rus" });
});

test("proxy: русская версия идёт как есть, /uk/… перенаправляется на адрес без приставки", () => {
  assert.deepEqual(routeStorefront("/ru"), { kind: "pass" });
  assert.deepEqual(routeStorefront("/ru/catalog"), { kind: "pass" });
  assert.deepEqual(routeStorefront("/uk"), { kind: "redirect", path: "/" });
  assert.deepEqual(routeStorefront("/uk/catalog"), { kind: "redirect", path: "/catalog" });
});

test("proxy: админка, стенды, API, служебные файлы и файлы с расширением не трогаются", () => {
  for (const p of ["/admin", "/admin/site/texts", "/design", "/design/v2", "/api/catalog/suggest", "/_next/static/x.js", "/__nextjs_original-stack-frame", "/favicon.ico", "/robots.txt"]) {
    assert.deepEqual(routeStorefront(p), { kind: "pass" }, p);
  }
  assert.deepEqual(routeStorefront("/administrator"), { kind: "rewrite", path: "/uk/administrator" }, "только раздел /admin, не всё, что начинается на admin");
});

test("ссылки на языке: укр. без приставки, рус. с /ru, запрос и якорь сохраняются", () => {
  assert.equal(shopHref("uk", "/catalog"), "/catalog");
  assert.equal(shopHref("ru", "/catalog"), "/ru/catalog");
  assert.equal(shopHref("ru", "/"), "/ru");
  assert.equal(shopHref("ru", "/?a=1"), "/ru?a=1");
  assert.equal(shopHref("ru", "/search?q=круг"), "/ru/search?q=круг");
  assert.equal(shopHref("uk", "catalog"), "/catalog");
});

test("переключатель языка ведёт на ту же страницу", () => {
  assert.equal(stripLang("/ru/catalog?x=1"), "/catalog?x=1");
  assert.equal(stripLang("/ru"), "/");
  assert.equal(stripLang("/ru?q=1"), "/?q=1");
  assert.equal(stripLang("/rus"), "/rus");
  assert.equal(switchLang("/catalog", "ru"), "/ru/catalog");
  assert.equal(switchLang("/ru/search?q=круг", "uk"), "/search?q=круг");
  assert.equal(switchLang("/", "ru"), "/ru");
  assert.equal(switchLang("/ru", "uk"), "/");
});

test("адреса страниц витрины", () => {
  assert.equal(paths.search("круг 125"), "/search?q=%D0%BA%D1%80%D1%83%D0%B3+125");
  assert.equal(paths.search("круг", 2), "/search?q=%D0%BA%D1%80%D1%83%D0%B3&page=2");
  assert.equal(paths.search(), "/search");
  assert.equal(paths.info("delivery"), "/info/delivery");
  assert.equal(paths.group("dysky-ta-kruhy"), "/catalog/dysky-ta-kruhy");
  assert.equal(paths.sub("dysky-ta-kruhy", "vidrizni-po-metalu"), "/catalog/dysky-ta-kruhy/vidrizni-po-metalu");
  assert.equal(shopHref("ru", paths.task("rizaty-metal")), "/ru/task/rizaty-metal");
  assert.ok(isShopLang("uk") && isShopLang("ru") && !isShopLang("en") && !isShopLang(undefined));
});

test("адрес товара: артикул + название транслитом, длинные названия обрезаются по слову", () => {
  assert.equal(paths.product("000237651", "Круг відрізний по металу Vitals 125×1,2×22,2 мм"), "/product/000237651/kruh-vidriznyy-po-metalu-vitals-125-1-2-22-2-mm");
  assert.equal(productSlug("***"), "tovar");
  const long = productSlug("Пила ".repeat(40));
  assert.ok(long.length <= 80 && !long.endsWith("-"));
  assert.equal(paths.product("AB/12", "Тест"), "/product/AB%2F12/test", "артикул с «/» не ломает адрес");
});
