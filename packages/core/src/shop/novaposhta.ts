// Нова Пошта (шаг 3.4) — чистая логика без базы и сети: настройки отправителя, статусы посылок и что они значат для заказа,
// тело запросов ТТН, разбор ответов НП, вес посылки, наложенный платёж, бесплатная доставка от суммы, отчёт по отказам.
// Формат API — api.novaposhta.ua/v2.0/json (модели Counterparty, InternetDocument, TrackingDocument); сверено с документацией НП,
// вживую не проверялось (в облаке НП закрыта) — см. CHANGELOG «Не проверено».

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- настройки (Setting «shop.np», админка «Нова Пошта → Настройки») ----------

export const NP_SETTING_KEY = "shop.np";

/** money — наложенный платёж (грошовий переказ); control — «Контроль оплати» (нужен договор с НП, деньги приходят на счёт ФОП). */
export type NpCodKind = "money" | "control";
export type NpLabelFormat = "100x100" | "85x85" | "a4";
export type NpPayer = "Recipient" | "Sender";
export type NpDims = { l: number; w: number; h: number };

export type NpSettings = {
  /** отправитель (контрагент) из кабинета НП */
  senderRef: string;
  senderName: string;
  /** контактное лицо отправителя и его телефон (+380…) */
  contactRef: string;
  contactName: string;
  senderPhone: string;
  /** город и отделение, откуда отправляем */
  cityRef: string;
  cityName: string;
  warehouseRef: string;
  warehouseName: string;
  /** посылка по умолчанию */
  weightKg: number;
  seats: number;
  dims: NpDims | null;
  description: string;
  /** как платит магазин, когда доставка за его счёт: наличными при сдаче или по договору (безнал) */
  senderPayMethod: "Cash" | "NonCash";
  codKind: NpCodKind;
  labelFormat: NpLabelFormat;
  /** менять статус заказа по статусу посылки («Отправлен», «Выполнен») */
  autoStatuses: boolean;
  /** сообщение покупателю «посылка в отделении» */
  arrivedMessage: boolean;
  /** тревога менеджерам: посылка лежит в отделении столько дней (0 — не напоминать) */
  stuckDays: number;
  /** после скольких отказов покупатель сам попадает в чёрный список (0 — только вручную) */
  refusalsToBlacklist: number;
};

export const DEFAULT_NP_SETTINGS: NpSettings = {
  senderRef: "", senderName: "", contactRef: "", contactName: "", senderPhone: "",
  cityRef: "", cityName: "", warehouseRef: "", warehouseName: "",
  weightKg: 2, seats: 1, dims: null, description: "Електроінструмент",
  senderPayMethod: "Cash", codKind: "money", labelFormat: "100x100",
  autoStatuses: true, arrivedMessage: true, stuckDays: 3, refusalsToBlacklist: 1,
};

const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isNpRef = (v: unknown): v is string => typeof v === "string" && REF.test(v);

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001F]/g, " ").trim().slice(0, max) : "");
const numIn = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/\s/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
};
const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);

function dimsOf(v: unknown): NpDims | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const l = numIn(o.l, 0, 1, 300), w = numIn(o.w, 0, 1, 300), h = numIn(o.h, 0, 1, 300);
  return l && w && h ? { l, w, h } : null;
}

