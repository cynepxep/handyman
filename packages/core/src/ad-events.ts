// Аналитика, шаг А3: покупка с сервера — Meta Conversions API, TikTok Events API, GA4 Measurement Protocol.
// Часть покупок в браузере теряется (блокировщики рекламы, iPhone режет куки), поэтому сервер дублирует покупку сам. Кабинеты склеивают
// её с покупкой из браузера по номеру заказа: Meta — `event_id` = `eventID` пикселя, TikTok — `event_id`, GA4 — `transaction_id`
// (GA4 не считает дважды покупку с тем же номером у того же пользователя — поэтому `client_id` берётся из куки `_ga` браузера).
// Телефон и почта уходят только в виде SHA-256 (так требуют Meta и TikTok); GA4 их не получает.
// Чистая логика без базы и сети. Модуль использует node:crypto — свой вход `@handyman/core/ad-events`, в браузер не импортировать.
import { createHash } from "node:crypto";
import { ANALYTICS_CURRENCY, analyticsItem, itemsValue, type AnalyticsItem, type Utm } from "./shop/analytics";

export type AdPlatform = "meta" | "tiktok" | "ga4";
export const AD_PLATFORMS: AdPlatform[] = ["meta", "tiktok", "ga4"];
export const AD_PLATFORM_RU: Record<AdPlatform, string> = { meta: "Meta (Facebook/Instagram)", tiktok: "TikTok", ga4: "Google Analytics 4" };
/** purchase — покупка (при оформлении); refund — отмена/возврат заказа (только GA4: в Meta и TikTok отмену не передают). */
export type AdKind = "purchase" | "refund";
/** queued — ждёт; sending — отправляется; sent — принято; error — не вышло (nextTryAt задан — сайт повторит сам). */
export type AdState = "queued" | "sending" | "sent" | "error";

// ---------- что браузер оставил при оформлении (кладётся в заказ: Order.adContext) ----------

/** Данные браузера покупателя на момент оформления: без них кабинет не свяжет покупку с кликом по рекламе. */
export type AdContext = {
  /** кука `_fbp` пикселя Meta */
  fbp?: string;
  /** кука `_fbc` (или собранная из fbclid рекламного перехода) */
  fbc?: string;
  /** кука `_ttp` пикселя TikTok */
  ttp?: string;
  /** идентификатор клика TikTok из адреса перехода */
  ttclid?: string;
  /** GA4: client_id из куки `_ga` («123456789.1712345678») */
  gaClientId?: string;
  /** GA4: номер сессии из куки `_ga_<поток>` */
  gaSessionId?: string;
  /** адрес и браузер покупателя — Meta требует для событий сайта; стираются, когда покупка ушла во все кабинеты */
  ip?: string;
  ua?: string;
  /** страница, с которой оформили (без параметров) */
  url?: string;
};

const clean = (v: unknown, max = 300): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "");

/** `_ga` = «GA1.1.123456789.1712345678» → «123456789.1712345678». */
export function gaClientIdFromCookie(raw: string | undefined | null): string {
  const m = /^GA\d\.\d+\.(\d{1,20}\.\d{9,11})$/.exec(clean(raw, 80));
  return m ? m[1] : "";
}

/** `_ga_<поток>`: старый формат «GS1.1.1712345678.3.1.…», новый «GS2.1.s1712345678$o3$g1$t…» → «1712345678». */
export function gaSessionIdFromCookie(raw: string | undefined | null): string {
  const v = clean(raw, 300);
  const gs1 = /^GS1\.\d+\.(\d{6,12})\./.exec(v);
  if (gs1) return gs1[1];
  const gs2 = /^GS2\.\d+\.s(\d{6,12})(?:\$|$)/.exec(v);
  return gs2 ? gs2[1] : "";
}

/** Кука сессии GA4 для потока G-ABC123: «_ga_ABC123». */
export const gaSessionCookieName = (ga4Id: string) => `_ga_${ga4Id.replace(/^G-/, "")}`;

/**
 * Собрать AdContext из кук, заголовков и меток рекламы (кука hm_utm). Мусор в куках не принимается.
 * `_fbc` нет, но переход был по рекламе Meta (fbclid) — собираем его по правилу Meta: «fb.1.<время перехода, мс>.<fbclid>».
 */
