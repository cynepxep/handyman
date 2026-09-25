// Редактируемый контент сайта: тексты, контакты, страницы, меню и задачи.
// Логика правил — чистые функции в @handyman/core/site и /catalog; здесь только чтение и запись в базу.
// Пишет только то, что владелец правит в админке «Сайт»; каждое изменение попадает в журнал действий (AuditLog).

import { prisma, type Prisma } from "./client";
import {
  CONTACTS_SETTING_KEY, HOME_SETTING_KEY, TEXT_BY_KEY, parseHomeSettings, type HomeSettings, missingVars, normalizeTextEdit, parseContacts, resolveTexts, toDbLocale,
  type Contacts, type Lang, type TextOverrideRow,
} from "@handyman/core/site";
import { MENU_SETTING_KEY, defaultMenuConfig, parseMenuConfig, type MenuConfig } from "@handyman/core/catalog";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

// ---------- тексты ----------

export async function loadTextOverrides(): Promise<TextOverrideRow[]> {
  const rows = await prisma.textOverride.findMany();
  return rows.map((r) => ({ key: r.key, lang: r.lang, value: r.value }));
}

export type TextEdit = { key: string; lang: Lang; value: string };
export type SaveTextsResult = { ok: true; saved: number; reset: number } | { ok: false; error: string };

/**
 * Сохраняет правки текстов. Пустое поле или текст, равный стандартному, — «вернуть стандартный» (правка удаляется).
 * Нельзя потерять переменные вроде {n}: сайт подставляет в них числа.
 */
export async function saveTextEdits(edits: TextEdit[], who: string): Promise<SaveTextsResult> {
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  let saved = 0;
  let reset = 0;
  for (const e of edits) {
    const entry = TEXT_BY_KEY.get(e.key);
    if (!entry) continue;
    const value = normalizeTextEdit(e.key, e.lang, e.value);
    const locale = toDbLocale(e.lang);
    if (value === null) {
      ops.push(prisma.textOverride.deleteMany({ where: { key: e.key, lang: locale } }));
      reset++;
      continue;
    }
    const lost = missingVars(entry, value);
    if (lost.length) return { ok: false, error: `В тексте «${entry[e.lang].slice(0, 40)}…» пропало слово в фигурных скобках: ${lost.map((v) => `{${v}}`).join(", ")}. Оставьте его — сайт подставит туда число или название.` };
    ops.push(prisma.textOverride.upsert({ where: { key_lang: { key: e.key, lang: locale } }, update: { value }, create: { key: e.key, lang: locale, value } }));
    saved++;
  }
  if (ops.length === 0) return { ok: true, saved: 0, reset: 0 };
  ops.push(prisma.auditLog.create({ data: { who, action: "site.texts.edit", target: `${saved + reset} шт.`, details: { keys: edits.map((e) => `${e.key}:${e.lang}`).slice(0, 20) } } }));
  await prisma.$transaction(ops);
  return { ok: true, saved, reset };
}

// ---------- контакты ----------

export async function loadContacts(): Promise<Contacts> {
  const row = await prisma.setting.findUnique({ where: { key: CONTACTS_SETTING_KEY } });
  return parseContacts(row?.value);
}

export async function saveContacts(value: Contacts, who: string): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: CONTACTS_SETTING_KEY }, update: { value: json(value) }, create: { key: CONTACTS_SETTING_KEY, value: json(value) } }),
    prisma.auditLog.create({ data: { who, action: "site.contacts.edit", details: { phones: value.phones.length, hasAddress: Boolean(value.addressUk || value.addressRu) } } }),
  ]);
}

// ---------- страницы ----------

/** Стандартные страницы: их можно скрыть, но нельзя удалить (на них ссылается сайт). */
export const STANDARD_PAGES = ["delivery", "offer", "about", "contacts"] as const;
const SLUG = /^[a-z0-9-]{2,40}$/;
const clip = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");

export type PageInput = { titleUk: string; titleRu: string; bodyUk: string; bodyRu: string; inMenu: boolean; sort: number; visible: boolean };
export type PageResult = { ok: true } | { ok: false; error: string };

export const listPages = () => prisma.page.findMany({ orderBy: [{ sort: "asc" }, { slug: "asc" }] });
export const getPageBySlug = (slug: string) => prisma.page.findUnique({ where: { slug } });

function checkPage(input: PageInput): string | null {
  if (clip(input.titleUk, 120).length < 2 || clip(input.titleRu, 120).length < 2) return "У страницы должно быть название на обоих языках.";
  if (!Number.isInteger(input.sort)) return "Порядок должен быть целым числом.";
  return null;
}

const clean = (i: PageInput): PageInput => ({
  titleUk: clip(i.titleUk, 120), titleRu: clip(i.titleRu, 120), bodyUk: clip(i.bodyUk, 30000), bodyRu: clip(i.bodyRu, 30000),
  inMenu: i.inMenu, sort: i.sort, visible: i.visible,
});

