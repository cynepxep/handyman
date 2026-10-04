// Карта сайта (шаг Л1): какие адреса попадают, оба языка, исключения, деление на файлы, robots.txt; Search Console в «Проверке перед запуском».
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SITEMAP_PATHS_PER_FILE, parseSitemapFile, productSitemapPath, robotsConfig, sitemapFileCount, sitemapFileRange, sitemapIndexXml,
  sitemapPagePaths, sitemapXml, type SitemapSource,
} from "../src/sitemap";
import { launchChecklist, parseGoogleVerification, robotsBlocks, type LaunchFacts } from "../src/launch-check";
import type { MenuConfig } from "../src/catalog/storefront-menu";

const sub = (id: string, nameUk: string, categoryIds: string[], extra: Record<string, unknown> = {}) => ({ id, nameUk, nameRu: nameUk, categoryIds, ...extra });
const menu = (): MenuConfig => ({
  groups: [
    {
      id: "g1", nameUk: "Електроінструмент", nameRu: "Электроинструмент", hintUk: "", hintRu: "", quickPick: [], slug: "elektroinstrument",
      subs: [sub("s1", "Дрилі", ["drills"], { slug: "dryli" }), sub("s2", "Пили", ["saws"], { slug: "pyly" }), sub("s3", "Приховане", ["secret"], { slug: "secret", hidden: true })],
    },
    { id: "g2", nameUk: "Порожній", nameRu: "Пустой", hintUk: "", hintRu: "", quickPick: [], slug: "empty", subs: [sub("s4", "Нічого", ["none"], { slug: "nothing" })] },
    { id: "g3", nameUk: "Схована група", nameRu: "", hintUk: "", hintRu: "", quickPick: [], slug: "hidden-group", hidden: true, subs: [sub("s5", "Дрібниці", ["misc"], { slug: "misc" })] },
  ],
  tasks: [
    { id: "t1", nameUk: "Свердлити", nameRu: "", hintUk: "", hintRu: "", categoryIds: ["drills"], icon: "drill", slug: "sverlyty" },
    { id: "t2", nameUk: "Порожня задача", nameRu: "", hintUk: "", hintRu: "", categoryIds: ["none"], icon: "x", slug: "empty-task" },
    { id: "t3", nameUk: "Схована задача", nameRu: "", hintUk: "", hintRu: "", categoryIds: ["drills"], icon: "x", slug: "hidden-task", hidden: true },
  ],
});
const src = (): SitemapSource => ({
  menu: menu(),
  categories: ["drills", "saws", "secret", "none", "misc", "unsorted"].map((id) => ({ id, parentId: null })),
  counts: { drills: 5, saws: 2, secret: 3, misc: 4, unsorted: 100 },
  pages: [{ slug: "dostavka", visible: true }, { slug: "chernovyk", visible: false }],
});

test("карта: главная, каталог, разделы и подразделы с товарами, задачи, видимые страницы — без скрытого и пустого", () => {
  const list = sitemapPagePaths(src()).map((p) => p.path);
  assert.deepEqual(list, [
    "/", "/catalog", "/catalog/elektroinstrument", "/catalog/elektroinstrument/dryli", "/catalog/elektroinstrument/pyly", "/task/sverlyty", "/info/dostavka",
  ]);
  // ни одного адреса, закрытого в robots.txt после открытия
  for (const p of list) assert.equal(robotsBlocks(true, p), false, p);
  // «Нераспределённые» не делают раздел непустым
  const s = src();
  s.counts = { unsorted: 50 };
  assert.deepEqual(sitemapPagePaths(s).map((p) => p.path), ["/", "/catalog", "/info/dostavka"]);
});

test("карта: товар — тот же адрес, что canonical страницы; дата изменения — lastmod", () => {
  assert.deepEqual(productSitemapPath({ sku: "4933451-1", nameUk: "Дриль Milwaukee M18", updatedAt: "2026-10-01T10:00:00.000Z" }), {
    path: "/product/4933451-1/dryl-milwaukee-m18", lastModified: "2026-10-01T10:00:00.000Z",
  });
  assert.equal(productSitemapPath({ sku: "A/B 1", nameUk: "Круг" }).path, "/product/A%2FB%201/kruh");
  assert.equal(productSitemapPath({ sku: "X", nameUk: "Y", updatedAt: null }).lastModified, undefined);
});

test("карта: каждый адрес на двух языках со ссылками друг на друга, спецсимволы экранированы", () => {
  const xml = sitemapXml([{ path: "/" }, { path: "/product/A%261/kruh", lastModified: "2026-10-01T10:00:00.000Z" }], "https://handyman.example/");
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ["https://handyman.example/", "https://handyman.example/ru", "https://handyman.example/product/A%261/kruh", "https://handyman.example/ru/product/A%261/kruh"]);
  const first = xml.split("<url>")[1];
  assert.ok(first.includes('hreflang="uk" href="https://handyman.example/"'));
  assert.ok(first.includes('hreflang="ru" href="https://handyman.example/ru"'));
  assert.ok(first.includes('hreflang="x-default" href="https://handyman.example/"'));
  assert.equal((xml.match(/<lastmod>2026-10-01T10:00:00.000Z<\/lastmod>/g) ?? []).length, 2);
  assert.ok(sitemapXml([{ path: "/info/a&b" }], "https://x.example").includes("/info/a&amp;b"));
  assert.ok(!sitemapXml([{ path: "/info/a&b" }], "https://x.example").includes("a&b"));
});

