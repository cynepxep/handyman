// Аналитика (шаг А2): готовый контейнер GTM. Файл deploy/gtm-container.json = сборка из кода; ссылки и ID в нём целы; код тегов — ES5 и
// исполняется; маленький «симулятор GTM» прогоняет события сайта (в том виде, как их пишет track()) через триггеры и теги и смотрит,
// что ушло в GA4, Google Ads, Meta и TikTok.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  GTM_ALL_PAGES, GTM_VAR, PIXEL_EVENTS, buildGtmContainer, gtmContainerJson, type GtmCondition, type GtmContainerExport, type GtmParam, type GtmTag,
} from "../src/gtm-container";
import { ANALYTICS_EVENTS, analyticsConfigPush, analyticsItem, ecommerceOf, purchaseEvent, type AnalyticsIds } from "../src/shop/analytics";

const C = buildGtmContainer();
const V = C.containerVersion;

test("deploy/gtm-container.json совпадает со сборкой из кода (после правки тегов — pnpm gtm:container)", () => {
  const file = readFileSync(new URL("../../../deploy/gtm-container.json", import.meta.url), "utf8");
  assert.equal(file, gtmContainerJson());
  assert.equal(JSON.parse(file).exportFormatVersion, 2);
});

// ---------- целостность ----------

const refsIn = (s: string) => [...s.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]);
function strings(p: unknown): string[] {
  if (typeof p === "string") return [p];
  if (Array.isArray(p)) return p.flatMap(strings);
  if (p && typeof p === "object") return Object.values(p).flatMap(strings);
  return [];
}

test("целостность: уникальные ID и имена, ссылки на триггеры, переменные, папки и теги-подготовки существуют", () => {
  for (const [list, id] of [[V.tag, "tagId"], [V.trigger, "triggerId"], [V.variable, "variableId"], [V.folder, "folderId"]] as const) {
    const ids = (list as Array<Record<string, string>>).map((x) => x[id]);
    assert.equal(new Set(ids).size, ids.length, `${id} без повторов`);
    const names = (list as Array<{ name: string }>).map((x) => x.name);
    assert.equal(new Set(names).size, names.length, `имена (${id}) без повторов`);
  }
  const triggerIds = new Set([GTM_ALL_PAGES, ...V.trigger.map((t) => t.triggerId)]);
  const folderIds = new Set(V.folder.map((f) => f.folderId));
  const tagNames = new Set(V.tag.map((t) => t.name));
  const known = new Set(["_event", ...V.variable.map((v) => v.name), ...V.builtInVariable.map((b) => b.name)]);
  for (const t of V.tag) {
    assert.ok(t.firingTriggerId.length, `${t.name}: есть триггер`);
    for (const id of [...t.firingTriggerId, ...(t.blockingTriggerId ?? [])]) assert.ok(triggerIds.has(id), `${t.name}: триггер ${id}`);
    for (const s of t.setupTag ?? []) assert.ok(tagNames.has(s.tagName), `${t.name}: подготовка ${s.tagName}`);
  }
  for (const x of [...V.tag, ...V.trigger, ...V.variable]) {
    assert.ok(x.parentFolderId && folderIds.has(x.parentFolderId), `${x.name}: папка`);
    for (const r of strings(x)) for (const name of refsIn(r)) assert.ok(known.has(name), `${x.name}: переменная {{${name}}} есть`);
  }
  for (const name of Object.values(GTM_VAR)) assert.ok(known.has(name), `переменная ${name} создана`);
  // ID кабинетов в контейнер не вписаны — только ссылки на dataLayer
  const all = JSON.stringify(C);
  assert.doesNotMatch(all, /G-[A-Z0-9]{6,}|AW-\d{6,}/, "в контейнере нет чужих/тестовых ID");
});

test("на каждое событие сайта — триггер и тег GA4 с тем же именем; e-commerce — из dataLayer; у всех channel", () => {
  for (const ev of ANALYTICS_EVENTS) {
    const tag = V.tag.find((t) => t.type === "gaawe" && param(t, "eventName") === ev);
    assert.ok(tag, `GA4 — ${ev}`);
    const ecommerce = ["view_item", "view_item_list", "select_item", "add_to_cart", "remove_from_cart", "begin_checkout", "purchase", "add_to_wishlist"].includes(ev);
    assert.equal(param(tag!, "sendEcommerceData"), String(ecommerce), `${ev}: e-commerce`);
    assert.equal(param(tag!, "measurementIdOverride"), `{{${GTM_VAR.ga4Id}}}`);
    const settings = tag!.parameter.find((p) => p.key === "eventSettingsTable")!.list!.map((m) => m.map![0].value);
    assert.ok(settings.includes("channel"), `${ev}: channel`);
  }
  const mapped = new Set(PIXEL_EVENTS.flatMap((p) => p.site));
  for (const ev of ["view_item", "add_to_cart", "begin_checkout", "purchase", "search", "add_to_wishlist", "phone_click", "telegram_click"]) {
    assert.ok(mapped.has(ev as never), `${ev} → Meta/TikTok`);
  }
});