/** Прочитать сохранённые настройки; чего нет или сломано — по умолчанию. */
export function parseNpSettings(raw: unknown): NpSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_NP_SETTINGS;
  const ref = (v: unknown) => (isNpRef(v) ? v : "");
  return {
    senderRef: ref(o.senderRef), senderName: str(o.senderName, 120),
    contactRef: ref(o.contactRef), contactName: str(o.contactName, 120), senderPhone: /^\+380\d{9}$/.test(String(o.senderPhone)) ? String(o.senderPhone) : "",
    cityRef: ref(o.cityRef), cityName: str(o.cityName, 120), warehouseRef: ref(o.warehouseRef), warehouseName: str(o.warehouseName, 200),
    weightKg: numIn(o.weightKg, d.weightKg, 0.1, 1000), seats: Math.round(numIn(o.seats, d.seats, 1, 20)), dims: dimsOf(o.dims),
    description: str(o.description, 100) || d.description,
    senderPayMethod: pick(o.senderPayMethod, ["Cash", "NonCash"] as const, d.senderPayMethod),
    codKind: pick(o.codKind, ["money", "control"] as const, d.codKind),
    labelFormat: pick(o.labelFormat, ["100x100", "85x85", "a4"] as const, d.labelFormat),
    autoStatuses: typeof o.autoStatuses === "boolean" ? o.autoStatuses : d.autoStatuses,
    arrivedMessage: typeof o.arrivedMessage === "boolean" ? o.arrivedMessage : d.arrivedMessage,
    stuckDays: Math.round(numIn(o.stuckDays, d.stuckDays, 0, 30)),
    refusalsToBlacklist: Math.round(numIn(o.refusalsToBlacklist, d.refusalsToBlacklist, 0, 20)),
  };
}

/** Чего не хватает для создания ТТН кнопкой (подписи — для админки). Пусто — можно. */
export function senderMissing(s: NpSettings): string[] {
  const miss: string[] = [];
  if (!s.senderRef) miss.push("отправитель");
  if (!s.contactRef || !s.senderPhone) miss.push("контактное лицо и телефон");
  if (!s.cityRef || !s.warehouseRef) miss.push("город и отделение отправки");
  return miss;
}

export type NpParcelForm = Pick<NpSettings, "weightKg" | "seats" | "dims" | "description" | "senderPayMethod" | "codKind" | "labelFormat" | "autoStatuses" | "arrivedMessage" | "stuckDays" | "refusalsToBlacklist">;

/** Форма «посылка по умолчанию и правила» (без отправителя — он выбирается из списков кабинета НП). Ошибки — по-русски. */
export function validateNpParcelForm(input: Record<string, string | undefined>): { ok: true; value: NpParcelForm } | { ok: false; error: string } {
  const n = (k: string) => Number(String(input[k] ?? "").replace(/\s/g, "").replace(",", "."));
  const weightKg = n("weightKg");
  if (!Number.isFinite(weightKg) || weightKg < 0.1 || weightKg > 1000) return { ok: false, error: "Вес посылки — от 0,1 до 1000 кг." };
  const seats = n("seats");
  if (!Number.isInteger(seats) || seats < 1 || seats > 20) return { ok: false, error: "Мест в посылке — целое число от 1 до 20." };
  const dl = String(input.dimL ?? "").trim(), dw = String(input.dimW ?? "").trim(), dh = String(input.dimH ?? "").trim();
  let dims: NpDims | null = null;
  if (dl || dw || dh) {
    dims = dimsOf({ l: dl, w: dw, h: dh });
    if (!dims) return { ok: false, error: "Размеры коробки — три числа от 1 до 300 см (или оставьте все три пустыми)." };
  }
  const description = str(input.description, 100);
  if (description.length < 3) return { ok: false, error: "Опишите содержимое посылки (например, «Електроінструмент»)." };
  const stuckDays = n("stuckDays");
  if (!Number.isInteger(stuckDays) || stuckDays < 0 || stuckDays > 30) return { ok: false, error: "Дни в отделении до напоминания — от 0 до 30 (0 — не напоминать)." };
  const refusals = n("refusalsToBlacklist");
  if (!Number.isInteger(refusals) || refusals < 0 || refusals > 20) return { ok: false, error: "Отказов до чёрного списка — от 0 до 20 (0 — только вручную)." };
  return {
    ok: true,
    value: {
      weightKg: round2(weightKg), seats, dims, description,
      senderPayMethod: input.senderPayMethod === "NonCash" ? "NonCash" : "Cash",
      codKind: input.codKind === "control" ? "control" : "money",
      labelFormat: pick(input.labelFormat, ["100x100", "85x85", "a4"] as const, "100x100"),
      autoStatuses: input.autoStatuses === "on", arrivedMessage: input.arrivedMessage === "on",
      stuckDays, refusalsToBlacklist: refusals,
    },
  };
}

