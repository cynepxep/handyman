// «Интеграции» (шаг 3.1): какие внешние сервисы есть, какие у них ключи, как ключи шифруются и как понять ответ проверки подключения.
// Чистая логика без базы и сети. Модуль использует node:crypto — свой вход `@handyman/core/integrations`, в браузер не импортировать.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type IntegrationField = {
  /** ключ поля внутри сервиса: telegram.botToken → «botToken» */
  key: string;
  label: string;
  /** переменная в .env, из которой значение берётся, если в базе его нет (старый способ) */
  env: string;
  /** секрет: показывается маской, в журнал не пишется */
  secret: boolean;
  hint?: string;
};

export type IntegrationDef = {
  id: IntegrationId;
  title: string;
  /** что даёт магазину — простыми словами */
  what: string;
  /** что работает без ключа */
  stub: string;
  fields: IntegrationField[];
  /** без каких полей проверка невозможна */
  required: string[];
};

export type IntegrationId = "telegram" | "novaposhta" | "mono" | "checkbox" | "keycrm" | "sms" | "backup";

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "telegram",
    title: "Telegram-бот",
    what: "Сообщения менеджерам о заказах и сводки, сообщения покупателям, вход на сайт через Telegram, Mini App, «повідомити про зниження ціни».",
    stub: "Сообщения сохраняются в заказе и «Уведомлениях», но никуда не уходят; вход через Telegram не работает.",
    fields: [
      { key: "botToken", label: "Токен бота", env: "BOT_TOKEN", secret: true, hint: "Выдаёт @BotFather в Telegram: строка вида 123456789:AA…" },
      { key: "adminChatId", label: "Чат менеджеров (ID)", env: "ADMIN_CHAT_ID", secret: false, hint: "Число; для группы начинается с «-». Сюда приходят заказы и сводки." },
    ],
    required: ["botToken"],
  },
  {
    id: "novaposhta",
    title: "Нова Пошта",
    what: "Создание ТТН кнопкой, печать наклейки, статусы посылок, стоимость и срок доставки (шаг 3.4).",
    stub: "Выбор города и отделения в оформлении работает и без ключа; ТТН — вручную в кабинете Новой Почты.",
    fields: [{ key: "apiKey", label: "API-ключ", env: "NOVAPOSHTA_KEY", secret: true, hint: "Бизнес-кабинет Новой Почты → Настройки → Безопасность → API-ключ." }],
    required: ["apiKey"],
  },
  {
    id: "mono",
    title: "Оплата monobank (интернет-эквайринг)",
    what: "Оплата картой на сайте: кнопка «Сплатити» на странице заказа (предоплата или вся сумма), счёт из карточки заказа, автоматически «Оплачен», возврат. Сайт сам спрашивает mono об оплате раз в минуту; когда появится https-адрес (PUBLIC_URL), mono будет сообщать сразу.",
    stub: "Ссылку на оплату присылает менеджер, оплату отмечает он же. На компьютере разработки — тестовая оплата кнопкой.",
    fields: [{ key: "token", label: "Токен мерчанта (X-Token)", env: "MONO_TOKEN", secret: true, hint: "Кабинет web.monobank.ua → Інтернет-еквайринг → токен. Не личный токен api.monobank.ua!" }],
    required: ["token"],
  },
  {
    id: "checkbox",
    title: "Checkbox (кассовые чеки)",
    what: "Кассовый чек сам после каждой оплаты картой на сайте (и чек возврата при возврате денег), чек вручную из заказа (наличные при самовывозе); ссылка на чек — покупателю в Telegram, на почту и на странице заказа. Смена кассира открывается сама перед первым чеком и закрывается в 23:00.",
    stub: "Чеки не создаются (на компьютере разработки — тестовые чеки, в налоговую не уходят).",
    fields: [
      { key: "licenseKey", label: "Ключ лицензии кассы", env: "CHECKBOX_LICENSE_KEY", secret: true, hint: "Кабинет Checkbox → Каси → ключ ліцензії." },
      { key: "login", label: "Логин кассира", env: "CHECKBOX_LOGIN", secret: false },
      { key: "password", label: "Пароль кассира", env: "CHECKBOX_PASSWORD", secret: true },
    ],
    required: ["licenseKey", "login", "password"],
  },
  {
    id: "keycrm",
    title: "KeyCRM",
    what: "Передача заказов в KeyCRM (новые заказы, «1 клік», «по звонку»; тестовые — только кнопкой), статусы из KeyCRM обратно на сайт. По умолчанию выключено — включается на странице «KeyCRM».",
    stub: "Заказы живут только в этой админке.",
    fields: [
      { key: "apiKey", label: "API-ключ", env: "KEYCRM_API_KEY", secret: true, hint: "KeyCRM → Налаштування → Загальні → API-ключ." },
      { key: "sourceId", label: "Источник заказа (ID)", env: "KEYCRM_SOURCE_ID", secret: false, hint: "Номер источника «Сайт» в KeyCRM — проверка покажет список." },
      { key: "webhookSecret", label: "Секрет вебхука", env: "KEYCRM_WEBHOOK_SECRET", secret: true, hint: "Любая строка от 16 знаков (буквы и цифры); она войдёт в адрес вебхука для KeyCRM." },
      { key: "npServiceId", label: "Служба «Нова Пошта» в KeyCRM (ID)", env: "KEYCRM_NP_SERVICE_ID", secret: false, hint: "Необязательно. С ним KeyCRM получает код отделения НП, а не только текст адреса." },
    ],
    required: ["apiKey"],
  },
  {
    id: "sms",
    title: "SMS (TurboSMS)",
    what: "Код для входа на сайт по SMS для тех, у кого нет Telegram.",
    stub: "На сервере вход по SMS скрыт, остаётся вход через Telegram.",
    fields: [
      { key: "token", label: "Токен API", env: "TURBOSMS_TOKEN", secret: true, hint: "Кабинет turbosms.ua → Настройки → API → токен." },
      { key: "sender", label: "Имя отправителя", env: "TURBOSMS_SENDER", secret: false, hint: "Зарегистрированное альфа-имя, например «Handyman»." },
    ],
    required: ["token", "sender"],
  },
  {
    id: "backup",
    title: "Резервные копии: второе хранилище (облако)",
    what: "Вторая копия базы, ключа шифрования и фото — в облачном хранилище (любое S3-совместимое: Cloudflare R2, Backblaze B2, Wasabi, Amazon S3…). Выгружается каждую ночь после копии на сервере; спасает, если сломается весь сервер. Список копий — в разделе «Резервные копии».",
    stub: "Копии хранятся только на этом компьютере/сервере: если он сломается целиком, пропадут и они.",
    fields: [
      { key: "endpoint", label: "Адрес хранилища (endpoint)", env: "BACKUP_S3_ENDPOINT", secret: false, hint: "Например https://<ID аккаунта>.r2.cloudflarestorage.com или https://s3.eu-central-003.backblazeb2.com — есть в кабинете хранилища." },
      { key: "bucket", label: "Корзина (bucket)", env: "BACKUP_S3_BUCKET", secret: false, hint: "Создайте в хранилище отдельную приватную корзину, например handyman-backups." },
      { key: "accessKey", label: "Ключ доступа (Access Key ID)", env: "BACKUP_S3_ACCESS_KEY", secret: true },
      { key: "secretKey", label: "Секретный ключ (Secret Access Key)", env: "BACKUP_S3_SECRET_KEY", secret: true, hint: "Показывается один раз при создании ключа. Ключу достаточно доступа только к этой корзине." },
      { key: "region", label: "Регион", env: "BACKUP_S3_REGION", secret: false, hint: "Необязательно: для R2 и Backblaze определяется по адресу; для Amazon S3 — например eu-central-1." },
    ],
    required: ["endpoint", "bucket", "accessKey", "secretKey"],
  },
];

