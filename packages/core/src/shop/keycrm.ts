// KeyCRM (шаг 3.5): чистые правила без базы и сети — тело запроса «создать заказ», разбор ответов KeyCRM и вебхука,
// таблица соответствия статусов, расписание повторов. Запросы, очередь и смена статуса — packages/db/src/keycrm.ts.
//
// Формат API сверен с описанием KeyCRM OpenAPI (https://openapi.keycrm.app/v1, Bearer-ключ; POST /order, GET /order/{id},
// GET /order?filter[…], GET /order/status). Поля заказа: source_id, source_uuid, buyer{full_name, phone}, buyer_comment,
// manager_comment, products[{sku, name, quantity, price}], shipping{shipping_service, shipping_address_city, shipping_secondary_line,
// shipping_receive_point}. Вебхук KeyCRM: {event: "order.change_order_status", context: {…заказ…}}.
// ДОПУЩЕНИЯ (не проверены на настоящем KeyCRM, см. docs/QUESTIONS-TO-OWNER.md): ошибки приходят как {message, errors{поле: [текст]}};
// GET /order понимает filter[source_uuid]; в context вебхука есть id, status_id и source_uuid.

import { ORDER_STATUS_RU, PAY_MODE_RU } from "./order";

export const KEYCRM_SETTING_KEY = "keycrm.settings";
export const KEYCRM_BASE = "https://openapi.keycrm.app/v1";

/** Наши статусы (ключи OrderStatus) — для таблицы соответствия. */
export const KEYCRM_OUR_STATUSES = Object.keys(ORDER_STATUS_RU);

export type KeycrmStatusRow = { id: number; name: string; alias: string };

export type KeycrmSettings = {
  /** «Передавать заказы в KeyCRM» — новые заказы уходят сами. По умолчанию выключено: старый магазин тоже шлёт заказы в KeyCRM. */
  enabled: boolean;
  /** id статуса KeyCRM → наш статус («» — на сайте не менять) */
  statusMap: Record<string, string>;
  /** статусы, загруженные из KeyCRM кнопкой (для названий в таблице и в заказе) */
  statuses: KeycrmStatusRow[];
  statusesAt: string | null;
};

export const DEFAULT_KEYCRM_SETTINGS: KeycrmSettings = { enabled: false, statusMap: {}, statuses: [], statusesAt: null };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d{1,12}$/.test(v.trim()) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
};
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizeKeycrmSettings(raw: unknown): KeycrmSettings {
  const r = obj(raw);
  const statusMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(r.statusMap))) {
    if (int(k) && typeof v === "string" && (v === "" || KEYCRM_OUR_STATUSES.includes(v))) statusMap[String(int(k))] = v;
  }
  const statuses = Array.isArray(r.statuses) ? r.statuses.map(readStatusRow).filter((x): x is KeycrmStatusRow => x !== null).slice(0, 200) : [];
  return { enabled: r.enabled === true, statusMap, statuses, statusesAt: typeof r.statusesAt === "string" ? r.statusesAt : null };
}

// ---------- номер в источнике ----------

/** «Номер замовлення у джерелі»: HM-0001; тестовый заказ — TEST-HM-0001, чтобы не занять номер настоящего. */
export const keycrmUuid = (no: string, isTest: boolean) => (isTest ? `TEST-${no}` : no);

// ---------- тело запроса POST /order ----------