// ---------- статусы посылки ----------

export type NpState = "created" | "transit" | "arrived" | "received" | "refused" | "deleted" | "unknown";
export const NP_FINAL_STATES: NpState[] = ["received", "refused", "deleted"];

export const NP_STATE_RU: Record<NpState, string> = {
  created: "создана, ещё не сдана",
  transit: "в пути",
  arrived: "в отделении",
  received: "получена",
  refused: "отказ / не забрал",
  deleted: "удалена",
  unknown: "номер не найден",
};

const STATE_BY_CODE: Record<string, NpState> = {
  "1": "created", "12": "created",
  "2": "deleted", "3": "unknown",
  "4": "transit", "41": "transit", "5": "transit", "6": "transit", "101": "transit", "104": "transit", "111": "transit", "112": "transit",
  "7": "arrived", "8": "arrived",
  "9": "received", "10": "received", "11": "received", "106": "received",
  "102": "refused", "103": "refused", "108": "refused", "105": "refused",
};

/** Код статуса НП → наш статус посылки (неизвестный код — «в пути», чтобы продолжать спрашивать). */
export const npStateOf = (code: string | number | null | undefined): NpState => STATE_BY_CODE[String(code ?? "").trim()] ?? (code ? "transit" : "unknown");

/** Коды для тестовых кнопок (НП не подключена): «принята», «прибыла», «получена», «отказ». */
export const NP_STUB_CODES: Record<"transit" | "arrived" | "received" | "refused", { code: string; text: string }> = {
  transit: { code: "5", text: "Відправлення прямує до міста одержувача (тест)" },
  arrived: { code: "7", text: "Прибув на відділення (тест)" },
  received: { code: "9", text: "Відправлення отримано (тест)" },
  refused: { code: "103", text: "Відмова одержувача (тест)" },
};

const BEFORE_SHIP = ["NEW", "NO_ANSWER", "AWAITING_SUPPLIER", "PAID", "PACKED"];

/** Какой статус поставить заказу по посылке: сдана/в пути → «Отправлен», получена → «Выполнен». Отмену и возврат не трогаем. */
export function autoOrderStatus(state: NpState, current: string): "SHIPPED" | "DONE" | null {
  if ((state === "transit" || state === "arrived") && BEFORE_SHIP.includes(current)) return "SHIPPED";
  if (state === "received" && (BEFORE_SHIP.includes(current) || current === "SHIPPED")) return "DONE";
  return null;
}

const DAY = 86400_000;

/**
 * Когда снова спросить НП: в пути — через час, создана (ещё не сдана) и «номер не найден» — через 2 часа, в отделении — через 3 часа.
 * Получена / отказ / удалена — больше не спрашиваем; старше 30 дней — тоже; «номер не найден» — не дольше 3 дней.
 */
export function npNextCheck(state: NpState, createdAt: Date, now: Date): Date | null {
  if (NP_FINAL_STATES.includes(state)) return null;
  const age = now.getTime() - createdAt.getTime();
  if (age > 30 * DAY || (state === "unknown" && age > 3 * DAY)) return null;
  const min = state === "transit" ? 60 : state === "arrived" ? 180 : 120;
  return new Date(now.getTime() + min * 60_000);
}

/** Посылка лежит в отделении дольше `days` дней (и напоминания ещё не было). */
export const isStuck = (arrivedAt: Date | null, days: number, now: Date) => !!arrivedAt && days > 0 && now.getTime() - arrivedAt.getTime() >= days * DAY;

// ---------- посылка: вес, наложенный платёж, бесплатная доставка ----------

