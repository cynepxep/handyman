// Баннеры и реклама на витрине (основа раздела админки «Реклама и баннеры»; полноценная реклама — следующие этапы).
// Баннер = место на сайте + содержимое (заголовок, текст, кнопка, картинка, цвет) + когда показывать (вкл/выкл, даты) + настройки места.
// Места перечислены здесь: новое место — новая запись в BANNER_PLACEMENTS и вывод на странице. Без зависимостей: работает и в браузере.

import { safeBannerHref, safeImageUrl } from "./home";

export type BannerPlacement = "home" | "listing" | "product";
export const BANNER_PLACEMENTS: Array<{ key: BannerPlacement; ru: string; hint: string }> = [
  { key: "home", ru: "Главная — большой баннер", hint: "на месте блока «Баннер акции» (его место и включение — в «Сайт → Главная»). Несколько баннеров — по очереди, по порядку" },
  { key: "listing", ru: "Списки товаров — плитка между товарами", hint: "в разделах, подразделах, задачах и поиске: после каждых N товаров. Можно ограничить разделами" },
  { key: "product", ru: "Страница товара", hint: "под ценой и кнопками «У кошик». Можно ограничить разделами" },
];
export const isPlacement = (v: unknown): v is BannerPlacement => BANNER_PLACEMENTS.some((p) => p.key === v);

export type BannerTheme = "light" | "yellow" | "dark";
export const BANNER_THEMES: Array<{ key: BannerTheme; ru: string }> = [
  { key: "light", ru: "Светлый (мягкий, как карточки)" },
  { key: "yellow", ru: "Жёлтый (фирменный, заметный)" },
  { key: "dark", ru: "Тёмный (графит)" },
];

/** Содержимое баннера (хранится JSON — поля можно добавлять без переделки базы). */
export type BannerContent = {
  titleUk: string; titleRu: string;
  textUk: string; textRu: string;
  buttonUk: string; buttonRu: string;
  /** куда ведёт: страница сайта «/…» или https:// */
  href: string;
  /** картинка: https:// или своя /media/… */
  image: string;
  theme: BannerTheme;
};

/** Настройки места. */
export type BannerSettings = {
  /** список товаров: после скольких товаров вставлять (4–48) */
  everyN: number;
  /** ограничить группами меню (коды групп); пусто — везде */
  groups: string[];
};

export type BannerRow = {
  id: string;
  name: string;
  placement: BannerPlacement;
  active: boolean;
  sort: number;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  content: BannerContent;
  settings: BannerSettings;
  clicks?: number;
};

export const DEFAULT_EVERY_N = 8;
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function parseBannerContent(raw: unknown): BannerContent {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const theme = BANNER_THEMES.some((t) => t.key === o.theme) ? (o.theme as BannerTheme) : "light";
  return {
    titleUk: str(o.titleUk, 120), titleRu: str(o.titleRu, 120),
    textUk: str(o.textUk), textRu: str(o.textRu),
    buttonUk: str(o.buttonUk, 40), buttonRu: str(o.buttonRu, 40),
    href: safeBannerHref(str(o.href)), image: safeMediaOrUrl(str(o.image)), theme,
  };
}

export function parseBannerSettings(raw: unknown): BannerSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = Math.floor(Number(o.everyN));
  return {
    everyN: Number.isFinite(n) && n >= 4 && n <= 48 ? n : DEFAULT_EVERY_N,
    groups: Array.isArray(o.groups) ? o.groups.filter((g): g is string => typeof g === "string" && /^[\w-]{1,60}$/.test(g)).slice(0, 50) : [],
  };
}

/** Картинка баннера: своя копия (/media/…) или https://. */
function safeMediaOrUrl(v: string): string {
  return /^\/media\/[0-9a-f]{2}\/[0-9a-f]{40}\.webp$/.test(v) ? v : safeImageUrl(v);
}