export type KeycrmOrderInput = {
  no: string;
  uuid: string;
  isTest: boolean;
  name: string | null;
  phone: string | null;
  items: Array<{ sku: string; name: string; qty: number; unitPrice: number }>;
  delivery: string; // NOVA_POSHTA | COURIER_ODESA | PICKUP | TO_CONFIRM
  deliveryType: string | null; // Нова Пошта: warehouse | postomat | address
  city: string | null;
  address: string | null;
  npPoint: string | null;
  /** код отделения/почтомата в справочнике НП (если выбран из списка) */
  npPointRef?: string | null;
  pickupName: string | null;
  payMode: string;
  total: number;
  dueNow: number;
  paid: number;
  discountPct: number;
  comment: string | null;
  source: string | null;
  noCallback: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `${r2(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/ /g, " ")} ₴`;
const SOURCE_NOTE: Record<string, string> = { one_click: "«Купить в 1 клик» — перезвонить", manual: "Оформлен менеджером по звонку" };

/** Комментарий менеджеру: то, для чего у KeyCRM нет отдельного поля (оплата, предоплата, скидка, «не звонить», тест). */
export function keycrmManagerComment(o: KeycrmOrderInput): string {
  return [
    o.isTest ? "🧪 ТЕСТ — не обрабатывать (проверка связи сайта с KeyCRM)" : "",
    `Заказ ${o.no} с сайта${o.source && SOURCE_NOTE[o.source] ? `. ${SOURCE_NOTE[o.source]}` : ""}`,
    `Оплата: ${PAY_MODE_RU[o.payMode] ?? o.payMode}${o.dueNow > 0 && o.dueNow < o.total - 0.005 ? `, сейчас ${money(o.dueNow)}` : ""}`,
    o.paid > 0 ? `Оплачено картой: ${money(o.paid)}` : "",
    o.discountPct > 0 ? `Скидка клиента ${o.discountPct}% уже учтена в ценах` : "",
    o.delivery === "TO_CONFIRM" ? "Доставку и оплату уточнить по телефону" : "",
    o.noCallback ? "Просит не звонить для уточнения" : "",
    `Сумма на сайте: ${money(o.total)}`,
  ].filter(Boolean).join("\n");
}

function shippingOf(o: KeycrmOrderInput, npServiceId: number | null): Record<string, string | number> | undefined {
  const put = (s: Record<string, string | null | undefined>) =>
    Object.fromEntries(Object.entries(s).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "").map(([k, v]) => [k, v.trim().slice(0, 250)]));
  switch (o.delivery) {
    case "NOVA_POSHTA": {
      const base = put({
        shipping_service: "Нова Пошта",
        shipping_address_city: o.city,
        // отделение/почтомат — «точка выдачи»; курьер НП — адрес
        ...(o.deliveryType === "address" ? { shipping_secondary_line: o.npPoint } : { shipping_receive_point: o.npPoint }),
      });
      // код отделения KeyCRM принимает только вместе с ID службы «Нова Пошта» у вас в KeyCRM (warehouse_ref + delivery_service_id)
      if (npServiceId && o.npPointRef && o.deliveryType !== "address") return { ...base, delivery_service_id: npServiceId, warehouse_ref: o.npPointRef };
      return base;
    }
    case "COURIER_ODESA":
      return put({ shipping_service: "Кур'єр по Одесі", shipping_address_city: o.city || "Одеса", shipping_secondary_line: o.address });
    case "PICKUP":
      return put({ shipping_service: "Самовивіз", shipping_address_city: o.city, shipping_receive_point: [o.pickupName, o.address].filter(Boolean).join(", ") });
    default:
      return undefined;
  }
}

/**
 * Тело POST /order. Цена товара — уже со скидкой (снимок из заказа, посчитан сервером), поэтому скидку заказа отдельно не передаём:
 * иначе KeyCRM вычел бы её второй раз.
 */
export function keycrmOrderBody(o: KeycrmOrderInput, sourceId: number, npServiceId: number | null = null): Record<string, unknown> {
  const buyer: Record<string, string> = {};
  if (o.name?.trim()) buyer.full_name = o.name.trim().slice(0, 120);
  if (o.phone?.trim()) buyer.phone = o.phone.trim();
  const shipping = shippingOf(o, npServiceId);
  return {
    source_id: sourceId,
    source_uuid: o.uuid,
    buyer,
    ...(o.comment?.trim() ? { buyer_comment: o.comment.trim().slice(0, 1000) } : {}),
    manager_comment: keycrmManagerComment(o),
    products: o.items.map((i) => ({ sku: i.sku, name: i.name.slice(0, 250), quantity: i.qty, price: r2(i.unitPrice) })),
    ...(shipping && Object.keys(shipping).length ? { shipping } : {}),
  };
}

// ---------- ответы KeyCRM ----------

/** Понятный текст ошибки KeyCRM для админки. */
export function keycrmErrorText(status: number, body: unknown): string {
  if (status === 401 || status === 403) return "KeyCRM не принял API-ключ — проверьте его в «Интеграциях».";
  if (status === 429) return "KeyCRM просит подождать (больше 60 запросов в минуту) — повторим позже.";
  if (status >= 500) return `KeyCRM временно недоступен (код ${status}).`;
  const b = obj(body);
  const parts: string[] = [];
  const msg = str(b.message, 300);
  if (msg) parts.push(msg);
  for (const [field, v] of Object.entries(obj(b.errors))) {
    const text = Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" ") : str(v);
    if (text) parts.push(`${field}: ${text}`);
  }
  return `KeyCRM ответил ошибкой ${status}${parts.length ? `: ${parts.join("; ").slice(0, 400)}` : "."}`;
}

export type KeycrmOrderInfo = { id: number; statusId: number | null; sourceUuid: string | null; sourceId: number | null };

/** Заказ из ответа KeyCRM (POST /order, GET /order/{id}, элемент списка). */
export function readKeycrmOrder(body: unknown): KeycrmOrderInfo | null {
  const b = obj(body);
  const id = int(b.id);
  if (!id) return null;
  return { id, statusId: int(b.status_id), sourceUuid: str(b.source_uuid) || null, sourceId: int(b.source_id) };
}

/** Список заказов GET /order: {data: […]}. */
export const readKeycrmOrderList = (body: unknown): KeycrmOrderInfo[] =>
  (Array.isArray(obj(body).data) ? (obj(body).data as unknown[]) : []).map(readKeycrmOrder).filter((x): x is KeycrmOrderInfo => x !== null);

