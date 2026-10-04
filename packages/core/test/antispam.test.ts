// Шаг 8.3: защита форм (ловушка, «слишком быстро», окна лимитов, подпись корзины) и «Проверка перед запуском»; 8.5 — открытие для Google.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_FILL_MS, RATE_RULES, cartSignature, filledTooFast, rateWindow, trapFilled } from "../src/shop";
import { dangerousEnv, isTemplateValue, launchChecklist, launchSummary, robotsBlocks, robotsRules, type LaunchFacts } from "../src/launch-check";

test("ловушка и «слишком быстро»: бот — да, старая страница без замера — пропускаем", () => {
  assert.equal(trapFilled("http://spam"), true);
  assert.equal(trapFilled("  "), false);
  assert.equal(trapFilled(undefined), false);
  assert.equal(filledTooFast(800), true);
  assert.equal(filledTooFast("1200"), true); // из FormData приходит строкой
  assert.equal(filledTooFast(MIN_FILL_MS), false);
  assert.equal(filledTooFast(45_000), false);
  // нет числа (открытая до обновления сайта страница, прямой запрос) — решают лимиты, живого покупателя не отсекаем
  for (const v of [undefined, null, "", "abc", -5, Number.NaN]) assert.equal(filledTooFast(v), false, String(v));
});

test("окно лимита: номер окна, конец и сколько ждать", () => {
  const rule = RATE_RULES.order; // 5 за 10 минут
  const t = new Date("2026-09-30T10:03:20Z");
  const w = rateWindow(rule, t);
  assert.equal(w.expiresAt.toISOString(), "2026-09-30T10:10:00.000Z");
  assert.equal(w.retryAfterSec, 400);
  assert.equal(rateWindow(rule, new Date("2026-09-30T10:09:59.999Z")).bucket, w.bucket);
  assert.notEqual(rateWindow(rule, new Date("2026-09-30T10:10:00Z")).bucket, w.bucket);
  // все правила разумные: положительные лимит и окно
  for (const [name, r] of Object.entries(RATE_RULES)) assert.ok(r.limit > 0 && r.windowSec > 0 && r.what, name);
});

test("подпись корзины: порядок не важен, одинаковые артикулы складываются, другое количество — другая корзина", () => {
  const a = cartSignature([{ sku: "B2", qty: 1 }, { sku: "A1", qty: 2 }]);
  assert.equal(a, "A1×2,B2×1");
  assert.equal(cartSignature([{ sku: "A1", qty: 1 }, { sku: "B2", qty: 1 }, { sku: "A1", qty: 1 }]), a);
  assert.notEqual(cartSignature([{ sku: "A1", qty: 3 }, { sku: "B2", qty: 1 }]), a);
  assert.equal(cartSignature([]), "");
});

const base = (): LaunchFacts => ({
  production: true,
  env: {
    ADMIN_TOKEN: "Very-long-own-pass-2026", SECRETS_KEY: "k".repeat(44), MEILI_MASTER_KEY: "m".repeat(32), PUBLIC_URL: "https://handyman.example",
    DATABASE_URL: "postgresql://handyman:S3cret-db@postgres:5432/handyman", HEALTH_KEY: "h".repeat(24),
  },
  owner: { exists: true, defaultPassword: false, passwordIsAdminToken: false, twoFactor: true },
  staff: { require2fa: true, activeWithout2fa: 0 },
  tmp: { route: false, account: false },
  backup: { lastOkAt: "2026-09-30T01:00:00Z", checkOk: true, checkAt: "2026-09-28T02:00:00Z", offsite: true },
  integrations: [
    { id: "telegram", title: "Telegram-бот", configured: true, check: { ok: true, at: "2026-09-29T10:00:00Z" } },
    { id: "mono", title: "monobank", configured: false, check: null },
    { id: "backup", title: "Облако", configured: true, check: { ok: true, at: "2026-09-29T10:00:00Z" } },
    { id: "analytics", title: "Аналитика", configured: true, check: { ok: true, at: "2026-09-29T10:00:00Z" } },
  ],
  openErrors: 0,
  indexing: { open: true, at: "2026-09-30T09:00:00Z" },
  sitemap: { urls: 20_000, products: 9_900 },
  searchConsole: { code: true, verified: true },
  analytics: { enabled: true },
});
const NOW = new Date("2026-09-30T12:00:00Z");
const byId = (f: LaunchFacts) => Object.fromEntries(launchChecklist(f, NOW).map((i) => [i.id, i.status]));

test("проверка перед запуском: всё настроено — можно запускать; не подключённое необязательное — «не подключено»", () => {
  const items = launchChecklist(base(), NOW);
  const s = launchSummary(items);
  assert.equal(s.ready, true);
  assert.equal(s.fail, 0);
  assert.equal(s.warn, 0);
  const st = byId(base());
  assert.equal(st["integration-mono"], "info");
  assert.equal(st["integration-backup"], undefined, "облако копий — в группе «Резервные копии», не дублируется");
  // у каждого непройденного пункта есть «что сделать»
  for (const i of items) if (i.status === "fail" || i.status === "warn") assert.ok(i.fix, i.id);
});