test("код тегов и переменных — ES5 и без синтаксических ошибок", () => {
  for (const t of V.tag.filter((x) => x.type === "html")) {
    const code = scriptBody(param(t, "html")!);
    assertEs5(code, t.name);
    assert.doesNotThrow(() => new vm.Script(withRefs(code)), `${t.name}: компилируется`);
  }
  for (const v of V.variable.filter((x) => x.type === "jsm")) {
    const code = param(v as unknown as GtmTag, "javascript")!;
    assertEs5(code, v.name);
    assert.doesNotThrow(() => new vm.Script(`(${withRefs(code)})`), `${v.name}: компилируется`);
  }
});

// ---------- симулятор GTM ----------

function param(t: { parameter: GtmParam[] }, key: string): string | undefined {
  return t.parameter.find((p) => p.key === key)?.value;
}
const scriptBody = (html: string) => html.replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");
const withRefs = (code: string) => code.replace(/\{\{([^}]+)\}\}/g, (_, n: string) => `__v(${JSON.stringify(n)})`);
function assertEs5(code: string, where: string) {
  assert.doesNotMatch(code, /=>|`|\b(let|const|class)\s/, `${where}: ES5`);
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const plain = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

type Fired = { name: string; type: string; params: Record<string, unknown> };

class Gtm {
  model: Record<string, unknown> = {};
  event = "";
  fired: Fired[] = [];
  firedOnce = new Set<string>();
  scripts: string[] = [];
  ctx: vm.Context;
  constructor(readonly c: GtmContainerExport) {
    const ctx: Record<string, unknown> = {};
    const scriptsLoaded = this.scripts;
    ctx.window = ctx;
    ctx.document = {
      createElement: () => ({}),
      getElementsByTagName: () => [{ parentNode: { insertBefore: (n: { src?: string }) => scriptsLoaded.push(String(n.src)) } }],
    };
    ctx.__v = (n: string) => this.value(n);
    this.ctx = vm.createContext(ctx);
  }
  get win() {
    return this.ctx as unknown as { fbq?: { queue: ArrayLike<unknown>[] }; ttq?: unknown[][] & { _i?: Record<string, unknown> } };
  }
  private merge(into: Record<string, unknown>, from: Record<string, unknown>) {
    for (const [k, v] of Object.entries(from)) {
      if (isObj(v) && isObj(into[k])) this.merge(into[k] as Record<string, unknown>, v);
      else into[k] = isObj(v) ? plain(v) : v;
    }
  }
  value(name: string): unknown {
    if (name === "_event" || name === "Event") return this.event;
    if (name === "History Source") return this.model["gtm.historyChangeSource"];
    const v = this.c.containerVersion.variable.find((x) => x.name === name);
    if (!v) throw new Error(`нет переменной ${name}`);
    if (v.type === "v") {
      const path = param(v as unknown as GtmTag, "name")!;
      const got = path.split(".").reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), this.model);
      return got === undefined && param(v as unknown as GtmTag, "setDefaultValue") === "true" ? param(v as unknown as GtmTag, "defaultValue") : got;
    }
    if (v.type === "jsm") return vm.runInContext(`(${withRefs(param(v as unknown as GtmTag, "javascript")!)})()`, this.ctx);
    throw new Error(`тип переменной ${v.type}`);
  }
  private text(s: string): unknown {
    const whole = /^\{\{([^}]+)\}\}$/.exec(s);
    if (whole) return this.value(whole[1]);
    return s.replace(/\{\{([^}]+)\}\}/g, (_, n: string) => String(this.value(n)));
  }
  private test(c: GtmCondition): boolean {
    const arg0 = String(this.text(c.parameter.find((p) => p.key === "arg0")!.value!));
    const arg1 = c.parameter.find((p) => p.key === "arg1")!.value!;
    const negate = c.parameter.some((p) => p.key === "negate" && p.value === "true");
    const ok = c.type === "EQUALS" ? arg0 === arg1 : c.type === "MATCH_REGEX" ? new RegExp(arg1).test(arg0) : arg0.includes(arg1);
    return negate ? !ok : ok;
  }
  private matches(triggerId: string): boolean {
    if (triggerId === GTM_ALL_PAGES) return this.event === "gtm.js";
    const t = this.c.containerVersion.trigger.find((x) => x.triggerId === triggerId)!;
    if (t.type === "HISTORY_CHANGE" && this.event !== "gtm.historyChange-v2") return false;
    if (t.type === "CUSTOM_EVENT" && !(t.customEventFilter ?? []).every((c) => this.test(c))) return false;
    return (t.filter ?? []).every((c) => this.test(c));
  }
  private params(list: GtmParam[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const p of list) {
      if (p.type === "LIST") out[p.key!] = Object.fromEntries(p.list!.map((m) => [m.map![0].value, this.text(m.map![1].value!)]));
      else if (p.key !== "html") out[p.key!] = plain(this.text(p.value!));
    }
    return out;
  }
  private fire(t: GtmTag) {
    if (t.tagFiringOption === "ONCE_PER_LOAD" && this.firedOnce.has(t.name)) return;
    for (const s of t.setupTag ?? []) this.fire(this.c.containerVersion.tag.find((x) => x.name === s.tagName)!);
    this.firedOnce.add(t.name);
    if (t.type === "html") vm.runInContext(withRefs(scriptBody(param(t, "html")!)), this.ctx);
    this.fired.push({ name: t.name, type: t.type, params: this.params(t.parameter) });
  }
  push(entry: Record<string, unknown>) {
    this.merge(this.model, entry);
    if (typeof entry.event !== "string") return;
    this.event = entry.event;
    const before = this.fired.length;
    for (const t of this.c.containerVersion.tag) {
      if (!t.firingTriggerId.some((id) => this.matches(id))) continue;
      if ((t.blockingTriggerId ?? []).some((id) => this.matches(id))) continue;
      this.fire(t);
    }
    return this.fired.slice(before);
  }
  /** как track() на сайте: перед e-commerce событием — { ecommerce: null } */
  track(event: string, data: Record<string, unknown> = {}) {
    if (data.ecommerce) this.push({ ecommerce: null });
    return this.push({ event, channel: "web", ...data })!;
  }
  meta() {
    return plain(Array.from(this.win.fbq?.queue ?? [], (a) => Array.from(a)));
  }
  tiktok() {
    return plain(Array.from(this.win.ttq ?? []));
  }
}

const IDS: AnalyticsIds = {
  gtmId: "GTM-ABC1234", ga4Id: "G-TEST123456", adsConversionId: "AW-123456789", adsPurchaseLabel: "AbC-dEf_123",
  metaPixelId: "1234567890123456", tiktokPixelId: "C1ABCDEF2GHIJ3KLMN4O",
};

/** Загрузка страницы, как ранний скрипт сайта: hm_config → gtm.js. */
function open(ids: AnalyticsIds) {
  const g = new Gtm(C);
  g.push(analyticsConfigPush(ids, "web") as Record<string, unknown>);
  const fired = g.push({ "gtm.start": 1, event: "gtm.js" })!;
  return { g, fired };
}
const names = (f: Fired[]) => f.map((x) => x.name).sort();
const drill = analyticsItem({ sku: "4933479862", name: "Дриль-шуруповерт Milwaukee M18", brand: "Milwaukee", categories: ["Електроінструмент", "Дрилі"], price: 4999, qty: 1 });

test("симулятор: открытие сайта со всеми ID — GA4, Conversion Linker, ремаркетинг, пиксели Meta и TikTok (PageView)", () => {
  const { g, fired } = open(IDS);
  assert.deepEqual(names(fired), [
    "GA4 — тег Google", "Google Ads — Conversion Linker", "Google Ads — ремаркетинг", "Meta — пиксель (основной код)", "TikTok — пиксель (основной код)",
  ]);
  assert.equal(fired.find((f) => f.type === "googtag")!.params.tagId, "G-TEST123456");
  assert.equal(fired.find((f) => f.type === "sp")!.params.conversionId, "123456789", "Google Ads — без AW-");
  assert.deepEqual(g.meta(), [["init", "1234567890123456"], ["track", "PageView"]]);
  assert.deepEqual(g.tiktok(), [["page"]]);
  assert.ok(g.win.ttq!._i!["C1ABCDEF2GHIJ3KLMN4O"], "TikTok загружен с нашим ID");
  assert.ok(g.scripts.some((s) => s.startsWith("https://connect.facebook.net/")) && g.scripts.some((s) => s.includes("analytics.tiktok.com") && s.includes("sdkid=C1ABCDEF2GHIJ3KLMN4O")));
});

test("симулятор: в корзину → GA4 add_to_cart, Meta AddToCart, TikTok AddToCart с артикулом, суммой и UAH", () => {
  const { g } = open(IDS);
  const item = { ...drill, quantity: 2 };
  const fired = g.track("add_to_cart", { ecommerce: ecommerceOf([item]) });
  assert.deepEqual(names(fired), ["GA4 — add_to_cart", "Meta — AddToCart", "TikTok — AddToCart"]);
  const ga = fired.find((f) => f.type === "gaawe")!;
  assert.equal(ga.params.eventName, "add_to_cart");
  assert.deepEqual(ga.params.eventSettingsTable, { channel: "web" });
  assert.deepEqual(g.meta().at(-1), ["track", "AddToCart", {
    content_type: "product", content_ids: ["4933479862"], contents: [{ id: "4933479862", quantity: 2, item_price: 4999 }], value: 9998, currency: "UAH",
  }]);
  assert.deepEqual(g.tiktok().at(-1), ["track", "AddToCart", {
    content_type: "product", contents: [{ content_id: "4933479862", content_type: "product", content_name: "Дриль-шуруповерт Milwaukee M18", quantity: 2, price: 4999 }],
    value: 9998, currency: "UAH",
  }]);
  // основной код пикселя второй раз не запускается (once per load)
  assert.equal(g.meta().filter((c) => c[0] === "init").length, 1);
});

test("симулятор: покупка → Google Ads конверсия (сумма, номер заказа), Meta Purchase и TikTok CompletePayment с номером заказа, GA4 purchase", () => {
  const { g } = open(IDS);
  const e = purchaseEvent("HM-1001", [{ sku: "4933479862", name: "Дриль", qty: 1, unitPrice: 4749.05, brand: "Milwaukee" }, { sku: "A1", name: "Біта", qty: 3, unitPrice: 12.5 }]);
  const fired = g.track("purchase", { event_id: e.event_id, ecommerce: e.ecommerce });
  assert.deepEqual(names(fired), ["GA4 — purchase", "Google Ads — конверсия «Покупка»", "Meta — Purchase", "TikTok — CompletePayment"]);
  const ads = fired.find((f) => f.type === "awct")!.params;
  assert.equal(ads.conversionId, "123456789");
  assert.equal(ads.conversionLabel, "AbC-dEf_123");
  assert.equal(ads.conversionValue, 4786.55);
  assert.equal(ads.currencyCode, "UAH");
  assert.equal(ads.orderId, "HM-1001");
  const meta = g.meta().at(-1)!;
  assert.equal(meta[1], "Purchase");
  assert.equal((meta[2] as { value: number }).value, 4786.55);
  assert.deepEqual((meta[2] as { content_ids: string[] }).content_ids, ["4933479862", "A1"]);
  assert.deepEqual(meta[3], { eventID: "HM-1001" });
  const tt = g.tiktok().at(-1)!;
  assert.equal(tt[1], "CompletePayment");
  assert.deepEqual(tt[3], { event_id: "HM-1001" });
});

test("симулятор: просмотр товара, оформление, поиск, «Обране», звонок и Telegram", () => {
  const { g } = open(IDS);
  g.track("view_item", { ecommerce: ecommerceOf([drill]) });
  assert.deepEqual(g.meta().at(-1), ["track", "ViewContent", {
    content_type: "product", content_ids: ["4933479862"], contents: [{ id: "4933479862", quantity: 1, item_price: 4999 }], content_name: "Дриль-шуруповерт Milwaukee M18",
    value: 4999, currency: "UAH",
  }]);
  assert.equal(g.tiktok().at(-1)![1], "ViewContent");

  g.track("begin_checkout", { ecommerce: ecommerceOf([{ ...drill, quantity: 2 }, analyticsItem({ sku: "A1", name: "Біта", price: 10, qty: 3 })]) });
  const ic = g.meta().at(-1)!;
  assert.equal(ic[1], "InitiateCheckout");
  assert.equal((ic[2] as { num_items: number }).num_items, 5);
  assert.equal((ic[2] as { value: number }).value, 10028);

  const s = g.track("search", { search_term: "болгарка" });
  assert.deepEqual(names(s), ["GA4 — search", "Meta — Search", "TikTok — Search"]);
  assert.deepEqual(s.find((f) => f.type === "gaawe")!.params.eventSettingsTable, { channel: "web", search_term: "болгарка" });
  assert.deepEqual(g.meta().at(-1), ["track", "Search", { search_string: "болгарка" }]);
  assert.deepEqual(g.tiktok().at(-1), ["track", "Search", { query: "болгарка" }]);

  g.track("add_to_wishlist", { ecommerce: ecommerceOf([drill]) });
  assert.equal(g.meta().at(-1)![1], "AddToWishlist");
  assert.equal(g.tiktok().at(-1)![1], "AddToWishlist");

  const phone = g.track("phone_click", { click_location: "header", page_type: "product" });
  assert.deepEqual(names(phone), ["GA4 — phone_click", "Meta — Contact", "TikTok — Contact"]);
  assert.deepEqual(phone.find((f) => f.type === "gaawe")!.params.eventSettingsTable, { channel: "web", click_location: "header", page_type: "product" });
  assert.deepEqual(g.meta().at(-1), ["track", "Contact"]);
  const tg = g.track("telegram_click", { messenger: "viber", click_location: "footer", page_type: "home" });
  assert.deepEqual(names(tg), ["GA4 — telegram_click", "Meta — Contact", "TikTok — Contact"]);
  assert.equal((tg.find((f) => f.type === "gaawe")!.params.eventSettingsTable as Record<string, string>).messenger, "viber");

  // списки и удаление из корзины — только GA4 (у пикселей нет такого стандартного события)
  assert.deepEqual(names(g.track("view_item_list", { ecommerce: { item_list_id: "search", item_list_name: "Пошук", items: [drill] } })), ["GA4 — view_item_list"]);
  assert.deepEqual(names(g.track("remove_from_cart", { ecommerce: ecommerceOf([drill]) })), ["GA4 — remove_from_cart"]);
});

test("симулятор: переход по сайту без перезагрузки (pushState/«назад») — просмотр страницы в Meta и TikTok; смена фильтров (replaceState) — нет", () => {
  const { g } = open(IDS);
  const nav = g.push({ event: "gtm.historyChange-v2", "gtm.historyChangeSource": "pushState" })!;
  assert.deepEqual(names(nav), ["Google Ads — ремаркетинг", "Meta — PageView (переход по сайту)", "TikTok — page (переход по сайту)"]);
  assert.deepEqual(g.meta().at(-1), ["track", "PageView"]);
  assert.deepEqual(g.tiktok().at(-1), ["page"]);
  assert.equal(names(g.push({ event: "gtm.historyChange-v2", "gtm.historyChangeSource": "popstate" })!).length, 3);
  assert.deepEqual(g.push({ event: "gtm.historyChange-v2", "gtm.historyChangeSource": "replaceState" }), []);
});

test("симулятор: вписан только GTM и GA4 — пиксели и Google Ads молчат; без ID GA4 — молчит и GA4", () => {
  const only = { ...IDS, adsConversionId: "", adsPurchaseLabel: "", metaPixelId: "", tiktokPixelId: "" };
  const { g, fired } = open(only);
  assert.deepEqual(names(fired), ["GA4 — тег Google"]);
  const e = purchaseEvent("HM-1002", [{ sku: "A1", name: "Біта", qty: 1, unitPrice: 10 }]);
  assert.deepEqual(names(g.track("purchase", { event_id: e.event_id, ecommerce: e.ecommerce })), ["GA4 — purchase"]);
  assert.deepEqual(names(g.track("phone_click", { click_location: "page", page_type: "home" })), ["GA4 — phone_click"]);
  assert.equal(g.win.fbq, undefined);
  assert.equal(g.win.ttq, undefined);
  assert.deepEqual(g.scripts, []);

  // Google Ads без метки покупки: ремаркетинг есть, конверсии нет
  const noLabel = open({ ...only, adsConversionId: "AW-123456789" });
  assert.deepEqual(names(noLabel.g.track("purchase", { event_id: e.event_id, ecommerce: e.ecommerce })), ["GA4 — purchase"]);

  // мусор вместо ID — как «не вписан»
  const junk = open({ ...IDS, ga4Id: "", metaPixelId: "abc", tiktokPixelId: "" });
  assert.deepEqual(names(junk.fired), ["Google Ads — Conversion Linker", "Google Ads — ремаркетинг"]);
});

test("симулятор: товары одного события не переходят в следующее ({ ecommerce: null } перед каждым)", () => {
  const { g } = open(IDS);
  g.track("add_to_cart", { ecommerce: ecommerceOf([drill, analyticsItem({ sku: "A1", name: "Біта", price: 10 })]) });
  g.track("view_item", { ecommerce: ecommerceOf([analyticsItem({ sku: "B2", name: "Пила", price: 100 })]) });
  assert.deepEqual((g.meta().at(-1)![2] as { content_ids: string[] }).content_ids, ["B2"]);
});
