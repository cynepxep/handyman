import { test } from "node:test";
import assert from "node:assert/strict";
import { routeStorefront, shopHref, stripLang, switchLang, paths, isShopLang } from "../src/site/routes";

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
  assert.equal(paths.sub("discs", "discs-cut"), "/catalog/discs/discs-cut");
  assert.equal(paths.group("discs"), "/catalog#g-discs");
  assert.equal(shopHref("ru", paths.group("discs")), "/ru/catalog#g-discs");
  assert.equal(paths.product("000237651"), "/search?q=000237651", "до шага 2.5 товар открывается поиском по артикулу");
  assert.ok(isShopLang("uk") && isShopLang("ru") && !isShopLang("en") && !isShopLang(undefined));
});
