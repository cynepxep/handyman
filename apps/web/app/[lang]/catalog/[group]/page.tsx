// Раздел каталога (группа меню): все товары подразделов, чипы подразделов, быстрый выбор размера, фильтры.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { slugOf } from "@handyman/core/catalog";
import { isShopLang, parseListing, paths, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { getMenuView } from "@/lib/shop/catalog";
import { FACET_KEYS, resolveListing, runListing } from "@/lib/shop/listing";
import { ProductListing } from "@/components/shop/listing";

export async function generateMetadata({ params }: PageProps<"/[lang]/catalog/[group]">): Promise<Metadata> {
  const { lang, group } = await params;
  if (!isShopLang(lang)) return {};
  const c = await getShopContent(lang);
  const r = await resolveListing({ kind: "group", group }, c.menu);
  if (!r?.group) return {};
  return { title: c.pick(r.group.nameUk, r.group.nameRu), alternates: alternatesFor(lang, paths.group(slugOf(r.group))) };
}

export default async function GroupPage({ params, searchParams }: PageProps<"/[lang]/catalog/[group]">) {
  const { lang, group } = await params;
  if (!isShopLang(lang)) notFound();
  const c = await getShopContent(lang);
  const r = await resolveListing({ kind: "group", group }, c.menu);
  if (!r?.group) notFound();
  const g = r.group;
  const state = parseListing(await searchParams, FACET_KEYS);
  const [data, view] = await Promise.all([runListing(r, state, lang), getMenuView(c.menu)]);
  const gv = view.groups.find((x) => x.group.id === g.id);
  const subs = (gv?.subs ?? [])
    .filter((s) => !s.hidden && s.total > 0)
    .map((s) => ({ label: c.pick(s.nameUk, s.nameRu), href: shopHref(lang, paths.sub(slugOf(g), s.slug)), count: s.total, current: false }));
  const title = c.pick(g.nameUk, g.nameRu);

  return (
    <ProductListing
      c={c}
      resolved={r}
      data={data}
      state={state}
      path={paths.group(slugOf(g))}
      title={title}
      crumbs={[
        { href: shopHref(lang, paths.home()), label: c.t("crumbs.home") },
        { href: shopHref(lang, paths.catalog()), label: c.t("menu.title") },
        { label: title },
      ]}
      subs={subs}
    />
  );
}
