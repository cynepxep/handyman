// Главная страница: какие блоки показывать и в каком порядке, баннер акции. Хранится в Setting["shop.home"],
// правится владельцем в админке «Сайт → Главная». Шапка с поиском и подсказками всегда первая и сюда не входит.

export const HOME_SETTING_KEY = "shop.home";

export const HOME_BLOCKS = ["banner", "tasks", "battery", "groups", "hits", "sale", "new", "viewed", "trust", "help"] as const;
export type HomeBlock = (typeof HOME_BLOCKS)[number];

/** Подписи блоков для админки (по-русски). */
export const HOME_BLOCK_RU: Record<HomeBlock, string> = {
  banner: "Баннер акции",
  tasks: "«Що потрібно зробити?» — задачи",
  battery: "«Яка у вас батарея?»",
  groups: "Разделы каталога",
  hits: "Хиты продаж (товары, отмеченные «Хит»)",
  sale: "Акции (товары со старой ценой)",
  new: "Новинки (товары, отмеченные «Новинка»)",
  viewed: "«Ви переглядали» (последние просмотренные покупателем)",
  trust: "Гарантия, возврат, доставка",
  help: "«Не знайшли? Підберемо» — кнопки связи",
};

export type HomeBanner = {
  on: boolean;
  titleUk: string; titleRu: string;
  textUk: string; textRu: string;
  buttonUk: string; buttonRu: string;
  /** куда ведёт кнопка: адрес на сайте (/catalog/…) или https://… */
  href: string;
  /** картинка по ссылке https://… (необязательно) */
  image: string;
};

export type HomeSettings = {
  /** блоки по порядку показа, с флагом «показывать» */
  blocks: Array<{ id: HomeBlock; on: boolean }>;
  banner: HomeBanner;
};

export const EMPTY_BANNER: HomeBanner = { on: false, titleUk: "", titleRu: "", textUk: "", textRu: "", buttonUk: "", buttonRu: "", href: "", image: "" };

export const DEFAULT_HOME: HomeSettings = {
  blocks: HOME_BLOCKS.map((id) => ({ id, on: true })),
  banner: EMPTY_BANNER,
};

const MAX_TEXT = 300;
const str = (v: unknown, max = MAX_TEXT) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Ссылка кнопки баннера: только адрес на сайте («/…») или https://. Иначе — пусто. */
export function safeBannerHref(v: string): string {
  const s = v.trim();
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s.slice(0, 300);
  if (/^https:\/\/[^\s]+$/i.test(s)) return s.slice(0, 300);
  return "";
}

/** Картинка баннера: только https://. */
export const safeImageUrl = (v: string) => (/^https:\/\/[^\s"'<>]+$/i.test(v.trim()) ? v.trim().slice(0, 500) : "");

/** Прочитать сохранённое. Незнакомые блоки выбрасываются, новые (появившиеся в коде позже) добавляются в конец включёнными. */
export function parseHomeSettings(raw: unknown): HomeSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const seen = new Set<HomeBlock>();
  const blocks: HomeSettings["blocks"] = [];
  if (Array.isArray(o.blocks)) {
    for (const b of o.blocks) {
      const id = (b as { id?: unknown })?.id;
      if (typeof id !== "string" || !(HOME_BLOCKS as readonly string[]).includes(id) || seen.has(id as HomeBlock)) continue;
      seen.add(id as HomeBlock);
      blocks.push({ id: id as HomeBlock, on: (b as { on?: unknown }).on !== false });
    }
  }
  for (const id of HOME_BLOCKS) if (!seen.has(id)) blocks.push({ id, on: true });
  const b = o.banner && typeof o.banner === "object" ? (o.banner as Record<string, unknown>) : {};
  const banner: HomeBanner = {
    on: b.on === true,
    titleUk: str(b.titleUk, 120), titleRu: str(b.titleRu, 120),
    textUk: str(b.textUk), textRu: str(b.textRu),
    buttonUk: str(b.buttonUk, 40), buttonRu: str(b.buttonRu, 40),
    href: safeBannerHref(str(b.href, 300)),
    image: safeImageUrl(str(b.image, 500)),
  };
  return { blocks, banner };
}

/** Баннер показывается, если включён и есть заголовок (на языке сайта или украинский). */
export function bannerVisible(b: HomeBanner): boolean {
  return b.on && b.titleUk.trim().length > 0;
}

export type HomeFormResult = { ok: true; value: HomeSettings } | { ok: false; error: string };

/**
 * Форма админки: `order.<id>` — число (порядок), `on.<id>` = "on", `banner.*` — поля баннера.
 * Ошибки — для владельца, по-русски.
 */
export function validateHomeForm(input: Record<string, string | undefined>): HomeFormResult {
  const rows = HOME_BLOCKS.map((id, i) => {
    const n = Number((input[`order.${id}`] ?? "").replace(",", "."));
    return { id, on: input[`on.${id}`] === "on", order: Number.isFinite(n) ? n : i + 1, i };
  });
  rows.sort((a, b) => a.order - b.order || a.i - b.i);
  const href = (input["banner.href"] ?? "").trim();
  const image = (input["banner.image"] ?? "").trim();
  if (href && !safeBannerHref(href)) return { ok: false, error: "Ссылка кнопки баннера: адрес на сайте, начиная с «/» (например, /catalog/…), или полный адрес с https://." };
  if (image && !safeImageUrl(image)) return { ok: false, error: "Картинка баннера: полный адрес картинки, начиная с https://." };
  const banner: HomeBanner = {
    on: input["banner.on"] === "on",
    titleUk: str(input["banner.titleUk"], 120), titleRu: str(input["banner.titleRu"], 120),
    textUk: str(input["banner.textUk"]), textRu: str(input["banner.textRu"]),
    buttonUk: str(input["banner.buttonUk"], 40), buttonRu: str(input["banner.buttonRu"], 40),
    href: safeBannerHref(href), image: safeImageUrl(image),
  };
  if (banner.on && !banner.titleUk) return { ok: false, error: "Чтобы включить баннер, впишите хотя бы заголовок по-украински." };
  if ((banner.buttonUk || banner.buttonRu) && !banner.href) return { ok: false, error: "У кнопки баннера нет ссылки — впишите, куда она ведёт." };
  return { ok: true, value: { blocks: rows.map(({ id, on }) => ({ id, on })), banner } };
}
