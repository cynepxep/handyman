// Баннеры и реклама: хранение, правка в админке, выбор для показа, счёт нажатий. Правила — @handyman/core/site (banners.ts).
import { prisma, type Prisma } from "./client";
import {
  bannerLive, parseBannerContent, parseBannerSettings, isPlacement,
  type BannerForm, type BannerPlacement, type BannerRow,
} from "@handyman/core/site";

type DbBanner = Prisma.BannerGetPayload<object>;
const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

/** Строка базы → баннер для витрины и админки. */
export function toBannerRow(b: DbBanner): BannerRow {
  return {
    id: b.id,
    name: b.name || b.titleUk,
    placement: (isPlacement(b.zone) ? b.zone : "home") as BannerPlacement,
    active: b.visible,
    sort: b.sort,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    clicks: b.clicks,
    content: parseBannerContent({
      titleUk: b.titleUk, titleRu: b.titleRu, textUk: b.textUk ?? "", textRu: b.textRu ?? "",
      buttonUk: b.buttonUk ?? "", buttonRu: b.buttonRu ?? "", href: b.linkTarget ?? "", image: b.imageDesktopUrl ?? "", theme: b.theme,
    }),
    settings: parseBannerSettings(b.settings),
  };
}

const dataOf = (v: BannerForm) => ({
  name: v.name, zone: v.placement, visible: v.active, sort: v.sort,
  startsAt: v.startsAt ? new Date(`${v.startsAt}T00:00:00`) : null,
  endsAt: v.endsAt ? new Date(`${v.endsAt}T00:00:00`) : null,
  titleUk: v.content.titleUk, titleRu: v.content.titleRu, // пустой русский — на сайте возьмётся украинский
  textUk: v.content.textUk || null, textRu: v.content.textRu || null,
  buttonUk: v.content.buttonUk || null, buttonRu: v.content.buttonRu || null,
  linkTarget: v.content.href || null, imageDesktopUrl: v.content.image || null, theme: v.content.theme,
  settings: json(v.settings),
});

export async function listBanners(): Promise<BannerRow[]> {
  const rows = await prisma.banner.findMany({ orderBy: [{ zone: "asc" }, { sort: "asc" }, { createdAt: "asc" }] });
  return rows.map(toBannerRow);
}

export async function getBanner(id: string): Promise<BannerRow | null> {
  const b = await prisma.banner.findUnique({ where: { id } });
  return b ? toBannerRow(b) : null;
}

/** Создать (id пустой) или изменить. */
export async function saveBanner(id: string | null, v: BannerForm, who: string): Promise<string> {
  const b = id
    ? await prisma.banner.update({ where: { id }, data: dataOf(v) })
    : await prisma.banner.create({ data: { ...dataOf(v), createdBy: who } });
  await prisma.auditLog.create({ data: { who, action: id ? "banner.edit" : "banner.create", target: b.id, details: json({ name: v.name, placement: v.placement, active: v.active }) } });
  return b.id;
}

export async function setBannerActive(id: string, active: boolean, who: string): Promise<void> {
  await prisma.$transaction([
    prisma.banner.update({ where: { id }, data: { visible: active } }),
    prisma.auditLog.create({ data: { who, action: active ? "banner.on" : "banner.off", target: id } }),
  ]);
}

export async function deleteBanner(id: string, who: string): Promise<void> {
  await prisma.$transaction([
    prisma.banner.delete({ where: { id } }),
    prisma.auditLog.create({ data: { who, action: "banner.delete", target: id } }),
  ]);
}

/** Все включённые баннеры (для витрины; сроки проверяет bannerLive при показе — кэш не мешает датам). */
export async function activeBanners(): Promise<BannerRow[]> {
  const rows = await prisma.banner.findMany({ where: { visible: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  return rows.map(toBannerRow);
}

/** Баннеры места, которые показываются прямо сейчас. */
export const liveOf = (all: BannerRow[], placement: BannerPlacement, now = new Date()) => all.filter((b) => b.placement === placement && bannerLive(b, now));

/** Нажатие на баннер: +1 и куда вести (ссылка берётся из базы, не из адреса — чужую подставить нельзя). */
export async function clickBanner(id: string): Promise<string | null> {
  try {
    const b = await prisma.banner.update({ where: { id }, data: { clicks: { increment: 1 } }, select: { linkTarget: true } });
    return b.linkTarget;
  } catch {
    return null;
  }
}