/** Вес товара из характеристики фида («Вага»/«Маса»: «2,5 кг», «850 г», «1.2»), кг. Не вес — null. */
export function weightKgFromAttr(key: string, value: string): number | null {
  const k = key.trim().toLowerCase();
  if (!/^(вага|маса|вес)(?![а-яіїєґa-z])/.test(k) || /акумулятор|батаре|без(?![а-яіїєґa-z])/.test(k)) return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(value);
  if (!m) return null;
  let n = Number(m[1].replace(",", "."));
  const unit = `${k} ${value.toLowerCase()}`;
  const gram = /(^|[^а-яіїєґa-z])(г|гр|грам[а-яіїє]*|g)\.?($|[^а-яіїєґa-z])/.test(unit);
  if (gram && !/кг|kg/.test(unit)) n /= 1000;
  return n > 0.005 && n <= 300 ? Math.round(n * 1000) / 1000 : null;
}

/**
 * Вес посылки: сумма веса товаров × 1,1 (коробка), вверх до 0,1 кг. Если у части товаров вес неизвестен —
 * не меньше веса «по умолчанию» из настроек; если неизвестен у всех — вес по умолчанию.
 */
export function parcelWeightKg(lines: Array<{ kg: number | null; qty: number }>, defaultKg: number): number {
  const known = lines.filter((l) => l.kg != null);
  if (!known.length) return defaultKg;
  const sum = Math.ceil(known.reduce((a, l) => a + (l.kg as number) * l.qty, 0) * 1.1 * 10) / 10;
  const w = Math.max(0.1, sum);
  return known.length < lines.length ? Math.max(w, defaultKg) : w;
}

/**
 * Наложенный платёж по умолчанию: предоплата — остаток (итог − оплачено, не меньше предоплаты); «уточнит менеджер» — всё неоплаченное;
 * полная оплата и по реквизитам — 0 (платят до отправки). Менеджер может поправить в форме ТТН.
 */
export function codDefault(o: { payMode: string; total: number; dueNow: number; paidAmount: number }): number {
  if (o.payMode === "PREPAY") return round2(Math.max(0, o.total - Math.max(o.paidAmount, o.dueNow)));
  if (o.payMode === "LATER") return round2(Math.max(0, o.total - o.paidAmount));
  return 0;
}

/** Бесплатная доставка НП от суммы (0 — выключено). */
export const isNpFree = (total: number, freeFrom: number) => freeFrom > 0 && total >= freeFrom;
/** Сколько ещё добрать до бесплатной доставки (0 — уже бесплатно или порога нет). */
export const npFreeLeft = (total: number, freeFrom: number) => (freeFrom > 0 && total < freeFrom ? Math.ceil(freeFrom - total) : 0);

/** В чёрном списке можно только полную оплату (на сайте или по реквизитам) — без остатка при получении. */
export const blacklistAllowsPay = (pay: string) => pay === "full" || pay === "card";
export const shouldBlacklist = (refusals: number, threshold: number) => threshold > 0 && refusals >= threshold;

// ---------- форма ТТН в заказе ----------

export type TtnForm = { weight: number; seats: number; dims: NpDims | null; declared: number; payer: NpPayer; cod: number; description: string };

export function defaultTtnForm(
  o: { payMode: string; total: number; dueNow: number; paidAmount: number; npFreeShipping: boolean },
  s: NpSettings,
  weightKg: number,
): TtnForm {
  return {
    weight: weightKg, seats: s.seats, dims: s.dims, declared: Math.max(1, Math.round(o.total)),
    payer: o.npFreeShipping ? "Sender" : "Recipient", cod: codDefault(o), description: s.description,
  };
}