/** Сейчас показывается: включён, дата начала наступила, дата окончания не прошла (конец — включительно, до конца дня). */
export function bannerLive(b: Pick<BannerRow, "active" | "startsAt" | "endsAt">, now = new Date()): boolean {
  if (!b.active) return false;
  const t = now.getTime();
  if (b.startsAt && new Date(b.startsAt).getTime() > t) return false;
  if (b.endsAt && new Date(b.endsAt).getTime() + 24 * 3600_000 <= t) return false;
  return true;
}

/** Баннер относится к этому разделу (пустой список групп — ко всем). */
export const bannerForGroup = (b: Pick<BannerRow, "settings">, groupId?: string | null) =>
  b.settings.groups.length === 0 || (groupId != null && b.settings.groups.includes(groupId));

/**
 * Где в списке из `count` карточек стоят баннеры: после каждых everyN карточек очередной баннер (по кругу).
 * Возвращает пары «после какой карточки (индекс с нуля) — какой баннер». В конце списка баннер не ставим.
 */
export function listingSlots<T extends { settings: BannerSettings }>(count: number, banners: T[]): Array<{ after: number; banner: T }> {
  if (!banners.length || count < 2) return [];
  const every = Math.min(...banners.map((b) => b.settings.everyN));
  const out: Array<{ after: number; banner: T }> = [];
  for (let i = every, k = 0; i < count; i += every, k++) out.push({ after: i - 1, banner: banners[k % banners.length] });
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type BannerForm = {
  name: string; placement: BannerPlacement; active: boolean; sort: number;
  startsAt: string | null; endsAt: string | null;
  content: BannerContent; settings: BannerSettings;
};

/** Форма админки. `groupIds` — существующие группы меню (для ограничения разделами). Ошибки — понятными словами. */
export function validateBannerForm(input: Record<string, string | string[]>, groupIds: string[]): { ok: true; value: BannerForm } | { ok: false; error: string } {
  const one = (k: string) => { const v = input[k]; return Array.isArray(v) ? v[0] ?? "" : v ?? ""; };
  const placement = one("placement");
  if (!isPlacement(placement)) return { ok: false, error: "Выберите, где показывать баннер." };
  const href = one("href").trim();
  const image = one("image").trim();
  if (href && !safeBannerHref(href)) return { ok: false, error: "Ссылка: страница сайта, начиная с «/» (например, /catalog/…), или полный адрес с https://." };
  if (image && !safeMediaOrUrl(image)) return { ok: false, error: "Картинка: полный адрес с https:// (своё хранилище картинок для баннеров — в следующих этапах)." };
  const startsAt = one("startsAt").trim() || null;
  const endsAt = one("endsAt").trim() || null;
  if ((startsAt && !DATE.test(startsAt)) || (endsAt && !DATE.test(endsAt))) return { ok: false, error: "Даты — в виде ГГГГ-ММ-ДД (или оставьте пустыми)." };
  if (startsAt && endsAt && endsAt < startsAt) return { ok: false, error: "Дата окончания раньше даты начала." };
  const content = parseBannerContent({
    titleUk: one("titleUk"), titleRu: one("titleRu"), textUk: one("textUk"), textRu: one("textRu"),
    buttonUk: one("buttonUk"), buttonRu: one("buttonRu"), href, image, theme: one("theme"),
  });
  if (!content.titleUk) return { ok: false, error: "Впишите заголовок хотя бы по-украински." };
  if ((content.buttonUk || content.buttonRu) && !content.href) return { ok: false, error: "У кнопки нет ссылки — впишите, куда она ведёт." };
  const groupsRaw = Array.isArray(input.groups) ? input.groups : input.groups ? [input.groups] : [];
  const settings = parseBannerSettings({ everyN: one("everyN") || DEFAULT_EVERY_N, groups: groupsRaw.filter((g) => groupIds.includes(g)) });
  const sort = Math.max(0, Math.min(999, Math.floor(Number(one("sort")) || 0)));
  const name = str(one("name"), 80) || content.titleUk.slice(0, 80);
  return { ok: true, value: { name, placement, active: one("active") === "on", sort, startsAt, endsAt, content, settings } };
}
