// Задача с главной («Різати метал», «Свердлити»): товары из категорий, которые владелец отнёс к задаче в «Сайт → Меню и задачи».
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { slugOf } from "@handyman/core/catalog";
import { isShopLang, listingQuery, parseListing, paths, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { FACET_KEYS, resolveListing, runListing } from "@/lib/shop/listing";
import { ProductListing } from "@/components/shop/listing";

export async function generateMetadata({ params }: PageProps<"/[lang]/task/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isShopLang(lang)) return {};
  const c = await getShopContent(lang);
  const r = await resolveListing({ kind: "task", task: slug }, c.menu);
  if (!r?.task) return {};
  return { title: c.pick(r.task.nameUk, r.task.nameRu), alternates: alternatesFor(lang, paths.task(slugOf(r.task))) };
}

export default async function TaskPage({ params, searchParams }: PageProps<"/[lang]/task/[slug]">) {
  const { lang, slug } = await params;
  if (!isShopLang(lang)) notFound();
  const c = await getShopContent(lang);
  const r = await resolveListing({ kind: "task", task: slug }, c.menu);
  if (!r?.task) notFound();
  const state = parseListing(await searchParams, FACET_KEYS);
  if (r.redirectTo) permanentRedirect(`${shopHref(lang, r.redirectTo)}${listingQuery(state)}`); // адрес сменили в админке
  const data = await runListing(r, state, lang);
  const title = c.pick(r.task.nameUk, r.task.nameRu);

  return (
    <ProductListing
      c={c}
      resolved={r}
      data={data}
      state={state}
      path={paths.task(slugOf(r.task))}
      title={title}
      crumbs={[
        { href: shopHref(lang, paths.home()), label: c.t("crumbs.home") },
        { href: `${shopHref(lang, paths.home())}#h-tasks`, label: c.t("home.tasks.title") },
        { label: title },
      ]}
    />
  );
}