/** Проверка формы «Создать ТТН». `maxCod` — сумма заказа (наложенный платёж не больше). */
export function validateTtnForm(input: Record<string, string | undefined>, maxCod: number): { ok: true; value: TtnForm } | { ok: false; error: string } {
  const n = (k: string) => Number(String(input[k] ?? "").replace(/\s/g, "").replace(",", ".") || "0");
  const weight = n("weight");
  if (!Number.isFinite(weight) || weight < 0.1 || weight > 1000) return { ok: false, error: "Вес — от 0,1 до 1000 кг." };
  const seats = n("seats");
  if (!Number.isInteger(seats) || seats < 1 || seats > 20) return { ok: false, error: "Мест — от 1 до 20." };
  const declared = n("declared");
  if (!Number.isFinite(declared) || declared < 1 || declared > 1_000_000) return { ok: false, error: "Оценочная стоимость — от 1 ₴." };
  const cod = n("cod");
  if (!Number.isFinite(cod) || cod < 0 || cod > maxCod + 0.005) return { ok: false, error: `Наложенный платёж — от 0 до суммы заказа (${maxCod} ₴).` };
  const description = str(input.description, 100);
  if (description.length < 3) return { ok: false, error: "Опишите содержимое посылки." };
  const dl = String(input.dimL ?? "").trim(), dw = String(input.dimW ?? "").trim(), dh = String(input.dimH ?? "").trim();
  let dims: NpDims | null = null;
  if (dl || dw || dh) {
    dims = dimsOf({ l: dl, w: dw, h: dh });
    if (!dims) return { ok: false, error: "Размеры — три числа от 1 до 300 см (или все пустые)." };
  }
  return { ok: true, value: { weight: round2(weight), seats, dims, declared: Math.round(declared), payer: input.payer === "Sender" ? "Sender" : "Recipient", cod: round2(cod), description } };
}

// ---------- запросы к НП ----------

/** +380XXXXXXXXX → 380XXXXXXXXX (так телефоны в API НП). */
export const npPhone = (e164: string) => e164.replace(/\D/g, "");

/** «Прізвище Ім'я По батькові» → части для НП (из одного слова — и фамилия, и имя). */
export function recipientNames(full: string | null | undefined): { lastName: string; firstName: string; middleName: string } {
  const w = String(full ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return { lastName: w[0] ?? "", firstName: w[1] ?? w[0] ?? "", middleName: w.slice(2).join(" ") };
}

export function counterpartyProps(full: string | null | undefined, phone: string): Record<string, string> {
  const n = recipientNames(full);
  return { CounterpartyProperty: "Recipient", CounterpartyType: "PrivatePerson", FirstName: n.firstName, LastName: n.lastName, MiddleName: n.middleName, Phone: npPhone(phone), Email: "" };
}

/** Дата для НП «дд.мм.гггг» по Киеву. */
export function npToday(now = new Date()): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-");
  return `${d}.${m}.${y}`;
}

/** Тело InternetDocument.save: из отделения в отделение/почтомат, наложенный платёж или контроль оплаты, номер заказа в «Додаткова інформація». */
export function ttnProps(p: {
  s: NpSettings; form: TtnForm; date: string; orderNo: string;
  recipient: { ref: string; contactRef: string; phone: string; cityRef: string; pointRef: string };
}): Record<string, unknown> {
  const { s, form, recipient: r } = p;
  const props: Record<string, unknown> = {
    PayerType: form.payer, PaymentMethod: form.payer === "Sender" ? s.senderPayMethod : "Cash", DateTime: p.date,
    CargoType: "Parcel", Weight: String(form.weight), ServiceType: "WarehouseWarehouse", SeatsAmount: String(form.seats),
    Description: form.description, Cost: String(form.declared),
    CitySender: s.cityRef, Sender: s.senderRef, SenderAddress: s.warehouseRef, ContactSender: s.contactRef, SendersPhone: npPhone(s.senderPhone),
    CityRecipient: r.cityRef, Recipient: r.ref, RecipientAddress: r.pointRef, ContactRecipient: r.contactRef, RecipientsPhone: npPhone(r.phone),
    InfoRegClientBarcodes: p.orderNo, AdditionalInformation: `Замовлення ${p.orderNo}`,
  };
  if (form.dims) {
    const each = round2(form.weight / form.seats);
    props.OptionsSeat = Array.from({ length: form.seats }, () => ({
      volumetricLength: String(form.dims!.l), volumetricWidth: String(form.dims!.w), volumetricHeight: String(form.dims!.h), weight: String(each),
    }));
  }
  if (form.cod > 0) {
    if (s.codKind === "control") props.AfterpaymentOnGoodsCost = String(form.cod);
    else props.BackwardDeliveryData = [{ PayerType: "Recipient", CargoType: "Money", RedeliveryString: String(form.cod) }];
  }
  return props;
}

