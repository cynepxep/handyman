// Аналитика (шаг А1): события для Google Tag Manager в формате GA4 e-commerce. Сайт пишет события только в `dataLayer`,
// теги GA4, Google Ads, Meta Pixel и TikTok Pixel живут внутри контейнера GTM (шаг А2). Чистая логика без базы и сети —
// её же импортирует браузер (без node:crypto), поэтому модуль входит в `@handyman/core/shop`.
// Суммы для `purchase` и `begin_checkout` собирает сервер (заказ из базы, quoteCart): браузер их не считает.

export const ANALYTICS_CURRENCY = "UAH";

/** Товар в событии GA4: `item_id` — наш артикул, категории — как в меню витрины (группа → подгруппа → категория каталога). */
export type AnalyticsItem = {
  item_id: string;
  item_name: string;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  /** цена за штуку, как видит покупатель (с оптом и скидкой), грн */
  price: number;
  quantity: number;
  item_list_id?: string;
  item_list_name?: string;
  index?: number;
};

export type ItemSource = {
  sku: string;
  name: string;
  brand?: string | null;
  /** названия сверху вниз: группа меню, подгруппа, категория (лишнее отбрасывается) */
  categories?: Array<string | null | undefined>;
  price: number;
  qty?: number;
  listId?: string;
  listName?: string;
  index?: number;
};

const money = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const clip = (s: string, n = 100) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Один товар для события. Пустые поля не попадают в событие (GA4 показывает «(not set)», а не пустую строку). */
export function analyticsItem(s: ItemSource): AnalyticsItem {
  const it: AnalyticsItem = { item_id: s.sku, item_name: clip(s.name), price: money(s.price), quantity: Math.max(1, Math.floor(s.qty ?? 1)) };
  if (s.brand?.trim()) it.item_brand = clip(s.brand);
  const cats = (s.categories ?? []).map((c) => (c ? clip(c) : "")).filter(Boolean);
  // одинаковые соседние названия (подгруппа меню = категория каталога) — один раз
  const uniq = cats.filter((c, i) => c !== cats[i - 1]).slice(0, 3);
  if (uniq[0]) it.item_category = uniq[0];
  if (uniq[1]) it.item_category2 = uniq[1];
  if (uniq[2]) it.item_category3 = uniq[2];
  if (s.listId) it.item_list_id = s.listId;
  if (s.listName) it.item_list_name = clip(s.listName);
  if (s.index !== undefined) it.index = s.index;
  return it;
}

/** Сумма товаров (цена × количество), до копейки. */
export const itemsValue = (items: AnalyticsItem[]) => money(items.reduce((a, i) => a + i.price * i.quantity, 0));

export type EcommerceData = {
  currency: string;
  value?: number;
  items: AnalyticsItem[];
  transaction_id?: string;
  shipping?: number;
  coupon?: string;
  item_list_id?: string;
  item_list_name?: string;
};

/** Поле `ecommerce` события: валюта, сумма по товарам, товары (+ поля покупки/списка). */
export function ecommerceOf(items: AnalyticsItem[], extra: Omit<EcommerceData, "currency" | "items"> = {}): EcommerceData {
  return { currency: ANALYTICS_CURRENCY, value: itemsValue(items), items, ...extra };
}

/** Списки — первые N товаров (больше GA4 не нужно, а `dataLayer` не раздувается). */
export const LIST_ITEMS_MAX = 20;

