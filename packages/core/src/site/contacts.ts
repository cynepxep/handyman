// Контакты магазина: телефоны, адрес, график, соцсети. Хранятся в Setting (ключ site.contacts), правятся в админке.
// Пока не заполнено — на сайте показывается заглушка «Уточнюється», ничего не выдумываем.

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
};

export const EMPTY_CONTACTS: Contacts = {
  phones: [], email: "", addressUk: "", addressRu: "", hoursUk: "", hoursRu: "", howToUk: "", howToRu: "",
  telegram: "", viber: "", instagram: "", tiktok: "", facebook: "", youtube: "",
};

export const LINK_FIELDS = [
  { key: "telegram", label: "Telegram", hint: "https://t.me/ваш_магазин" },
  { key: "viber", label: "Viber", hint: "viber://chat?number=%2B380…  или https://…" },
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
      const allowed = f.key === "telegram" ? /^(https:\/\/|tg:\/\/)\S+$/i : f.key === "viber" ? /^(https:\/\/|viber:\/\/)\S+$/i : /^https:\/\/\S+$/i;
      if (!allowed.test(v)) return { ok: false, error: `Ссылка «${f.label}» должна начинаться с https:// (пример: ${f.hint}).` };
    }
    links[f.key] = v;
  }
  return {
    ok: true,
    value: {
      phones, email,
      addressUk: str(input.addressUk), addressRu: str(input.addressRu),
      hoursUk: str(input.hoursUk, 600), hoursRu: str(input.hoursRu, 600),
      howToUk: str(input.howToUk, 600), howToRu: str(input.howToRu, 600),
      telegram: links.telegram, viber: links.viber, instagram: links.instagram,
      tiktok: links.tiktok, facebook: links.facebook, youtube: links.youtube,
    },
  };
}

/** «+380 (48) 123-45-67» → «tel:+380481234567». */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("+") ? digits : `+${digits}`}`;
}

export const isContactsEmpty = (c: Contacts) =>
  c.phones.length === 0 && !c.email && !c.addressUk && !c.addressRu && !c.hoursUk && !c.hoursRu &&
  !c.telegram && !c.viber && !c.instagram && !c.tiktok && !c.facebook && !c.youtube;
