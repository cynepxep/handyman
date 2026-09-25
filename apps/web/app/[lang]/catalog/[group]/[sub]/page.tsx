// Подраздел каталога: товары ровно тех категорий, что в меню лежат в этой подгруппе; соседние подразделы — чипами сверху.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { slugOf } from "@handyman/core/catalog";
import { isShopLang, parseListing, paths, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { getMenuView } from "@/lib/shop/catalog";
import { FACET_KEYS, resolveListing, runListing } from "@/lib/shop/listing";
import { ProductListing } from "@/components/shop/listing";

export async function generateMetadata({ params }: PageProps<"/[lang]/catalog/[group]/[sub]">): Promise<Metadata> {
  const { lang, group, sub } = await params;
  if (!isShopLang(lang)) return {};
  const c = await getShopContent(lang);
  const r = await resolveListing({ kind: "sub", group, sub }, c.menu);
  if (!r?.group || !r.sub) return {};
  return { title: c.pick(r.sub.nameUk, r.sub.nameRu), alternates: alternatesFor(lang, paths.sub(slugOf(r.group), slugOf(r.sub))) };
}

export default async function SubPage({ params, searchParams }: PageProps<"/[lang]/catalog/[group]/[sub]">) {
  const { lang, group, sub } = await params;
  if (!isShopLang(lang)) notFound();
  const c = await getShopContent(lang);
  const r = await resolveListing({ kind: "sub", group, sub }, c.menu);
  if (!r?.group || !r.sub) notFound();
  const g = r.group;
  const current = r.sub;
  const state = parseListing(await searchParams, FACET_KEYS);
  const [data, view] = await Promise.all([runListing(r, state, lang), getMenuView(c.menu)]);
  const gv = view.groups.find((x) => x.group.id === g.id);
  const subs = (gv?.subs ?? [])
    .filter((s) => !s.hidden && s.total > 0)
    .map((s) => ({ label: c.pick(s.nameUk, s.nameRu), href: shopHref(lang, paths.sub(slugOf(g), s.slug)), count: s.total, current: s.id === current.id }));
  const groupTitle = c.pick(g.nameUk, g.nameRu);
  const title = c.pick(current.nameUk, current.nameRu);

  return (
    <ProductListing
      c={c}
      resolved={r}
      data={data}
      state={state}
      path={paths.sub(slugOf(g), slugOf(current))}
      title={title}
      crumbs={[
        { href: shopHref(lang, paths.home()), label: c.t("crumbs.home") },
        { href: shopHref(lang, paths.catalog()), label: c.t("menu.title") },
        { href: shopHref(lang, paths.group(slugOf(g))), label: groupTitle },
        { label: title },
      ]}
      subs={subs}
    />
  );
}
