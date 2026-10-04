// Аналитика (шаг А2): готовый контейнер Google Tag Manager — файл `deploy/gtm-container.json` (владелец импортирует его в свой GTM:
// «Админ → Импортировать контейнер») и кнопка «Скачать контейнер» в «Интеграции → Аналитика и реклама».
// Контейнер собирается здесь из списка событий сайта (`ANALYTICS_EVENTS`), чтобы файл и события не разошлись; тест сверяет файл с этим кодом
// и прогоняет события через теги (`packages/core/test/gtm-container.test.ts`). Пересобрать файл: `pnpm gtm:container`.
//
// Устройство:
// - ID кабинетов в контейнер НЕ вписываются: сайт кладёт их в `dataLayer` до загрузки GTM (событие `hm_config`, шаг А1), теги берут их оттуда
//   («Интеграции → Аналитика и реклама»). Пустой ID — теги этого кабинета не срабатывают (триггеры-исключения «Блок — нет …»).
// - GA4: тег Google (просмотры страниц, в том числе переходы без перезагрузки — «Расширенная статистика» потока GA4) + тег события на каждое
//   событие сайта (e-commerce — из `dataLayer`).
// - Google Ads: конверсия «Покупка» (сумма, валюта, номер заказа), ремаркетинг, Conversion Linker.
// - Meta Pixel и TikTok Pixel — тегами «Пользовательский HTML» с официальным кодом пикселя (решение шага А2): шаблоны из галереи GTM нельзя
//   положить в файл без копии чужого кода шаблона, а свой HTML виден целиком, проверяется тестом и не зависит от обновлений галереи.
//   Покупка — с `eventID`/`event_id` = номер заказа (HM-…): так кабинеты склеят её с покупкой с сервера (шаг А3).
// - Код в тегах и переменных — ES5 (var, function): так его принимает любой режим GTM.
import { ANALYTICS_EVENTS, ECOMMERCE_EVENTS, type AnalyticsEvent } from "./shop/analytics";

/** Версия контейнера (дата сборки файла). Меняется, когда меняются теги, — владелец видит в GTM, что файл новый. */
export const GTM_CONTAINER_VERSION = "2026-10-04";

export type GtmParam = { type: "TEMPLATE" | "BOOLEAN" | "INTEGER" | "LIST" | "MAP"; key?: string; value?: string; list?: GtmParam[]; map?: GtmParam[] };
export type GtmCondition = { type: "EQUALS" | "MATCH_REGEX" | "CONTAINS"; parameter: GtmParam[] };

type Base = { accountId: "0"; containerId: "0"; fingerprint: "0"; parentFolderId?: string; notes?: string };
export type GtmVariable = Base & { variableId: string; name: string; type: string; parameter: GtmParam[]; formatValue: Record<string, never> };
export type GtmTrigger = Base & {
  triggerId: string;
  name: string;
  type: "CUSTOM_EVENT" | "HISTORY_CHANGE";
  customEventFilter?: GtmCondition[];
  filter?: GtmCondition[];
};
export type GtmTag = Base & {
  tagId: string;
  name: string;
  type: string;
  parameter: GtmParam[];
  firingTriggerId: string[];
  blockingTriggerId?: string[];
  setupTag?: Array<{ tagName: string; stopOnSetupFailure: boolean }>;
  tagFiringOption: "ONCE_PER_EVENT" | "ONCE_PER_LOAD";
  monitoringMetadata: { type: "MAP" };
  consentSettings: { consentStatus: "NOT_SET" };
};
export type GtmFolder = { accountId: "0"; containerId: "0"; folderId: string; name: string; fingerprint: "0" };
export type GtmBuiltIn = { accountId: "0"; containerId: "0"; type: string; name: string };

export type GtmContainerExport = {
  exportFormatVersion: 2;
  exportTime: string;
  containerVersion: {
    path: string;
    accountId: "0";
    containerId: "0";
    containerVersionId: "0";
    name: string;
    description: string;
    container: { path: string; accountId: "0"; containerId: "0"; name: string; publicId: string; usageContext: ["WEB"]; fingerprint: "0" };
    tag: GtmTag[];
    trigger: GtmTrigger[];
    variable: GtmVariable[];
    folder: GtmFolder[];
    builtInVariable: GtmBuiltIn[];
    fingerprint: "0";
  };
};