/** События, которые сайт пишет в `dataLayer` (имена — как в GA4; `phone_click`/`telegram_click` — свои). */
export const ANALYTICS_EVENTS = [
  "view_item", "view_item_list", "select_item", "add_to_cart", "remove_from_cart", "begin_checkout", "purchase",
  "search", "phone_click", "telegram_click", "add_to_wishlist",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
/** e-commerce события: перед ними в `dataLayer` кладётся `{ ecommerce: null }` (иначе GTM склеит товары с прошлым событием). */
export const ECOMMERCE_EVENTS: ReadonlySet<string> = new Set([
  "view_item", "view_item_list", "select_item", "add_to_cart", "remove_from_cart", "begin_checkout", "purchase", "add_to_wishlist",
]);

// ---------- покупка ----------

export type PurchaseFacts = {
  isTest: boolean;
  suspicious: string | null;
  /** когда событие покупки уже отдано в браузер (Order.analyticsAt) */
  analyticsAt: Date | string | null;
  /** открыто из браузера, где вошли в админку */
  staff?: boolean;
};

export type PurchaseDecision = { send: true } | { send: false; reason: "test" | "suspicious" | "sent" | "staff" };

/**
 * Слать ли `purchase`: один раз на заказ, и не засорять рекламу — тестовые заказы, «подозрительные» (чёрный список)
 * и заказы из браузера с открытой админкой не считаются.
 */
export function purchaseDecision(f: PurchaseFacts): PurchaseDecision {
  if (f.staff) return { send: false, reason: "staff" };
  if (f.isTest) return { send: false, reason: "test" };
  if (f.suspicious) return { send: false, reason: "suspicious" };
  if (f.analyticsAt) return { send: false, reason: "sent" };
  return { send: true };
}

export type PurchaseLine = { sku: string; name: string; qty: number; unitPrice: number; brand?: string | null; categories?: Array<string | null | undefined> };

export type PurchaseEvent = { event: "purchase"; event_id: string; ecommerce: EcommerceData };

/**
 * Событие покупки по заказу из базы: `transaction_id` и `event_id` — номер заказа (HM-…; по нему кабинеты склеивают покупку
 * из браузера и с сервера, шаг А3), `value` — товары после всех скидок (как в заказе), без доставки; `shipping` — 0
 * (доставку Новой Почтой покупатель платит перевозчику, сайт её не берёт).
 */
export function purchaseEvent(no: string, lines: PurchaseLine[]): PurchaseEvent {
  const items = lines.map((l) => analyticsItem({ sku: l.sku, name: l.name, brand: l.brand, categories: l.categories, price: l.unitPrice, qty: l.qty }));
  return { event: "purchase", event_id: no, ecommerce: ecommerceOf(items, { transaction_id: no, shipping: 0 }) };
}

// ---------- откуда пришёл покупатель: UTM и метки кликов ----------

/** Метки рекламы: UTM и идентификаторы кликов Google (gclid, gbraid, wbraid), Meta (fbclid), TikTok (ttclid). */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid", "ttclid"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>> & {
  /** страница входа (без параметров) */
  landing?: string;
  /** когда пришёл (ISO) */
  at?: string;
};
/** Кука с метками последнего рекламного перехода (как hm_ref): 30 дней, новый переход с метками заменяет старый. */
export const UTM_COOKIE = "hm_utm";
export const UTM_COOKIE_DAYS = 30;

const cleanValue = (v: unknown, max = 200): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");

/** Метки из адреса страницы входа. Нет ни одной — null (обычный переход: прежние метки не трогаем). */
export function utmFromParams(sp: URLSearchParams, landing: string, now: Date = new Date()): Utm | null {
  const out: Utm = {};
  for (const k of UTM_KEYS) {
    const v = cleanValue(sp.get(k));
    if (v) out[k] = v;
  }
  if (!Object.keys(out).length) return null;
  const path = cleanValue(landing.split("?")[0]);
  if (path.startsWith("/")) out.landing = path;
  out.at = now.toISOString();
  return out;
}

/** Метки из куки или из заказа (JSON): только известные поля, обрезанные. Мусор — null. */
export function parseUtm(raw: unknown): Utm | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw.startsWith("%7B") || raw.startsWith("%7b") ? decodeURIComponent(raw) : raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const out: Utm = {};
  for (const k of UTM_KEYS) {
    const x = cleanValue(r[k]);
    if (x) out[k] = x;
  }
  if (!Object.keys(out).length) return null;
  const landing = cleanValue(r.landing);
  if (landing.startsWith("/")) out.landing = landing;
  const at = cleanValue(r.at, 40);
  if (at && !Number.isNaN(Date.parse(at))) out.at = at;
  return out;
}


/** Коротко для менеджера: «google / cpc / spring_sale», «Google Ads (клик)», «Facebook/Instagram (клик)». */
export function utmLabel(u: Utm | null): string {
  if (!u) return "";
  const parts = [u.utm_source, u.utm_medium, u.utm_campaign].filter(Boolean);
  const clicks = [
    u.gclid || u.gbraid || u.wbraid ? "Google Ads" : "",
    u.fbclid ? "Facebook/Instagram" : "",
    u.ttclid ? "TikTok" : "",
  ].filter(Boolean);
  const head = parts.join(" / ");
  if (head) return clicks.length ? `${head} (${clicks.join(", ")})` : head;
  return clicks.length ? `${clicks.join(", ")} (клик по рекламе)` : "";
}

// ---------- ID кабинетов (раздел «Интеграции → Аналитика») ----------

export type AnalyticsIds = {
  gtmId: string;
  ga4Id: string;
  adsConversionId: string;
  adsPurchaseLabel: string;
  metaPixelId: string;
  tiktokPixelId: string;
};