test("проверка перед запуском: опасные значения — «не готово», на ПК серверные пункты — только «желательно»", () => {
  const f = base();
  f.env = { ADMIN_TOKEN: "change-me", MEILI_MASTER_KEY: "change-me-search-key", DATABASE_URL: "postgresql://handyman:handyman@localhost:5432/handyman", HM_TMP_LOGIN: "1" };
  f.owner = { exists: true, defaultPassword: true, passwordIsAdminToken: false, twoFactor: false };
  f.staff = { require2fa: false, activeWithout2fa: 2 };
  f.tmp = { route: true, account: false };
  f.backup = { lastOkAt: "2026-09-28T01:00:00Z", checkOk: false, checkAt: "2026-09-29T01:00:00Z", offsite: false };
  f.integrations = [{ id: "telegram", title: "Telegram-бот", configured: true, check: { ok: false, at: "2026-09-29T10:00:00Z" } }];
  f.openErrors = 3;
  const st = byId(f);
  for (const id of ["admin-token", "owner-password", "owner-2fa", "tmp-login", "secrets-key", "search-key", "db-password", "public-url", "backup-fresh", "backup-check", "integration-telegram"]) {
    assert.equal(st[id], "fail", id);
  }
  for (const id of ["staff-2fa", "health-key", "backup-offsite", "errors"]) assert.equal(st[id], "warn", id);
  assert.equal(launchSummary(launchChecklist(f, NOW)).ready, false);
  // тот же набор на ПК владельца (режим разработки): серверные пункты — «желательно», а пароли и временный вход — всё равно «не готово»
  const pc = byId({ ...f, production: false });
  for (const id of ["secrets-key", "search-key", "db-password", "public-url", "node-env"]) assert.equal(pc[id], "warn", id);
  for (const id of ["admin-token", "owner-password", "tmp-login"]) assert.equal(pc[id], "fail", id);
  // пароль owner = ADMIN_TOKEN (не меняли после первого входа) — «желательно»; бот без ключей — «желательно», не «не подключено»
  const g = base();
  g.owner.passwordIsAdminToken = true;
  g.integrations = [{ id: "telegram", title: "Telegram-бот", configured: false, check: null }];
  assert.equal(byId(g)["owner-password"], "warn");
  assert.equal(byId(g)["integration-telegram"], "warn");
});

test("опасные значения .env на сервере: список сообщений без самих значений", () => {
  assert.deepEqual(dangerousEnv(base().env), []);
  const msgs = dangerousEnv({ ADMIN_TOKEN: "change-me", MEILI_MASTER_KEY: "", PUBLIC_URL: "http://1.2.3.4", HM_TMP_LOGIN: "1", DATABASE_URL: "postgresql://handyman:handyman@db/handyman" });
  assert.equal(msgs.length, 6);
  assert.ok(msgs.every((m) => !m.includes("handyman@") && !m.includes("1.2.3.4")));
  assert.equal(isTemplateValue(" Change-Me-too "), true);
  assert.equal(isTemplateValue("own-value"), false);
});

test("открытие для Google (8.5): до запуска закрыто всё; после — витрина открыта, служебное и фильтры закрыты", () => {
  assert.deepEqual(robotsRules(false), [{ userAgent: "*", disallow: "/" }]);
  assert.equal(robotsBlocks(false, "/"), true);
  assert.equal(robotsBlocks(false, "/product/M18-1/akumulyator"), true);
  for (const p of ["/", "/ru", "/catalog", "/catalog/elektroinstrument/dryli", "/ru/catalog/elektroinstrument", "/product/4933451-1/drel", "/task/sverlyty", "/info/dostavka", "/media/p/ab.webp"]) {
    assert.equal(robotsBlocks(true, p), false, p);
  }
  for (const p of ["/admin", "/admin/orders", "/design", "/api/health", "/cart", "/ru/cart", "/checkout", "/ru/checkout", "/order/HM-0001?k=x",
    "/account", "/favorites", "/ru/compare", "/search?q=дриль", "/search", "/catalog/dryli?brand=Milwaukee", "/?ref=abc", "/product/1/x?utm_source=fb"]) {
    assert.equal(robotsBlocks(true, p), true, p);
  }
  const [rule] = robotsRules(true);
  assert.equal(rule.allow, "/");
  assert.ok(Array.isArray(rule.disallow) && rule.disallow.includes("/admin"));
});

test("проверка перед запуском: «открыт для Google» — закрыт до запуска не мешает; открыт на ПК — «желательно»", () => {
  const f = base();
  assert.equal(byId(f).indexing, "ok");
  f.indexing = { open: false, at: null };
  assert.equal(byId(f).indexing, "info");
  assert.equal(launchSummary(launchChecklist(f, NOW)).ready, true, "закрытый сайт не мешает «можно запускать»");
  assert.equal(byId({ ...base(), production: false }).indexing, "warn");
});