/** Встроенный триггер GTM «All Pages» (все страницы: событие gtm.js). */
export const GTM_ALL_PAGES = "2147479553";

/** Ключи `dataLayer`, которые кладёт сайт (`analyticsConfigPush`, `track`). */
export const GTM_DL = {
  ga4Id: "hm_ga4_id",
  adsId: "hm_ads_id",
  adsLabel: "hm_ads_purchase_label",
  metaId: "hm_meta_pixel_id",
  tiktokId: "hm_tiktok_pixel_id",
} as const;

/** Имена переменных в контейнере (на них ссылаются теги как `{{…}}`). */
export const GTM_VAR = {
  ga4Id: "DL - GA4 ID",
  adsId: "DL - Google Ads ID",
  adsLabel: "DL - Google Ads метка покупки",
  metaId: "DL - Meta Pixel ID",
  tiktokId: "DL - TikTok Pixel ID",
  channel: "DL - channel",
  eventId: "DL - event_id",
  value: "DL - ecommerce.value",
  currency: "DL - ecommerce.currency",
  transactionId: "DL - ecommerce.transaction_id",
  items: "DL - ecommerce.items",
  searchTerm: "DL - search_term",
  messenger: "DL - messenger",
  clickLocation: "DL - click_location",
  pageType: "DL - page_type",
  adsDigits: "JS - Google Ads ID без AW-",
  skus: "JS - артикулы товаров",
  metaContents: "JS - Meta contents",
  tiktokContents: "JS - TikTok contents",
  numItems: "JS - штук всего",
  firstName: "JS - название первого товара",
} as const;

/** Параметры GA4-событий кроме e-commerce (они — в «Настройках событий» тега). `channel` — у всех: web или miniapp. */
export const GA4_EVENT_PARAMS: Record<AnalyticsEvent, string[]> = {
  view_item: [],
  view_item_list: [],
  select_item: [],
  add_to_cart: [],
  remove_from_cart: [],
  begin_checkout: [],
  purchase: [],
  add_to_wishlist: [],
  search: ["search_term"],
  phone_click: ["click_location", "page_type"],
  telegram_click: ["messenger", "click_location", "page_type"],
};

/** Какое событие сайта → какое стандартное событие Meta / TikTok (звонок и мессенджеры — «Contact»). */
export const PIXEL_EVENTS: Array<{ site: AnalyticsEvent[]; meta: string; tiktok: string }> = [
  { site: ["view_item"], meta: "ViewContent", tiktok: "ViewContent" },
  { site: ["add_to_cart"], meta: "AddToCart", tiktok: "AddToCart" },
  { site: ["begin_checkout"], meta: "InitiateCheckout", tiktok: "InitiateCheckout" },
  { site: ["purchase"], meta: "Purchase", tiktok: "CompletePayment" },
  { site: ["search"], meta: "Search", tiktok: "Search" },
  { site: ["add_to_wishlist"], meta: "AddToWishlist", tiktok: "AddToWishlist" },
  { site: ["phone_click", "telegram_click"], meta: "Contact", tiktok: "Contact" },
];

/** Форматы ID для триггеров-исключений (как `analyticsIdError` в админке). */
const ID_FORMAT = {
  ga4: "^G-[A-Z0-9]+$",
  ads: "^AW-[0-9]+$",
  adsLabel: "^[A-Za-z0-9_-]+$",
  meta: "^[0-9]+$",
  tiktok: "^[A-Z0-9]+$",
};

// ---------- кирпичики формата GTM ----------

const tpl = (key: string, value: string): GtmParam => ({ type: "TEMPLATE", key, value });
const bool = (key: string, v: boolean): GtmParam => ({ type: "BOOLEAN", key, value: String(v) });
const int = (key: string, v: number): GtmParam => ({ type: "INTEGER", key, value: String(v) });
const table = (key: string, rows: Array<[string, string]>): GtmParam => ({
  type: "LIST",
  key,
  list: rows.map(([k, v]) => ({ type: "MAP", map: [tpl("parameter", k), tpl("parameterValue", v)] })),
});
const ref = (name: string) => `{{${name}}}`;
const cond = (type: GtmCondition["type"], arg0: string, arg1: string, negate = false): GtmCondition => ({
  type,
  parameter: [tpl("arg0", arg0), tpl("arg1", arg1), ...(negate ? [bool("negate", true)] : [])],
});
const B = { accountId: "0", containerId: "0", fingerprint: "0" } as const;