/** Проверка формата ID (понятная ошибка или null). Пустое значение не проверяем. */
export function analyticsIdError(field: string, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  switch (field) {
    case "gtmId":
      return /^GTM-[A-Z0-9]{4,12}$/.test(v) ? null : "ID контейнера GTM выглядит как «GTM-ABC1234» (большие латинские буквы и цифры) — скопируйте его из Tag Manager.";
    case "ga4Id":
      return /^G-[A-Z0-9]{4,16}$/.test(v) ? null : "Идентификатор потока GA4 выглядит как «G-ABC123DEF4» — Google Analytics → Администратор → Потоки данных.";
    case "adsConversionId":
      return /^AW-\d{6,14}$/.test(v) ? null : "Идентификатор конверсии Google Ads выглядит как «AW-123456789».";
    case "adsPurchaseLabel":
      return /^[A-Za-z0-9_-]{6,40}$/.test(v) ? null : "Метка конверсии — латинские буквы, цифры, «-» и «_» (часть после «/» в «AW-123456789/AbC-dEf_123»).";
    case "metaPixelId":
      return /^\d{10,20}$/.test(v) ? null : "ID пикселя Meta — только цифры (обычно 15–16), Events Manager → Источники данных.";
    case "tiktokPixelId":
      return /^[A-Z0-9]{10,40}$/.test(v) ? null : "ID пикселя TikTok — большие латинские буквы и цифры (вида «C1ABCDEF2GHIJ3KLMN4O»), TikTok Ads → Events Manager.";
    // шаг А3: ключи для покупки с сервера
    case "metaCapiToken":
    case "tiktokToken":
      return /^[A-Za-z0-9_|.-]{20,500}$/.test(v) ? null : "Токен — длинная строка из латинских букв и цифр без пробелов: скопируйте его целиком.";
    case "ga4ApiSecret":
      return /^[A-Za-z0-9_-]{10,64}$/.test(v) ? null : "Секрет API — латинские буквы, цифры, «-» и «_» (столбец «Значение секретного ключа» в GA4), не его название.";
    case "metaTestCode":
    case "tiktokTestCode":
      return /^TEST[A-Za-z0-9]{1,20}$/.test(v) ? null : "Код тестовых событий выглядит как «TEST12345» — скопируйте его со страницы тестовых событий.";
  }
  return null;
}

/** Конфигурация для контейнера GTM: кладётся в `dataLayer` до загрузки GTM (событие `hm_config`), теги берут ID отсюда. */
export function analyticsConfigPush(ids: AnalyticsIds, channel: "web" | "miniapp") {
  return {
    event: "hm_config",
    hm_ga4_id: ids.ga4Id || undefined,
    hm_ads_id: ids.adsConversionId || undefined,
    hm_ads_purchase_label: ids.adsPurchaseLabel || undefined,
    hm_meta_pixel_id: ids.metaPixelId || undefined,
    hm_tiktok_pixel_id: ids.tiktokPixelId || undefined,
    channel,
  };
}

// ---------- звонки и мессенджеры (phone_click / telegram_click) ----------

/** Тип страницы витрины по адресу — «где нажали» (укр. без приставки, рус. с /ru). */
export function analyticsPageType(pathname: string): string {
  const p = pathname.replace(/^\/ru(?=\/|$)/, "") || "/";
  if (p === "/") return "home";
  const rules: Array<[string, string]> = [
    ["/product/", "product"], ["/catalog", "catalog"], ["/task/", "catalog"], ["/search", "search"], ["/order/", "thanks"],
    ["/info/", "info"], ["/cart", "cart"], ["/checkout", "checkout"], ["/favorites", "favorites"], ["/compare", "compare"], ["/account", "account"],
  ];
  return rules.find(([prefix]) => p.startsWith(prefix))?.[1] ?? "other";
}

/** Нажатая ссылка — звонок или мессенджер? `tel:` → звонок; Telegram (t.me, tg:) и Viber (viber:) → `telegram_click` с `messenger`. */
export function contactClick(href: string): { event: "phone_click" } | { event: "telegram_click"; messenger: "telegram" | "viber" } | null {
  const h = href.trim().toLowerCase();
  if (h.startsWith("tel:")) return { event: "phone_click" };
  if (h.startsWith("tg:") || /^https?:\/\/(www\.)?(t|telegram)\.me\//.test(h)) return { event: "telegram_click", messenger: "telegram" };
  if (h.startsWith("viber:") || /^https?:\/\/(www\.)?viber\.click\//.test(h)) return { event: "telegram_click", messenger: "viber" };
  return null;
}

/**
 * Скрипт до загрузки страницы (layout витрины): `dataLayer`, признак «аналитика включена» (`__hmA`), канал (Mini App — по данным
 * Telegram в адресе или по отметке прошлой страницы), ID кабинетов (`hm_config`) и старт GTM (`gtm.js`). Сам gtm.js грузится позже.
 */
export function analyticsInitScript(ids: AnalyticsIds): string {
  const config = JSON.stringify(analyticsConfigPush(ids, "web")).replace(/</g, "\\u003c");
  return (
    "(function(w){w.dataLayer=w.dataLayer||[];w.__hmA=1;var m=false;" +
    "try{m=sessionStorage.getItem('hm-miniapp')==='1'||location.hash.indexOf('tgWebAppData')>=0}catch(e){}" +
    `w.__hmCh=m?'miniapp':'web';var c=${config};c.channel=w.__hmCh;w.dataLayer.push(c);` +
    "w.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});})(window);"
  );
}
