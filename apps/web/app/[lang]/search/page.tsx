// Результаты поиска: исправление раскладки («rheu» → «круг»), фильтры и «Показати ще» — как в разделах каталога.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isShopLang, parseListing, paths, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { FACET_KEYS, resolveListing, runListing } from "@/lib/shop/listing";
import { ProductListing } from "@/components/shop/listing";
import { Breadcrumbs } from "@/components/shop/ui";

const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 100);

export async function generateMetadata({ params, searchParams }: PageProps<"/[lang]/search">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const q = one((await searchParams).q);
  const { t } = await getShopContent(lang);
  return { title: q ? t("search.results", { q }) : t("search.title"), alternates: alternatesFor(lang, paths.search(q || undefined)) };
}

export default async function SearchPage({ params, searchParams }: PageProps<"/[lang]/search">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const sp = await searchParams;
  const q = one(sp.q);
  const c = await getShopContent(lang);
  const { t } = c;
  const home = { href: shopHref(lang, paths.home()), label: t("crumbs.home") };

  if (!q) {
    const hints = t("home.hints").split(",").map((s) => s.trim()).filter(Boolean);
    return (
      <section className="hm-section">
        <Breadcrumbs label={t("crumbs.label")} items={[home, { label: t("search.title") }]} />
        <h1 className="hm-h1">{t("search.title")}</h1>
        <p className="hm-lead">{t("search.prompt")}</p>
        {hints.length > 0 && (
          <ul className="hm-chips">
            {hints.map((h) => <li key={h}><Link className="hm-chip" href={shopHref(lang, paths.search(h))}>{h}</Link></li>)}
          </ul>
        )}
      </section>
    );
  }

  const r = (await resolveListing({ kind: "search", q }, c.menu))!;
  const state = parseListing(sp, FACET_KEYS);
  const data = await runListing(r, state, lang);

  return (
    <ProductListing
      c={c}
      resolved={r}
      data={data}
      state={state}
      path="/search"
      title={t("search.results", { q })}
      crumbs={[home, { label: t("search.title") }]}
    />
  );
}