// ---------- разбор ответов НП ----------

type Envelope = { success?: unknown; data?: unknown; errors?: unknown; warnings?: unknown };
const env = (b: unknown): Envelope => (b && typeof b === "object" ? (b as Envelope) : {});
const firstData = (b: unknown): Record<string, unknown> | null => {
  const e = env(b);
  if (e.success !== true || !Array.isArray(e.data) || !e.data[0] || typeof e.data[0] !== "object") return null;
  return e.data[0] as Record<string, unknown>;
};

const KNOWN_ERRORS: Array<[RegExp, string]> = [
  [/api ?key|auth/i, "Нова Пошта не приняла API-ключ — проверьте его в «Интеграциях»."],
  [/RecipientsPhone|Phone.*(invalid|incorrect)/i, "Нова Пошта не приняла телефон получателя — проверьте номер в заказе."],
  [/FirstName|LastName|MiddleName/i, "Нова Пошта не приняла имя получателя: нужны фамилия и имя кириллицей (исправьте в заказе)."],
  [/RecipientAddress|Warehouse/i, "Отделение получателя не подходит (закрыто или не принимает такой вес/габариты) — выберите другое."],
  [/Weight|weight/, "Вес или габариты не подходят для этого отделения/почтомата."],
  [/Sender|ContactSender|CitySender/i, "Нова Пошта не приняла отправителя — проверьте «Нова Пошта → Настройки»."],
];

/** Понятный текст ошибки НП для менеджера (по-русски) + исходный текст НП. */
export function npErrorText(body: unknown): string {
  const e = env(body);
  const raw = [...(Array.isArray(e.errors) ? e.errors : []), ...(e.errors && typeof e.errors === "object" && !Array.isArray(e.errors) ? Object.values(e.errors) : [])]
    .map((x) => String(x)).filter(Boolean).join("; ").slice(0, 300);
  if (!raw) return "Нова Пошта ответила ошибкой без пояснения — попробуйте ещё раз позже.";
  const known = KNOWN_ERRORS.find(([re]) => re.test(raw));
  return known ? `${known[1]} (НП: ${raw})` : `Нова Пошта: ${raw}`;
}

/** Контрагент-получатель из Counterparty.save: его Ref и Ref контактного лица. */
export function readCounterparty(body: unknown): { ref: string; contactRef: string } | null {
  const d = firstData(body);
  if (!d || !isNpRef(d.Ref)) return null;
  const cp = d.ContactPerson as { data?: Array<{ Ref?: unknown }> } | undefined;
  const contact = cp?.data?.[0]?.Ref;
  return isNpRef(contact) ? { ref: d.Ref, contactRef: contact } : null;
}

/** Дата из ответа НП: «2026-09-29 00:00:00», «29.09.2026», «29-09-2026 17:00:00» → полдень по Киеву этого дня (для показа даты). */
export function npDate(v: unknown): Date | null {
  const s = typeof v === "string" ? v.trim() : "";
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 9));
  m = /^(\d{2})[.-](\d{2})[.-](\d{4})/.exec(s);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 9));
  return null;
}