/** Код переменной «Собственный код JavaScript» (ES5). */
const JS: Record<"adsDigits" | "skus" | "metaContents" | "tiktokContents" | "numItems" | "firstName", string> = {
  adsDigits: `function() {
  var v = ${ref(GTM_VAR.adsId)};
  return v ? String(v).replace(/^AW-/i, '') : undefined;
}`,
  skus: `function() {
  var it = ${ref(GTM_VAR.items)};
  if (!it || !it.length) return undefined;
  var r = [];
  for (var i = 0; i < it.length; i++) if (it[i] && it[i].item_id) r.push(String(it[i].item_id));
  return r;
}`,
  metaContents: `function() {
  var it = ${ref(GTM_VAR.items)};
  if (!it || !it.length) return undefined;
  var r = [];
  for (var i = 0; i < it.length; i++) {
    if (!it[i] || !it[i].item_id) continue;
    r.push({ id: String(it[i].item_id), quantity: Number(it[i].quantity) || 1, item_price: Number(it[i].price) || 0 });
  }
  return r;
}`,
  tiktokContents: `function() {
  var it = ${ref(GTM_VAR.items)};
  if (!it || !it.length) return undefined;
  var r = [];
  for (var i = 0; i < it.length; i++) {
    if (!it[i] || !it[i].item_id) continue;
    r.push({ content_id: String(it[i].item_id), content_type: 'product', content_name: it[i].item_name, quantity: Number(it[i].quantity) || 1, price: Number(it[i].price) || 0 });
  }
  return r;
}`,
  numItems: `function() {
  var it = ${ref(GTM_VAR.items)};
  if (!it || !it.length) return undefined;
  var n = 0;
  for (var i = 0; i < it.length; i++) n += Number(it[i] && it[i].quantity) || 1;
  return n;
}`,
  firstName: `function() {
  var it = ${ref(GTM_VAR.items)};
  return it && it[0] && it[0].item_name ? String(it[0].item_name) : undefined;
}`,
};

const script = (body: string) => `<script>\n(function() {\n${body}\n})();\n</script>`;

/** Официальный код пикселя Meta (fbevents.js); ID — из `dataLayer`. */
const META_BASE = script(`  var id = ${ref(GTM_VAR.metaId)};
  if (!id) return;
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', String(id));
  window.fbq('track', 'PageView');`);

/** Официальный код пикселя TikTok (events.js); ID — из `dataLayer`. */
const TIKTOK_BASE = script(`  var id = ${ref(GTM_VAR.tiktokId)};
  if (!id) return;
  !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=d.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=d.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load(String(id));ttq.page()}(window,document,'ttq');`);

const META_READY = "  if (typeof window.fbq !== 'function') return;";
const TIKTOK_READY = "  if (!window.ttq || typeof window.ttq.track !== 'function') return;";

/** Данные события для Meta (как в справке Meta: content_ids, contents, value, currency…). */
function metaParams(meta: string): string | null {
  const money = `value: ${ref(GTM_VAR.value)}, currency: ${ref(GTM_VAR.currency)}`;
  const goods = `content_type: 'product', content_ids: ${ref(GTM_VAR.skus)}, contents: ${ref(GTM_VAR.metaContents)}`;
  switch (meta) {
    case "ViewContent":
      return `{ ${goods}, content_name: ${ref(GTM_VAR.firstName)}, ${money} }`;
    case "AddToCart":
    case "AddToWishlist":
    case "Purchase":
      return `{ ${goods}, ${money} }`;
    case "InitiateCheckout":
      return `{ ${goods}, num_items: ${ref(GTM_VAR.numItems)}, ${money} }`;
    case "Search":
      return `{ search_string: ${ref(GTM_VAR.searchTerm)} }`;
  }
  return null;
}