export async function savePage(slug: string, input: PageInput, who: string): Promise<PageResult> {
  const err = checkPage(input);
  if (err) return { ok: false, error: err };
  const exists = await prisma.page.findUnique({ where: { slug }, select: { slug: true } });
  if (!exists) return { ok: false, error: "Страница не найдена." };
  await prisma.$transaction([
    prisma.page.update({ where: { slug }, data: clean(input) }),
    prisma.auditLog.create({ data: { who, action: "site.page.edit", target: slug } }),
  ]);
  return { ok: true };
}

export async function createPage(slug: string, input: PageInput, who: string): Promise<PageResult> {
  const s = slug.toLowerCase().trim();
  if (!SLUG.test(s)) return { ok: false, error: "Адрес страницы: латинские буквы, цифры и дефис, от 2 до 40 знаков (например, warranty)." };
  const err = checkPage(input);
  if (err) return { ok: false, error: err };
  if (await prisma.page.findUnique({ where: { slug: s }, select: { slug: true } })) return { ok: false, error: "Страница с таким адресом уже есть." };
  await prisma.$transaction([
    prisma.page.create({ data: { slug: s, ...clean(input) } }),
    prisma.auditLog.create({ data: { who, action: "site.page.create", target: s } }),
  ]);
  return { ok: true };
}

export async function deletePage(slug: string, who: string): Promise<PageResult> {
  if ((STANDARD_PAGES as readonly string[]).includes(slug)) return { ok: false, error: "Стандартные страницы нельзя удалить — их можно скрыть." };
  const found = await prisma.page.findUnique({ where: { slug }, select: { slug: true } });
  if (!found) return { ok: false, error: "Страница не найдена." };
  await prisma.$transaction([prisma.page.delete({ where: { slug } }), prisma.auditLog.create({ data: { who, action: "site.page.delete", target: slug } })]);
  return { ok: true };
}

// ---------- меню и задачи ----------

export async function loadMenuConfig(): Promise<MenuConfig> {
  const row = await prisma.setting.findUnique({ where: { key: MENU_SETTING_KEY } });
  return (row ? parseMenuConfig(row.value) : null) ?? defaultMenuConfig();
}

export async function hasCustomMenu(): Promise<boolean> {
  return (await prisma.setting.findUnique({ where: { key: MENU_SETTING_KEY }, select: { key: true } })) != null;
}

export async function saveMenuConfig(cfg: MenuConfig, who: string, note = "site.menu.edit"): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: MENU_SETTING_KEY }, update: { value: json(cfg) }, create: { key: MENU_SETTING_KEY, value: json(cfg) } }),
    prisma.auditLog.create({ data: { who, action: note, details: { groups: cfg.groups.length, tasks: cfg.tasks.length } } }),
  ]);
}

export async function resetMenuConfig(who: string): Promise<void> {
  await prisma.$transaction([
    prisma.setting.deleteMany({ where: { key: MENU_SETTING_KEY } }),
    prisma.auditLog.create({ data: { who, action: "site.menu.reset" } }),
  ]);
}

// ---------- главная (блоки и баннер) ----------

export async function loadHomeSettings(): Promise<HomeSettings> {
  const row = await prisma.setting.findUnique({ where: { key: HOME_SETTING_KEY } });
  return parseHomeSettings(row?.value);
}

export async function saveHomeSettings(value: HomeSettings, who: string): Promise<void> {
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: HOME_SETTING_KEY }, update: { value: json(value) }, create: { key: HOME_SETTING_KEY, value: json(value) } }),
    prisma.auditLog.create({ data: { who, action: "site.home.edit", details: { on: value.blocks.filter((b) => b.on).map((b) => b.id), banner: value.banner.on } } }),
  ]);
}

// ---------- всё сразу для витрины ----------

export type SiteContent = {
  texts: Record<string, string>;
  contacts: Contacts;
  menu: MenuConfig;
  pages: Array<{ slug: string; title: string; inMenu: boolean }>;
};

/** Всё, что нужно любой странице витрины, за один заход в базу. */
export async function loadSiteContent(lang: Lang): Promise<SiteContent> {
  const [overrides, contacts, menu, pages] = await Promise.all([
    loadTextOverrides(),
    loadContacts(),
    loadMenuConfig(),
    prisma.page.findMany({ where: { visible: true }, orderBy: [{ sort: "asc" }, { slug: "asc" }], select: { slug: true, titleUk: true, titleRu: true, inMenu: true } }),
  ]);
  return {
    texts: resolveTexts(overrides, lang),
    contacts,
    menu,
    pages: pages.map((p) => ({ slug: p.slug, title: lang === "uk" ? p.titleUk : p.titleRu, inMenu: p.inMenu })),
  };
}