/** Созданная ТТН из InternetDocument.save. */
export function readTtnSave(body: unknown): { ref: string; ttn: string; cost: number | null; estDate: Date | null } | null {
  const d = firstData(body);
  if (!d || !isNpRef(d.Ref) || !/^\d{10,20}$/.test(String(d.IntDocNumber ?? ""))) return null;
  const cost = Number(d.CostOnSite);
  return { ref: d.Ref, ttn: String(d.IntDocNumber), cost: Number.isFinite(cost) && cost >= 0 ? cost : null, estDate: npDate(d.EstimatedDeliveryDate) };
}

export type NpTrack = { ttn: string; code: string; text: string; scheduled: Date | null; cost: number | null };

/** Статусы из TrackingDocument.getStatusDocuments. */
export function readTracking(body: unknown): NpTrack[] {
  const e = env(body);
  if (e.success !== true || !Array.isArray(e.data)) return [];
  return (e.data as Array<Record<string, unknown>>)
    .filter((d) => d && /^\d{10,20}$/.test(String(d.Number ?? "")))
    .map((d) => {
      const cost = Number(d.DocumentCost);
      return {
        ttn: String(d.Number), code: String(d.StatusCode ?? ""), text: String(d.Status ?? "").slice(0, 300),
        scheduled: npDate(d.ScheduledDeliveryDate), cost: Number.isFinite(cost) && cost > 0 ? cost : null,
      };
    });
}

/** Стоимость доставки из InternetDocument.getDocumentPrice, ₴. */
export function readPrice(body: unknown): number | null {
  const d = firstData(body);
  const c = Number(d?.Cost);
  return d && Number.isFinite(c) && c >= 0 ? c : null;
}

/** Ориентировочная дата из InternetDocument.getDocumentDeliveryDate. */
export function readDeliveryDate(body: unknown): Date | null {
  const d = firstData(body);
  const v = d?.DeliveryDate;
  return npDate(v && typeof v === "object" ? (v as { date?: unknown }).date : v);
}

/** Отправители (контрагенты) и контактные лица из кабинета НП — для выбора в настройках. */
export function readRefList(body: unknown): Array<{ ref: string; name: string; phone: string }> {
  const e = env(body);
  if (e.success !== true || !Array.isArray(e.data)) return [];
  return (e.data as Array<Record<string, unknown>>)
    .filter((d) => d && isNpRef(d.Ref))
    .map((d) => ({ ref: String(d.Ref), name: String(d.Description ?? [d.LastName, d.FirstName, d.MiddleName].filter(Boolean).join(" ")).slice(0, 120), phone: String(d.Phones ?? "").replace(/\D/g, "") }));
}

// ---------- печать ----------

export const DEFAULT_NP_PRINT_BASE = "https://my.novaposhta.ua";

/** Адрес PDF у НП: наклейка (маркировка 100×100 / 85×85) или экспресс-накладная A4. Содержит ключ — только для запроса с сервера. */
export function npPrintUrl(p: { base?: string | null; kind: "label" | "document"; format: NpLabelFormat; ref: string; apiKey: string }): string {
  const base = (p.base?.trim() || DEFAULT_NP_PRINT_BASE).replace(/\/+$/, "");
  const what = p.kind === "document" || p.format === "a4" ? "printDocument" : p.format === "85x85" ? "printMarking85x85" : "printMarking100x100";
  return `${base}/orders/${what}/orders[]/${p.ref}/type/pdf/apiKey/${encodeURIComponent(p.apiKey)}`;
}

// ---------- отчёт по отказам ----------

export type RefusalStats = { total: number; received: number; refused: number; inWork: number; refusedPct: number };

/** Сколько посылок получено / отказов / ещё в пути; доля отказов — от завершённых (получено + отказ). */
export function refusalStats(rows: Array<{ state: string }>): RefusalStats {
  const live = rows.filter((r) => r.state !== "deleted");
  const received = live.filter((r) => r.state === "received").length;
  const refused = live.filter((r) => r.state === "refused").length;
  const done = received + refused;
  return { total: live.length, received, refused, inWork: live.length - done, refusedPct: done ? Math.round((refused / done) * 1000) / 10 : 0 };
}