/** Из списка — наш заказ: тот же номер в источнике и (если KeyCRM его вернул) тот же источник. Фильтр мог и не сработать — сверяем сами. */
export function findByUuid(list: KeycrmOrderInfo[], uuid: string, sourceId: number): KeycrmOrderInfo | null {
  return list.find((x) => x.sourceUuid === uuid && (x.sourceId === null || x.sourceId === sourceId)) ?? null;
}

function readStatusRow(v: unknown): KeycrmStatusRow | null {
  const s = obj(v);
  const id = int(s.id);
  const name = str(s.name, 100);
  if (!id || !name) return null;
  if (s.is_active === false || s.deleted_at) return null;
  return { id, name, alias: str(s.alias, 100) };
}

/** Статусы заказов GET /order/status: {data: […]}. */
export const readKeycrmStatuses = (body: unknown): KeycrmStatusRow[] =>
  (Array.isArray(obj(body).data) ? (obj(body).data as unknown[]) : []).map(readStatusRow).filter((x): x is KeycrmStatusRow => x !== null);

// ---------- вебхук ----------

export type KeycrmWebhook = { event: string; keycrmId: number; statusId: number | null; sourceUuid: string | null; sourceId: number | null };

/** Тело вебхука KeyCRM: {event, context: {id, status_id, source_uuid, …}}. Не заказ — null. */
export function readKeycrmWebhook(body: unknown): KeycrmWebhook | null {
  const b = obj(body);
  const event = str(b.event, 100);
  if (event && !event.startsWith("order.")) return null;
  const c = readKeycrmOrder(b.context);
  if (!c) return null;
  return { event: event || "order", keycrmId: c.id, statusId: c.statusId, sourceUuid: c.sourceUuid, sourceId: c.sourceId };
}

// ---------- статусы ----------

/** Наш статус для статуса KeyCRM по таблице соответствия; не задан или «не менять» — null. */
export function mapKeycrmStatus(s: KeycrmSettings, statusId: number | null): string | null {
  if (!statusId) return null;
  const v = s.statusMap[String(statusId)];
  return v && KEYCRM_OUR_STATUSES.includes(v) ? v : null;
}

export const keycrmStatusName = (s: KeycrmSettings, statusId: number | null) =>
  statusId ? (s.statuses.find((x) => x.id === statusId)?.name ?? `№ ${statusId}`) : "—";

/** Подсказка для таблицы соответствия (владелец всё равно проверяет и сохраняет сам): по названию статуса KeyCRM. */
export function guessOurStatus(name: string, alias = ""): string {
  const t = `${name} ${alias}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/не\s*дозвон|недозвон|no[_\s-]?answer/, "NO_ANSWER"],
    [/поверн|возврат|return/, "RETURNED"],
    [/скасов|отмен|cancel/, "CANCELLED"],
    [/не\s*оплач|unpaid/, ""],
    [/очіку.*(постач|товар)|жд[её]м.*товар|під\s*замов|под\s*заказ|supplier/, "AWAITING_SUPPLIER"],
    [/оплач|paid/, "PAID"],
    [/зібран|собран|комплект|pack/, "PACKED"],
    [/відправл|отправл|в\s*дороз|в\s*пути|ship/, "SHIPPED"],
    [/викон|выполн|отриман|получен|заверш|done|complet/, "DONE"],
    [/^\s*(нов|new)/, "NEW"],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? "";
}

// ---------- очередь и повторы ----------

export const KEYCRM_MAX_ATTEMPTS = 8;
const DELAYS_MIN = [1, 2, 5, 10, 30, 60, 120];
/** Через сколько минут повторить после `attempts` неудачных попыток; попытки кончились — null (только кнопкой). */
export const keycrmRetryDelayMin = (attempts: number): number | null =>
  attempts >= KEYCRM_MAX_ATTEMPTS ? null : DELAYS_MIN[Math.max(0, Math.min(attempts - 1, DELAYS_MIN.length - 1))];

/** «Отправляется» дольше этого — прошлая попытка оборвалась (сайт перезапустили): можно брать снова. */
export const KEYCRM_SENDING_STALE_MIN = 3;

/** Как часто спрашивать KeyCRM о статусе заказа (запасной путь, пока вебхук не доходит — у сайта нет https-адреса). */
export const KEYCRM_POLL_MIN = 10;
/** Закрытые заказы и старше 60 дней не опрашиваем (вебхук по-прежнему работает). */
export const KEYCRM_POLL_DAYS = 60;
export const KEYCRM_CLOSED = ["DONE", "CANCELLED", "RETURNED"];

export const KEYCRM_STATE_RU: Record<string, string> = {
  queued: "ждёт отправки",
  sending: "отправляется",
  sent: "передан в KeyCRM",
  error: "ошибка отправки",
};
