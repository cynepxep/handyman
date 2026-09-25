// Контакты магазина: телефоны, адрес, график, соцсети. Хранятся в Setting (ключ site.contacts), правятся в админке.
// Пока не заполнено — на сайте показывается заглушка «Уточнюється», ничего не выдумываем.

import { parseSchedule, parseScheduleForm, scheduleText, type WeekSchedule } from "./schedule";

export const CONTACTS_SETTING_KEY = "site.contacts";

export type Contacts = {
  phones: string[];
  email: string;
  addressUk: string;
  addressRu: string;
  hoursUk: string;
  hoursRu: string;
  howToUk: string;
  howToRu: string;
  telegram: string;
  viber: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  youtube: string;
  /** график выбором (Пн…Нд); из него собираются hoursUk/hoursRu. null — старый текстовый график */
  schedule: WeekSchedule | null;
};

export const EMPTY_CONTACTS: Contacts = {
  phones: [], email: "", addressUk: "", addressRu: "", hoursUk: "", hoursRu: "", howToUk: "", howToRu: "",
  telegram: "", viber: "", instagram: "", tiktok: "", facebook: "", youtube: "", schedule: null,
};

export const LINK_FIELDS = [
  { key: "telegram", label: "Telegram", hint: "@ваш_магазин, номер +380… или https://t.me/…" },
  { key: "viber", label: "Viber", hint: "номер +380 93 123 45 67 (ссылка сделается сама)" },
  { key: "instagram", label: "Instagram", hint: "https://instagram.com/…" },
  { key: "tiktok", label: "TikTok", hint: "https://tiktok.com/@…" },
  { key: "facebook", label: "Facebook", hint: "https://facebook.com/…" },
  { key: "youtube", label: "YouTube", hint: "https://youtube.com/@…" },
] as const;

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Читает сохранённые контакты (из JSON базы) без падений на чужих данных. */
export function parseContacts(raw: unknown): Contacts {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    phones: Array.isArray(o.phones) ? o.phones.map((p) => str(p, 30)).filter(Boolean).slice(0, 5) : [],
    email: str(o.email),
    addressUk: str(o.addressUk), addressRu: str(o.addressRu),
    hoursUk: str(o.hoursUk, 600), hoursRu: str(o.hoursRu, 600),
    howToUk: str(o.howToUk, 600), howToRu: str(o.howToRu, 600),
    telegram: str(o.telegram), viber: str(o.viber), instagram: str(o.instagram),
    tiktok: str(o.tiktok), facebook: str(o.facebook), youtube: str(o.youtube),
    schedule: parseSchedule(o.schedule),
  };
}

const PHONE = /^\+?[0-9][0-9 ()\-]{5,19}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactsResult = { ok: true; value: Contacts } | { ok: false; error: string };

/** Проверка формы из админки. Ошибки — понятными словами. Телефоны — по одному в строке. */
export function validateContactsForm(input: Record<string, string>): ContactsResult {
  const phones = (input.phones ?? "").split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (phones.length > 5) return { ok: false, error: "Телефонов может быть не больше пяти." };
  for (const p of phones) {
    if (!PHONE.test(p)) return { ok: false, error: `Телефон «${p}» записан неверно. Пример: +380 48 123 45 67` };
  }
  const email = str(input.email);
  if (email && !EMAIL.test(email)) return { ok: false, error: "E-mail записан неверно. Пример: shop@example.com" };

  const links: Record<string, string> = {};
  for (const f of LINK_FIELDS) {
    const v = str(input[f.key]);
    if (v) {
      const link = f.key === "telegram" || f.key === "viber" ? messengerLink(f.key, v) : v;
      if (link === null) {
        const how = f.key === "telegram" ? "номер телефона (+380 93 123 45 67), @имя или ссылку https://t.me/…" : "номер телефона (+380 93 123 45 67) или ссылку viber://…";
        return { ok: false, error: `${f.label}: не понимаю «${v}». Впишите ${how}` };
      }
      links[f.key] = link;
      const allowed = f.key === "telegram" ? /^(https:\/\/|tg:\/\/)\S+$/i : f.key === "viber" ? /^(https:\/\/|viber:\/\/)\S+$/i : /^https:\/\/\S+$/i;
      if (!allowed.test(link)) return { ok: false, error: `Ссылка «${f.label}» должна начинаться с https:// (пример: ${f.hint}).` };
    } else links[f.key] = "";
  }
  // график выбором (поля h.mon.from…): текст для сайта собирается сам
  let schedule: WeekSchedule | null = null;
  let hoursUk = str(input.hoursUk, 600);
  let hoursRu = str(input.hoursRu, 600);
  if (Object.keys(input).some((k) => k.startsWith("h.mon."))) {
    const h = parseScheduleForm(input, "h.");
    if (!h.ok) return { ok: false, error: `График: ${h.error}` };
    schedule = h.value;
    hoursUk = scheduleText(schedule, "uk");
    hoursRu = scheduleText(schedule, "ru");
  }
  return {
    ok: true,
    value: {
      phones, email,
      addressUk: str(input.addressUk), addressRu: str(input.addressRu),
      hoursUk, hoursRu, schedule,
      howToUk: str(input.howToUk, 600), howToRu: str(input.howToRu, 600),
      telegram: links.telegram, viber: links.viber, instagram: links.instagram,
      tiktok: links.tiktok, facebook: links.facebook, youtube: links.youtube,
    },
  };
}

/** Украинский номер в международном виде без «+»: «093 366 24 07» → «380933662407». Не номер — null. */
function intlDigits(v: string): string | null {
  if (!PHONE.test(v.trim())) return null;
  const d = v.replace(/\D/g, "");
  if (/^0\d{9}$/.test(d)) return `38${d}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/**
 * Ссылка на мессенджер из того, что вписал владелец: номер телефона, @имя (Telegram) или готовая ссылка.
 * Viber: «+380 93 366 24 07» → «viber://chat?number=%2B380933662407». Telegram: «@handyman» → «https://t.me/handyman»,
 * номер → «https://t.me/+380933662407», «t.me/handyman» → «https://t.me/handyman». Непонятное — null.
 */
export function messengerLink(kind: "viber" | "telegram", raw: string): string | null {
  const v = raw.trim();
  if (!v) return "";
  if (/^(https:\/\/|viber:\/\/|tg:\/\/)\S+$/i.test(v)) {
    if (kind === "viber" && /^tg:/i.test(v)) return null;
    if (kind === "telegram" && /^viber:/i.test(v)) return null;
    return v;
  }
  const phone = intlDigits(v);
  if (phone) return kind === "viber" ? `viber://chat?number=%2B${phone}` : `https://t.me/+${phone}`;
  if (kind === "telegram") {
    const m = /^(?:@|(?:https?:\/\/)?(?:t\.me|telegram\.me)\/)([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(v);
    if (m) return `https://t.me/${m[1]}`;
  }
  return null;
}

/**
 * Номер для ссылки «позвонить»: «+380 (48) 123-45-67» → «tel:+380481234567».
 * Украинские номера без кода страны тоже работают: «093 366 24 07» → «tel:+380933662407», «380…» → «tel:+380…».
 */
export function telHref(phone: string): string {
  const plus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (plus) return `tel:+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `tel:+38${digits}`;
  return `tel:+${digits}`;
}

export const isContactsEmpty = (c: Contacts) =>
  c.phones.length === 0 && !c.email && !c.addressUk && !c.addressRu && !c.hoursUk && !c.hoursRu &&
  !c.telegram && !c.viber && !c.instagram && !c.tiktok && !c.facebook && !c.youtube;