export const integrationById = (id: string) => INTEGRATIONS.find((i) => i.id === id) ?? null;

/** Полный ключ хранения: «telegram.botToken». */
export type SecretKey = `${IntegrationId}.${string}`;
export const secretKey = (id: IntegrationId, field: string): SecretKey => `${id}.${field}`;

/** Маска для показа: «••••••1a2b» (последние 4 знака — только у длинных ключей, чтобы узнать «тот ли»). */
export function maskSecret(v: string): string {
  const s = v.trim();
  if (!s) return "";
  return s.length >= 12 ? `••••••${s.slice(-4)}` : "••••••";
}

// ---------- шифрование ----------

/** Ключ шифрования из строки любой длины (SECRETS_KEY или содержимое файла ключа) — 32 байта. */
export const deriveKey = (material: string) => createHash("sha256").update(`handyman-secrets:${material.trim()}`).digest();

/** AES-256-GCM: «v1:» + base64(iv 12 | tag 16 | шифр). Подделку или чужой ключ openSecret распознаёт. */
export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
}

/** Расшифровать; неверный ключ или испорченная строка — null. */
export function openSecret(sealed: string, key: Buffer): string | null {
  if (!sealed.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64");
    if (raw.length < 29) return null;
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------- проверка значений перед сохранением ----------

/** Понятная ошибка для владельца или null. Пустое значение не проверяем (оно значит «оставить как было»). */
export function validateField(id: IntegrationId, field: string, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length > 500 || /[\r\n]/.test(v)) return "Слишком длинное значение или перенос строки — скопируйте ключ ещё раз.";
  if (id === "telegram" && field === "botToken" && !/^\d{5,}:[\w-]{20,}$/.test(v)) return "Токен бота выглядит как «123456789:AA…» — скопируйте его из @BotFather целиком.";
  if (id === "telegram" && field === "adminChatId" && !/^-?\d{3,20}$/.test(v)) return "ID чата — число (для группы начинается с «-»).";
  if (id === "keycrm" && (field === "sourceId" || field === "npServiceId") && !/^\d{1,9}$/.test(v)) return field === "sourceId" ? "Источник KeyCRM — число." : "ID службы доставки — число.";
  if (id === "keycrm" && field === "webhookSecret" && weakWebhookSecret(v)) return "Секрет вебхука — не короче 16 знаков, только латинские буквы, цифры, «-» и «_», и не шаблон «change-me».";
  if (id === "sms" && field === "sender" && v.length > 11) return "Имя отправителя SMS — до 11 знаков.";
  if (id === "backup" && field === "endpoint" && !validStorageEndpoint(v)) return "Адрес хранилища — вида https://… (как в кабинете хранилища), без названия корзины в конце.";
  if (id === "backup" && field === "bucket" && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(v)) return "Название корзины — 3–63 знака: маленькие латинские буквы, цифры, «-» и «.».";
  if (id === "backup" && field === "region" && !/^[a-z0-9-]{2,40}$/.test(v)) return "Регион — латинские буквы, цифры и «-», например eu-central-1.";
  return null;
}

/** Адрес хранилища копий: https (http — только для своего компьютера, например MinIO в Docker), без пути. */
export function validStorageEndpoint(v: string): boolean {
  try {
    const u = new URL(v);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return (u.protocol === "https:" || (u.protocol === "http:" && local)) && (u.pathname === "/" || u.pathname === "") && !u.search && !u.username;
  } catch {
    return false;
  }
}

/** Секрет вебхука, который нельзя принимать: короткий, с символами, ломающими адрес, или шаблон из .env.example («change-me-too»). */
export const weakWebhookSecret = (v: string) => v.length < 16 || !/^[A-Za-z0-9_-]+$/.test(v) || /change-me/i.test(v);

// ---------- как понять ответ сервиса при проверке ----------

export type CheckResult = { ok: boolean; message: string };

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" ? (x as Json) : {});
const str = (x: unknown) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");

/** Telegram getMe (+ getChat, если задан чат менеджеров). */
export function readTelegramCheck(me: unknown, chat?: unknown): CheckResult {
  const m = obj(me);
  if (!m.ok) return { ok: false, message: `Telegram не принял токен: ${str(m.description) || "ошибка"}` };
  const bot = obj(m.result);
  let message = `Бот @${str(bot.username)} на связи.`;
  if (chat === undefined) return { ok: true, message: `${message} Чат менеджеров не задан — заказы в Telegram не придут.` };
  const c = obj(chat);
  if (!c.ok) return { ok: false, message: `${message} Но чат менеджеров недоступен: ${str(c.description) || "ошибка"}. Добавьте бота в чат и напишите в нём что-нибудь.` };
  const r = obj(c.result);
  message += ` Чат менеджеров: «${str(r.title) || [str(r.first_name), str(r.last_name)].filter(Boolean).join(" ") || str(r.id)}».`;
  return { ok: true, message };
}

/** Нова Пошта: Counterparty.getCounterparties (Sender) — отвечает только на верный ключ. */
export function readNovaPoshtaCheck(res: unknown): CheckResult {
  const r = obj(res);
  if (r.success === true) {
    const first = obj(Array.isArray(r.data) ? r.data[0] : null);
    const name = str(first.Description);
    return { ok: true, message: name ? `Ключ принят. Отправитель: ${name}.` : "Ключ принят." };
  }
  const errs = Array.isArray(r.errors) ? r.errors.map(str).filter(Boolean) : [];
  return { ok: false, message: `Нова Пошта не приняла ключ${errs.length ? `: ${errs.join("; ")}` : ""}.` };
}

/** monobank: GET /api/merchant/details. */
export function readMonoCheck(status: number, body: unknown): CheckResult {
  const b = obj(body);
  if (status === 200) return { ok: true, message: `Токен принят. Мерчант: ${str(b.merchantName) || str(b.merchantId) || "—"}.` };
  if (status === 401 || status === 403) return { ok: false, message: "monobank не принял токен. Нужен токен интернет-эквайринга из web.monobank.ua (не личный)." };
  return { ok: false, message: `monobank ответил ошибкой ${status}${str(b.errText) ? `: ${str(b.errText)}` : ""}.` };
}

/** Checkbox: POST /api/v1/cashier/signin. */
export function readCheckboxCheck(status: number, body: unknown): CheckResult {
  const b = obj(body);
  if (status >= 200 && status < 300 && str(b.access_token)) return { ok: true, message: "Кассир вошёл: логин, пароль и ключ кассы верные." };
  if (status === 401 || status === 403) return { ok: false, message: `Checkbox не принял логин или пароль кассира${str(b.message) ? `: ${str(b.message)}` : ""}.` };
  return { ok: false, message: `Checkbox ответил ошибкой ${status}${str(b.message) ? `: ${str(b.message)}` : ""}.` };
}

/** KeyCRM: GET /v1/order/source — список источников заказов. */
export function readKeycrmCheck(status: number, body: unknown, sourceId: string): CheckResult {
  if (status === 401 || status === 403) return { ok: false, message: "KeyCRM не принял API-ключ." };
  if (status !== 200) return { ok: false, message: `KeyCRM ответил ошибкой ${status}.` };
  const list = Array.isArray(obj(body).data) ? (obj(body).data as unknown[]).map(obj) : [];
  const names = list.map((s) => `${str(s.id)} — ${str(s.name)}`).slice(0, 8).join(", ");
  if (!sourceId) return { ok: true, message: `Ключ принят. Источник не задан; есть: ${names || "—"}.` };
  const found = list.find((s) => str(s.id) === sourceId);
  return found
    ? { ok: true, message: `Ключ принят. Источник: ${str(found.name)}.` }
    : { ok: false, message: `Ключ принят, но источника ${sourceId} нет. Есть: ${names || "—"}.` };
}

/** TurboSMS: POST /user/balance.json. */
export function readTurboSmsCheck(status: number, body: unknown): CheckResult {
  const b = obj(body);
  if (status === 200 && Number(b.response_code) === 0) {
    const bal = str(obj(b.response_result).balance);
    return { ok: true, message: `Токен принят.${bal ? ` Баланс: ${bal} грн.` : ""}` };
  }
  return { ok: false, message: `TurboSMS не принял токен${str(b.response_status) ? `: ${str(b.response_status)}` : ""}.` };
}