export function adContextFrom(input: {
  cookies: Record<string, string | undefined>;
  ga4Id?: string;
  ip?: string;
  ua?: string;
  referer?: string;
  utm?: Utm | null;
  now?: Date;
}): AdContext {
  const c = input.cookies;
  const ctx: AdContext = {};
  const fbp = clean(c._fbp, 120);
  if (/^fb\.\d\.\d{10,13}\.\d{1,20}$/.test(fbp)) ctx.fbp = fbp;
  const fbc = clean(c._fbc, 300);
  if (/^fb\.\d\.\d{10,13}\.[\w-]{10,250}$/.test(fbc)) ctx.fbc = fbc;
  else if (input.utm?.fbclid && /^[\w-]{10,250}$/.test(input.utm.fbclid)) {
    const at = Date.parse(input.utm.at ?? "") || (input.now ?? new Date()).getTime();
    ctx.fbc = `fb.1.${at}.${input.utm.fbclid}`;
  }
  const ttp = clean(c._ttp, 120);
  if (/^[\w.-]{8,120}$/.test(ttp)) ctx.ttp = ttp;
  if (input.utm?.ttclid && /^[\w.-]{8,250}$/.test(input.utm.ttclid)) ctx.ttclid = input.utm.ttclid;
  const cid = gaClientIdFromCookie(c._ga);
  if (cid) ctx.gaClientId = cid;
  if (input.ga4Id) {
    const sid = gaSessionIdFromCookie(c[gaSessionCookieName(input.ga4Id)]);
    if (sid) ctx.gaSessionId = sid;
  }
  const ip = clean(input.ip, 64);
  if (ip && ip !== "local") ctx.ip = ip;
  const ua = clean(input.ua, 400);
  if (ua) ctx.ua = ua;
  try {
    const u = new URL(clean(input.referer, 1000));
    if (u.protocol === "https:" || u.protocol === "http:") ctx.url = `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    /* нет страницы — не страшно */
  }
  return ctx;
}

/** AdContext из заказа (JSON): только известные поля. */
export function parseAdContext(raw: unknown): AdContext {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: AdContext = {};
  for (const k of ["fbp", "fbc", "ttp", "ttclid", "gaClientId", "gaSessionId", "ip", "ua", "url"] as const) {
    const v = clean(r[k], k === "ua" ? 400 : 300);
    if (v) out[k] = v;
  }
  return out;
}

// ---------- телефон и почта: только SHA-256 ----------

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Телефон для Meta: только цифры с кодом страны («380931234567»). Украинский без кода (093…) дополняется 38. */
export function phoneDigits(phone: string | null | undefined): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) d = `38${d}`;
  return d.length >= 10 && d.length <= 15 ? d : "";
}

export const normEmail = (email: string | null | undefined) => {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};

// ---------- заказ для отправки ----------

export type AdOrderLine = { sku: string; name: string; qty: number; unitPrice: number; brand?: string | null; category?: string | null };

export type AdOrder = {
  no: string;
  createdAt: Date;
  /** покупатель (карточка клиента) — для external_id */
  clientId: string;
  phone: string | null;
  email: string | null;
  lines: AdOrderLine[];
};

const items = (o: AdOrder): AnalyticsItem[] =>
  o.lines.map((l) => analyticsItem({ sku: l.sku, name: l.name, brand: l.brand, categories: [l.category], price: l.unitPrice, qty: l.qty }));

/** Сумма покупки — как у события в браузере: товары после всех скидок, без доставки (Д76). */
export const adOrderValue = (o: AdOrder) => itemsValue(items(o));

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** Адрес страницы для кабинетов: страница оформления из браузера, иначе — адрес сайта. */
export function adSourceUrl(ctx: AdContext, publicUrl: string | undefined): string {
  const base = (publicUrl ?? "").trim().replace(/\/+$/, "");
  if (ctx.url) {
    if (!base) return ctx.url;
    try {
      return `${base}${new URL(ctx.url).pathname}`;
    } catch {
      return base;
    }
  }
  return base;
}

// ---------- Meta Conversions API ----------

export const META_GRAPH_VERSION = "v23.0";

/** POST https://graph.facebook.com/<версия>/<ID пикселя>/events — тело запроса (токен — в адресе, не здесь). */
export function metaPurchaseBody(o: AdOrder, ctx: AdContext, opts: { sourceUrl: string; testCode?: string }) {
  const its = items(o);
  const ph = phoneDigits(o.phone);
  const em = normEmail(o.email);
  const user: Record<string, unknown> = {
    ...(ph ? { ph: [sha256(ph)] } : {}),
    ...(em ? { em: [sha256(em)] } : {}),
    external_id: [sha256(o.clientId)],
    country: [sha256("ua")],
    ...(ctx.ip ? { client_ip_address: ctx.ip } : {}),
    ...(ctx.ua ? { client_user_agent: ctx.ua } : {}),
    ...(ctx.fbp ? { fbp: ctx.fbp } : {}),
    ...(ctx.fbc ? { fbc: ctx.fbc } : {}),
  };
  return {
    data: [
      {
        event_name: "Purchase",
        event_time: unix(o.createdAt),
        event_id: o.no,
        action_source: "website",
        ...(opts.sourceUrl ? { event_source_url: opts.sourceUrl } : {}),
        user_data: user,
        custom_data: {
          currency: ANALYTICS_CURRENCY,
          value: itemsValue(its),
          order_id: o.no,
          content_type: "product",
          content_ids: its.map((i) => i.item_id),
          contents: its.map((i) => ({ id: i.item_id, quantity: i.quantity, item_price: i.price })),
          num_items: its.reduce((a, i) => a + i.quantity, 0),
        },
      },
    ],
    ...(opts.testCode ? { test_event_code: opts.testCode } : {}),
  };
}

// ---------- TikTok Events API ----------

export const TIKTOK_EVENTS_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

/** POST TIKTOK_EVENTS_URL (заголовок Access-Token) — тело запроса. Телефон — SHA-256 от «+380…» (формат E.164). */
export function tiktokPurchaseBody(o: AdOrder, ctx: AdContext, opts: { pixelId: string; sourceUrl: string; testCode?: string }) {
  const its = items(o);
  const ph = phoneDigits(o.phone);
  const em = normEmail(o.email);
  return {
    event_source: "web",
    event_source_id: opts.pixelId,
    ...(opts.testCode ? { test_event_code: opts.testCode } : {}),
    data: [
      {
        event: "CompletePayment",
        event_time: unix(o.createdAt),
        event_id: o.no,
        user: {
          ...(ph ? { phone: sha256(`+${ph}`) } : {}),
          ...(em ? { email: sha256(em) } : {}),
          external_id: sha256(o.clientId),
          ...(ctx.ttclid ? { ttclid: ctx.ttclid } : {}),
          ...(ctx.ttp ? { ttp: ctx.ttp } : {}),
          ...(ctx.ip ? { ip: ctx.ip } : {}),
          ...(ctx.ua ? { user_agent: ctx.ua } : {}),
        },
        properties: {
          currency: ANALYTICS_CURRENCY,
          value: itemsValue(its),
          order_id: o.no,
          content_type: "product",
          contents: its.map((i) => ({
            content_id: i.item_id, content_name: i.item_name, quantity: i.quantity, price: i.price, ...(i.item_brand ? { brand: i.item_brand } : {}),
          })),
        },
        ...(opts.sourceUrl ? { page: { url: opts.sourceUrl } } : {}),
      },
    ],
  };
}

// ---------- GA4 Measurement Protocol ----------

export const GA4_MP_URL = "https://www.google-analytics.com/mp/collect";
export const GA4_MP_DEBUG_URL = "https://www.google-analytics.com/debug/mp/collect";

/**
 * client_id для GA4: из куки `_ga` браузера (тогда GA4 узнаёт пользователя и не считает покупку дважды). Куки нет (GA4 в браузере
 * заблокирован) — постоянный номер из номера заказа: покупка и её отмена попадут к одному «пользователю».
 */
export function ga4ClientId(o: Pick<AdOrder, "no" | "createdAt">, ctx: AdContext): string {
  if (ctx.gaClientId) return ctx.gaClientId;
  return `${parseInt(sha256(`hm-order:${o.no}`).slice(0, 8), 16)}.${unix(o.createdAt)}`;
}

/** Тело запроса GA4 (адрес — GA4_MP_URL?measurement_id=…&api_secret=…). refund — вся сумма заказа, без товаров. */
export function ga4Body(kind: AdKind, o: AdOrder, ctx: AdContext, now: Date = new Date()) {
  const its = items(o);
  const common = { currency: ANALYTICS_CURRENCY, transaction_id: o.no, value: itemsValue(its), engagement_time_msec: 1, ...(ctx.gaSessionId ? { session_id: ctx.gaSessionId } : {}) };
  const at = kind === "purchase" ? o.createdAt : now;
  // GA4 принимает события не старше 72 часов; старше (повтор после долгого сбоя) — с текущим временем
  const ts = now.getTime() - at.getTime() > 71 * 3600_000 ? now : at;
  return {
    client_id: ga4ClientId(o, ctx),
    timestamp_micros: ts.getTime() * 1000,
    events: [
      kind === "purchase"
        ? { name: "purchase", params: { ...common, shipping: 0, items: its } }
        : { name: "refund", params: common },
    ],
  };
}

// ---------- ответы ----------

export type AdSendResult = { ok: true } | { ok: false; error: string; /** повторить позже (сбой сети, перегрузка) */ retry: boolean };

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" ? (x as Json) : {});
const str = (x: unknown) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
const transient = (status: number) => status === 429 || status >= 500;

/** Meta: 200 + events_received ≥ 1 — принято; ошибка — `error.message`. */
export function readMetaSend(status: number, body: unknown): AdSendResult {
  const b = obj(body);
  if (status >= 200 && status < 300 && Number(b.events_received) >= 1) return { ok: true };
  const e = obj(b.error);
  const msg = str(e.error_user_msg) || str(e.message) || `ответ ${status}`;
  // код 190 — токен неверный или отозван; 100 — неверные данные: повтор не поможет. 4 / 17 / 32 / 613 — слишком часто
  const rate = [4, 17, 32, 613].includes(Number(e.code));
  return { ok: false, error: `Meta: ${msg}`.slice(0, 400), retry: transient(status) || rate };
}

/** TikTok: 200 + code 0 — принято. 40100 — слишком часто; 5xx — сбой у TikTok. */
export function readTiktokSend(status: number, body: unknown): AdSendResult {
  const b = obj(body);
  if (status >= 200 && status < 300 && Number(b.code) === 0) return { ok: true };
  const code = Number(b.code);
  return { ok: false, error: `TikTok: ${str(b.message) || `ответ ${status}`}${b.code !== undefined ? ` (код ${str(b.code)})` : ""}`.slice(0, 400), retry: transient(status) || code === 40100 || code >= 50000 };
}

/** GA4 Measurement Protocol на ошибки в данных не жалуется (всегда 2xx) — ошибкой считаем только код ответа. */
export function readGa4Send(status: number): AdSendResult {
  if (status >= 200 && status < 300) return { ok: true };
  return { ok: false, error: `Google Analytics: ответ ${status}${status === 403 || status === 401 ? " (проверьте секрет API Measurement Protocol)" : ""}`, retry: transient(status) || status === 0 };
}

// ---------- проверка подключения (кнопка в «Интеграциях») ----------

/** Meta: GET /<ID пикселя>?fields=id,name — отвечает только на верный токен с доступом к этому пикселю. */
export function readMetaCheck(status: number, body: unknown): { ok: boolean; message: string } {
  const b = obj(body);
  if (status === 200 && str(b.id)) return { ok: true, message: `Meta: токен Conversions API принят${str(b.name) ? `, пиксель «${str(b.name)}»` : ""}.` };
  const e = obj(b.error);
  return { ok: false, message: `Meta не приняла токен Conversions API: ${str(e.message) || `ответ ${status}`}. Токен создаётся в Events Manager → ваш пиксель → Настройки → Conversions API.` };
}

/** GA4: отладочный адрес /debug/mp/collect отвечает списком замечаний к событию (пустой — всё верно). Сам секрет он не проверяет. */
export function readGa4DebugCheck(status: number, body: unknown): { ok: boolean; message: string } {
  if (status !== 200) return { ok: false, message: `Google Analytics (Measurement Protocol) ответил ошибкой ${status}.` };
  const msgs = Array.isArray(obj(body).validationMessages) ? (obj(body).validationMessages as unknown[]).map((m) => str(obj(m).description)).filter(Boolean) : [];
  return msgs.length
    ? { ok: false, message: `Google Analytics нашёл ошибки в событии: ${msgs.slice(0, 3).join("; ")}.` }
    : { ok: true, message: "Google Analytics: формат покупки с сервера верный (секрет API Google проверяет только при настоящей отправке — смотрите отчёт «В реальном времени»)." };
}

// ---------- повторы ----------

export const AD_MAX_ATTEMPTS = 7;
const DELAYS_MIN = [1, 5, 15, 60, 180, 720];
/** Через сколько минут повторить после `attempts` неудачных попыток (null — больше не пробуем; Meta принимает покупку не старше 7 дней). */
export const adRetryDelayMin = (attempts: number): number | null =>
  attempts >= AD_MAX_ATTEMPTS ? null : DELAYS_MIN[Math.max(0, Math.min(attempts - 1, DELAYS_MIN.length - 1))];
/** «Отправляется» дольше этого — прошлая попытка оборвалась (перезапуск сайта): можно брать снова. */
export const AD_SENDING_STALE_MIN = 3;

/**
 * Слать ли покупку с сервера: как в браузере — не тестовые, не «подозрительные» (чёрный список), и только заказы с сайта
 * («Оформить» и «1 клік»): заказ по звонку — не покупка на сайте, рекламе он не принадлежит.
 */
export function adPurchaseAllowed(o: { isTest: boolean; suspicious: string | null; source: string | null }): boolean {
  return !o.isTest && !o.suspicious && (o.source === "site" || o.source === "one_click");
}

/** Отмена/возврат в GA4 — только если покупка там посчитана (с сервера или из браузера). */
export const AD_REFUND_STATUSES = ["CANCELLED", "RETURNED"] as const;