test("карта: до 25 000 адресов страниц — один файл; больше — оглавление и файлы по 50 000 строк", () => {
  assert.equal(sitemapFileCount(0, 0), 1);
  assert.equal(sitemapFileCount(100, SITEMAP_PATHS_PER_FILE - 100), 1);
  assert.equal(sitemapFileCount(100, SITEMAP_PATHS_PER_FILE - 99), 2);
  assert.equal(SITEMAP_PATHS_PER_FILE * 2, 50_000);
  // файл 1: все страницы + начало товаров; файл 2: продолжение товаров без пропусков и повторов
  const pages = 100, products = 30_000;
  const r1 = sitemapFileRange(1, pages, products), r2 = sitemapFileRange(2, pages, products);
  assert.deepEqual(r1, { pages: [0, 100], products: [0, SITEMAP_PATHS_PER_FILE - 100] });
  assert.deepEqual(r2, { pages: [100, 100], products: [SITEMAP_PATHS_PER_FILE - 100, 30_000] });
  assert.deepEqual(sitemapFileRange(3, pages, products), { pages: [100, 100], products: [30_000, 30_000] });
  const xml = sitemapIndexXml(2, "https://handyman.example");
  assert.ok(xml.includes("<sitemapindex"));
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), ["https://handyman.example/sitemap/1.xml", "https://handyman.example/sitemap/2.xml"]);
  assert.equal(parseSitemapFile("2.xml"), 2);
  for (const bad of ["0.xml", "02.xml", "2", "x.xml", "2.xml.gz", "../1.xml"]) assert.equal(parseSitemapFile(bad), null, bad);
});

test("robots.txt: строка Sitemap — только после открытия сайта", () => {
  assert.deepEqual(robotsConfig(false, "https://handyman.example"), { rules: [{ userAgent: "*", disallow: "/" }] });
  const open = robotsConfig(true, "https://handyman.example/");
  assert.equal(open.sitemap, "https://handyman.example/sitemap.xml");
  assert.equal(open.rules[0].allow, "/");
  // сама карта не закрыта правилами
  assert.equal(robotsBlocks(true, "/sitemap.xml"), false);
  assert.equal(robotsBlocks(true, "/sitemap/2.xml"), false);
});

test("Search Console: код из мета-тега или сам код; мусор — invalid", () => {
  const code = "AbCdEf_123-xyzXYZ0987654321";
  assert.equal(parseGoogleVerification(code), code);
  assert.equal(parseGoogleVerification(` <meta name="google-site-verification" content="${code}" /> `), code);
  assert.equal(parseGoogleVerification(`<meta content='${code}' name='google-site-verification'>`), code);
  assert.equal(parseGoogleVerification("   "), null);
  for (const bad of ["short", "<script>alert(1)</script>", 'content="a b c d e f g h"', "x".repeat(101)]) assert.equal(parseGoogleVerification(bad), "invalid", bad);
});

const facts = (): LaunchFacts => ({
  production: true,
  env: { PUBLIC_URL: "https://handyman.example" },
  owner: { exists: true, defaultPassword: false, passwordIsAdminToken: false, twoFactor: true },
  staff: { require2fa: true, activeWithout2fa: 0 },
  tmp: { route: false, account: false },
  backup: { lastOkAt: null, checkOk: null, checkAt: null, offsite: false },
  integrations: [],
  openErrors: 0,
  indexing: { open: false, at: null },
  sitemap: { urls: 19_812, products: 9_800 },
  searchConsole: { code: false, verified: false },
  analytics: { enabled: false },
});
const item = (f: LaunchFacts, id: string) => launchChecklist(f).find((i) => i.id === id)!;

test("проверка перед запуском: «Карта сайта» и «Search Console подтверждён»", () => {
  const f = facts();
  assert.equal(item(f, "sitemap").status, "info", "закрытый сайт: карта готова, но Google её пока не видит");
  assert.match(item(f, "sitemap").detail, /адресов: 19812/);
  assert.equal(item(f, "search-console").status, "info");
  f.indexing.open = true;
  assert.equal(item(f, "sitemap").status, "ok");
  assert.match(item(f, "sitemap").detail, /https:\/\/handyman\.example\/sitemap\.xml/);
  assert.equal(item(f, "search-console").status, "warn", "сайт открыт, а Search Console не подключён");
  f.sitemap = { urls: 8, products: 0 };
  assert.equal(item(f, "sitemap").status, "warn");
  f.indexing.open = false;
  f.searchConsole = { code: true, verified: false };
  assert.equal(item(f, "search-console").status, "warn", "код вписан — осталось подтвердить");
  f.searchConsole.verified = true;
  assert.equal(item(f, "search-console").status, "ok");
  // ни один из новых пунктов не мешает «можно запускать»
  for (const id of ["sitemap", "search-console"]) assert.notEqual(item(facts(), id).status, "fail");
});