/** Данные события для TikTok (contents с content_id, value, currency; поиск — query). */
function tiktokParams(tiktok: string): string | null {
  switch (tiktok) {
    case "ViewContent":
    case "AddToCart":
    case "InitiateCheckout":
    case "CompletePayment":
    case "AddToWishlist":
      return `{ content_type: 'product', contents: ${ref(GTM_VAR.tiktokContents)}, value: ${ref(GTM_VAR.value)}, currency: ${ref(GTM_VAR.currency)} }`;
    case "Search":
      return `{ query: ${ref(GTM_VAR.searchTerm)} }`;
  }
  return null;
}

// ---------- сборка ----------

export function buildGtmContainer(): GtmContainerExport {
  const folders: GtmFolder[] = [];
  const folder = (name: string) => {
    const f: GtmFolder = { ...B, folderId: String(folders.length + 1), name };
    folders.push(f);
    return f.folderId;
  };
  const F = {
    vars: folder("Handyman — переменные и триггеры"),
    ga4: folder("GA4"),
    ads: folder("Google Ads"),
    meta: folder("Meta Pixel"),
    tiktok: folder("TikTok Pixel"),
  };

  // переменные
  const variables: GtmVariable[] = [];
  // ID кабинетов — с пустым значением по умолчанию: иначе невписанный ID в условии триггера — строка «undefined» (и она подходит под формат метки)
  const dlv = (name: string, key: string, notes: string, emptyDefault = false) =>
    variables.push({
      ...B, variableId: String(variables.length + 1), name, type: "v", parentFolderId: F.vars, notes, formatValue: {},
      parameter: [
        int("dataLayerVersion", 2),
        bool("setDefaultValue", emptyDefault),
        ...(emptyDefault ? [tpl("defaultValue", "")] : []),
        tpl("name", key),
      ],
    });
  const jsm = (name: string, code: string, notes: string) =>
    variables.push({ ...B, variableId: String(variables.length + 1), name, type: "jsm", parentFolderId: F.vars, notes, formatValue: {}, parameter: [tpl("javascript", code)] });

  const fromAdmin = "Берётся из «Интеграции → Аналитика и реклама» на сайте (событие hm_config). Здесь не менять.";
  dlv(GTM_VAR.ga4Id, GTM_DL.ga4Id, `ID потока GA4 (G-…). ${fromAdmin}`, true);
  dlv(GTM_VAR.adsId, GTM_DL.adsId, `Идентификатор конверсии Google Ads (AW-…). ${fromAdmin}`, true);
  dlv(GTM_VAR.adsLabel, GTM_DL.adsLabel, `Метка конверсии «Покупка» Google Ads. ${fromAdmin}`, true);
  dlv(GTM_VAR.metaId, GTM_DL.metaId, `ID пикселя Meta. ${fromAdmin}`, true);
  dlv(GTM_VAR.tiktokId, GTM_DL.tiktokId, `ID пикселя TikTok. ${fromAdmin}`, true);
  dlv(GTM_VAR.channel, "channel", "web — обычный сайт, miniapp — внутри Telegram Mini App.");
  dlv(GTM_VAR.eventId, "event_id", "Номер заказа (HM-…) у покупки: по нему кабинеты не считают покупку дважды (браузер + сервер).");
  dlv(GTM_VAR.value, "ecommerce.value", "Сумма товаров события, грн (считает сервер сайта).");
  dlv(GTM_VAR.currency, "ecommerce.currency", "Валюта (UAH).");
  dlv(GTM_VAR.transactionId, "ecommerce.transaction_id", "Номер заказа (HM-…).");
  dlv(GTM_VAR.items, "ecommerce.items", "Товары события (item_id = артикул).");
  dlv(GTM_VAR.searchTerm, "search_term", "Что искали.");
  dlv(GTM_VAR.messenger, "messenger", "telegram или viber.");
  dlv(GTM_VAR.clickLocation, "click_location", "Где нажали: header, footer, bottom_nav, page.");
  dlv(GTM_VAR.pageType, "page_type", "Тип страницы: home, catalog, product, search, cart, checkout, thanks, info…");
  jsm(GTM_VAR.adsDigits, JS.adsDigits, "Тегам Google Ads нужен идентификатор без «AW-».");
  jsm(GTM_VAR.skus, JS.skus, "Артикулы товаров события — для Meta (content_ids).");
  jsm(GTM_VAR.metaContents, JS.metaContents, "Товары для Meta: id, quantity, item_price.");
  jsm(GTM_VAR.tiktokContents, JS.tiktokContents, "Товары для TikTok: content_id, content_name, quantity, price.");
  jsm(GTM_VAR.numItems, JS.numItems, "Сколько штук в корзине — для Meta InitiateCheckout.");
  jsm(GTM_VAR.firstName, JS.firstName, "Название товара — для Meta ViewContent.");

  // триггеры
  const triggers: GtmTrigger[] = [];
  const trigger = (t: Omit<GtmTrigger, keyof typeof B | "triggerId" | "parentFolderId">) => {
    const id = String(triggers.length + 1);
    triggers.push({ ...B, triggerId: id, parentFolderId: F.vars, ...t });
    return id;
  };
  const onEvent = new Map<string, string>();
  for (const ev of ANALYTICS_EVENTS) {
    onEvent.set(ev, trigger({ name: `Событие — ${ev}`, type: "CUSTOM_EVENT", customEventFilter: [cond("EQUALS", "{{_event}}", ev)] }));
  }
  const contactTrigger = trigger({
    name: "Событие — звонок или мессенджер",
    type: "CUSTOM_EVENT",
    customEventFilter: [cond("MATCH_REGEX", "{{_event}}", "^(phone_click|telegram_click)$")],
    notes: "phone_click (tel:) и telegram_click (Telegram, Viber) — для «Contact» в Meta и TikTok.",
  });
  const historyTrigger = trigger({
    name: "Переход по сайту без перезагрузки",
    type: "HISTORY_CHANGE",
    filter: [cond("MATCH_REGEX", "{{History Source}}", "^(pushState|popstate)$")],
    notes: "Сайт открывает страницы без перезагрузки (Next.js) — просмотр страницы для Meta, TikTok и ремаркетинга. replaceState (смена фильтров) не считается.",
  });
  const blocker = (name: string, variable: string, format: string) =>
    trigger({
      name,
      type: "CUSTOM_EVENT",
      customEventFilter: [cond("MATCH_REGEX", "{{_event}}", ".*")],
      filter: [cond("MATCH_REGEX", ref(variable), format, true)],
      notes: "Исключение: ID не вписан в «Интеграции → Аналитика и реклама» — теги этого кабинета не срабатывают.",
    });
  const block = {
    ga4: blocker("Блок — нет ID GA4", GTM_VAR.ga4Id, ID_FORMAT.ga4),
    ads: blocker("Блок — нет ID Google Ads", GTM_VAR.adsId, ID_FORMAT.ads),
    adsLabel: blocker("Блок — нет метки покупки Google Ads", GTM_VAR.adsLabel, ID_FORMAT.adsLabel),
    meta: blocker("Блок — нет ID Meta Pixel", GTM_VAR.metaId, ID_FORMAT.meta),
    tiktok: blocker("Блок — нет ID TikTok Pixel", GTM_VAR.tiktokId, ID_FORMAT.tiktok),
  };

  // теги
  const tags: GtmTag[] = [];
  const tag = (t: Pick<GtmTag, "name" | "type" | "parameter" | "firingTriggerId" | "parentFolderId"> & Partial<Pick<GtmTag, "blockingTriggerId" | "setupTag" | "tagFiringOption" | "notes">>) => {
    tags.push({
      ...B, tagId: String(tags.length + 1), tagFiringOption: "ONCE_PER_EVENT", monitoringMetadata: { type: "MAP" }, consentSettings: { consentStatus: "NOT_SET" }, ...t,
    });
  };
  const html = (code: string) => [tpl("html", code), bool("supportDocumentWrite", false)];

  // GA4
  tag({
    name: "GA4 — тег Google", type: "googtag", parentFolderId: F.ga4, firingTriggerId: [GTM_ALL_PAGES], blockingTriggerId: [block.ga4],
    parameter: [tpl("tagId", ref(GTM_VAR.ga4Id))],
    notes: "Загружает GA4 и считает просмотры страниц (переходы без перезагрузки — «Расширенная статистика» в потоке GA4).",
  });
  const paramVar: Record<string, string> = {
    search_term: GTM_VAR.searchTerm, messenger: GTM_VAR.messenger, click_location: GTM_VAR.clickLocation, page_type: GTM_VAR.pageType,
  };
  for (const ev of ANALYTICS_EVENTS) {
    const ecommerce = ECOMMERCE_EVENTS.has(ev);
    tag({
      name: `GA4 — ${ev}`, type: "gaawe", parentFolderId: F.ga4, firingTriggerId: [onEvent.get(ev)!], blockingTriggerId: [block.ga4],
      parameter: [
        tpl("eventName", ev),
        tpl("measurementIdOverride", ref(GTM_VAR.ga4Id)),
        bool("sendEcommerceData", ecommerce),
        ...(ecommerce ? [tpl("getEcommerceDataFrom", "dataLayer")] : []),
        table("eventSettingsTable", [["channel", ref(GTM_VAR.channel)], ...GA4_EVENT_PARAMS[ev].map((p): [string, string] => [p, ref(paramVar[p])])]),
      ],
    });
  }

  // Google Ads
  const adsCommon = [bool("enableConversionLinker", true), tpl("conversionCookiePrefix", "_gcl"), bool("rdp", false)];
  tag({
    name: "Google Ads — Conversion Linker", type: "gclidw", parentFolderId: F.ads, firingTriggerId: [GTM_ALL_PAGES], blockingTriggerId: [block.ads],
    parameter: [bool("enableCrossDomain", false), bool("enableUrlPassthrough", false), bool("enableCookieOverrides", false)],
    notes: "Запоминает клик по рекламе Google (gclid), чтобы покупка засчиталась объявлению.",
  });
  tag({
    name: "Google Ads — конверсия «Покупка»", type: "awct", parentFolderId: F.ads, firingTriggerId: [onEvent.get("purchase")!], blockingTriggerId: [block.ads, block.adsLabel],
    parameter: [
      tpl("conversionId", ref(GTM_VAR.adsDigits)),
      tpl("conversionLabel", ref(GTM_VAR.adsLabel)),
      tpl("conversionValue", ref(GTM_VAR.value)),
      tpl("currencyCode", ref(GTM_VAR.currency)),
      tpl("orderId", ref(GTM_VAR.transactionId)),
      ...adsCommon,
    ],
    notes: "Сумма — товары после скидок, без доставки; номер заказа — чтобы Google не посчитал покупку дважды.",
  });
  tag({
    name: "Google Ads — ремаркетинг", type: "sp", parentFolderId: F.ads, firingTriggerId: [GTM_ALL_PAGES, historyTrigger], blockingTriggerId: [block.ads],
    parameter: [tpl("conversionId", ref(GTM_VAR.adsDigits)), tpl("customParamsFormat", "NONE"), ...adsCommon],
    notes: "Списки посетителей для показа рекламы тем, кто уже был на сайте.",
  });

  // Meta Pixel
  const META_BASE_NAME = "Meta — пиксель (основной код)";
  tag({
    name: META_BASE_NAME, type: "html", parentFolderId: F.meta, firingTriggerId: [GTM_ALL_PAGES], blockingTriggerId: [block.meta], tagFiringOption: "ONCE_PER_LOAD",
    parameter: html(META_BASE), notes: "Официальный код пикселя Meta + PageView при открытии сайта.",
  });
  const metaSetup = [{ tagName: META_BASE_NAME, stopOnSetupFailure: true }];
  tag({
    name: "Meta — PageView (переход по сайту)", type: "html", parentFolderId: F.meta, firingTriggerId: [historyTrigger], blockingTriggerId: [block.meta], setupTag: metaSetup,
    parameter: html(script(`${META_READY}\n  window.fbq('track', 'PageView');`)),
  });
  for (const p of PIXEL_EVENTS) {
    const params = metaParams(p.meta);
    const purchase = p.site.includes("purchase");
    const call = `window.fbq('track', '${p.meta}'${params ? `, ${params}` : purchase ? ", {}" : ""}${purchase ? `, { eventID: ${ref(GTM_VAR.eventId)} }` : ""});`;
    tag({
      name: `Meta — ${p.meta}`, type: "html", parentFolderId: F.meta, blockingTriggerId: [block.meta], setupTag: metaSetup,
      firingTriggerId: [p.site.length > 1 ? contactTrigger : onEvent.get(p.site[0])!],
      parameter: html(script(`${META_READY}\n  ${call}`)),
      notes: `Событие сайта: ${p.site.join(", ")}.${purchase ? " eventID = номер заказа (склейка с покупкой с сервера)." : ""}`,
    });
  }

  // TikTok Pixel
  const TIKTOK_BASE_NAME = "TikTok — пиксель (основной код)";
  tag({
    name: TIKTOK_BASE_NAME, type: "html", parentFolderId: F.tiktok, firingTriggerId: [GTM_ALL_PAGES], blockingTriggerId: [block.tiktok], tagFiringOption: "ONCE_PER_LOAD",
    parameter: html(TIKTOK_BASE), notes: "Официальный код пикселя TikTok + просмотр страницы при открытии сайта.",
  });
  const tiktokSetup = [{ tagName: TIKTOK_BASE_NAME, stopOnSetupFailure: true }];
  tag({
    name: "TikTok — page (переход по сайту)", type: "html", parentFolderId: F.tiktok, firingTriggerId: [historyTrigger], blockingTriggerId: [block.tiktok], setupTag: tiktokSetup,
    parameter: html(script(`${TIKTOK_READY}\n  window.ttq.page();`)),
  });
  for (const p of PIXEL_EVENTS) {
    const params = tiktokParams(p.tiktok);
    const purchase = p.site.includes("purchase");
    const call = `window.ttq.track('${p.tiktok}'${params ? `, ${params}` : purchase ? ", {}" : ""}${purchase ? `, { event_id: ${ref(GTM_VAR.eventId)} }` : ""});`;
    tag({
      name: `TikTok — ${p.tiktok}`, type: "html", parentFolderId: F.tiktok, blockingTriggerId: [block.tiktok], setupTag: tiktokSetup,
      firingTriggerId: [p.site.length > 1 ? contactTrigger : onEvent.get(p.site[0])!],
      parameter: html(script(`${TIKTOK_READY}\n  ${call}`)),
      notes: `Событие сайта: ${p.site.join(", ")}.${purchase ? " event_id = номер заказа (склейка с покупкой с сервера)." : ""}`,
    });
  }

  const builtIn = (type: string, name: string): GtmBuiltIn => ({ accountId: "0", containerId: "0", type, name });
  return {
    exportFormatVersion: 2,
    exportTime: `${GTM_CONTAINER_VERSION} 00:00:00`,
    containerVersion: {
      path: "accounts/0/containers/0/versions/0",
      accountId: "0",
      containerId: "0",
      containerVersionId: "0",
      name: `Handyman ${GTM_CONTAINER_VERSION}`,
      description: "Готовый контейнер магазина Handyman: GA4, Google Ads, Meta Pixel, TikTok Pixel. ID берутся из админки сайта (dataLayer, hm_config) — в контейнере их вписывать не нужно. Инструкция — docs/ANALYTICS.md.",
      container: { path: "accounts/0/containers/0", accountId: "0", containerId: "0", name: "Handyman", publicId: "GTM-XXXXXXX", usageContext: ["WEB"], fingerprint: "0" },
      tag: tags,
      trigger: triggers,
      variable: variables,
      folder: folders,
      builtInVariable: [
        builtIn("PAGE_URL", "Page URL"),
        builtIn("PAGE_HOSTNAME", "Page Hostname"),
        builtIn("PAGE_PATH", "Page Path"),
        builtIn("REFERRER", "Referrer"),
        builtIn("EVENT", "Event"),
        builtIn("HISTORY_SOURCE", "History Source"),
        builtIn("NEW_HISTORY_URL", "New History URL"),
        builtIn("OLD_HISTORY_URL", "Old History URL"),
      ],
      fingerprint: "0",
    },
  };
}

/** Текст файла `deploy/gtm-container.json` (и ответа «Скачать контейнер»). */
export const gtmContainerJson = () => JSON.stringify(buildGtmContainer(), null, 2) + "\n";
