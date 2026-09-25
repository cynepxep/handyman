// Баннеры для витрины: все включённые — в кэше (сброс при сохранении в «Реклама и баннеры», страховка — 5 минут);
// сроки показа проверяются при каждом показе (bannerLive), поэтому баннер «с понедельника» появится вовремя и при кэше.
import "server-only";
import { activeBanners, liveOf } from "@handyman/db/banners";
import { bannerForGroup, type BannerPlacement, type BannerRow } from "@handyman/core/site";
import { TAG_SHOP, cached } from "./cache";

const loadActive = cached(() => activeBanners(), "banners-active", [TAG_SHOP], 300);

/** Баннеры места, которые показываются сейчас; `groupId` — раздел страницы (баннеры, ограниченные другими разделами, не попадут). */
export async function bannersFor(placement: BannerPlacement, groupId?: string | null): Promise<BannerRow[]> {
  try {
    return liveOf(await loadActive(), placement).filter((b) => bannerForGroup(b, groupId));
  } catch (e) {
    console.error("[banners] не загрузились — показываем страницу без них", e instanceof Error ? e.message : e);
    return [];
  }
}
