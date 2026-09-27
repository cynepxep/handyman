// «Мій інструмент» (шаг 5.5): ссылки «Підходить до цього інструменту» — подгруппы меню с фильтром (диаметр круга, серия батареи).
// Правило «что к чему» — consumablesFor в core; здесь — адреса по меню из админки (удалённая/скрытая подгруппа — без ссылки).
import "server-only";
import { slugOf } from "@handyman/core/catalog";
import { paths, shopHref } from "@handyman/core/site";
import { consumablesFor, type ToolInfo } from "@handyman/core/shop";
import type { ShopContent } from "./content";

export type FitLink = { key: string; label: string; href: string };

export function fitLinks(c: ShopContent, tool: ToolInfo): FitLink[] {
  const out: FitLink[] = [];
  for (const l of consumablesFor(tool)) {
    const group = c.menu.groups.find((g) => g.id === l.groupId && !g.hidden);
    const sub = group?.subs.find((s) => s.id === l.subId && !s.hidden);
    if (!group || !sub) continue;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(l.facets ?? {})) qs.append(`f.${k}`, v);
    const q = qs.toString();
    const extra = l.facets?.diameter ? ` Ø${l.facets.diameter}` : l.facets?.series ? ` ${l.facets.series}` : "";
    out.push({ key: l.key, label: `${c.t(`cons.${l.key}`)}${extra}`, href: shopHref(c.lang, paths.sub(slugOf(group), slugOf(sub)) + (q ? `?${q}` : "")) });
  }
  return out;
}
