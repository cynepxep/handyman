// Результаты поиска: исправление раскладки («rheu» → «круг»), фильтры и «Показати ще» — как в разделах каталога.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasFilters, isShopLang, parseListing, paths, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { getSearchHints } from "@/lib/shop/search-hints";
import { logSearchSafely } from "@/lib/shop/search-log";
import { FACET_KEYS, resolveListing, runListing } from "@/lib/shop/listing";
import { ProductListing } from "@/components/shop/listing";
import { Breadcrumbs } from "@/components/shop/ui";

const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 100);

export async function generateMetadata({ params, searchParams }: PageProps<"/[lang]/search">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const sp = await searchParams;
  const q = one(sp.q);
  const { t } = await getShopContent(lang);
  const flag = one(sp.hit) === "1" ? t("home.hits.title") : one(sp.new) === "1" ? t("home.new.title") : one(sp.sale) === "1" ? t("home.sale.title") : "";
  return { title: q ? t("search.results", { q }) : flag || t("search.title"), alternates: alternatesFor(lang, paths.search(q || undefined)) };
}

export default async function SearchPage({ params, searchParams }: PageProps<"/[lang]/search">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const sp = await searchParams;
  const q = one(sp.q);
  const c = await getShopContent(lang);
  const { t } = c;
  const home = { href: shopHref(lang, paths.home()), label: t("crumbs.home") };
  const state = parseListing(sp, FACET_KEYS);
  // «Усі хіти» / «Усі новинки» / все акции (ссылки с главной и баннера) — список без текста поиска
  const flagTitle = state.hit ? t("home.hits.title") : state.isNew ? t("home.new.title") : state.sale ? t("home.sale.title") : hasFilters(state) ? t("search.title") : "";

  if (!q && !flagTitle) {
    const hints = await getSearchHints(c);
    return (
      <section className="hm-section">
        <Breadcrumbs label={t("crumbs.label")} items={[home, { label: t("search.title") }]} />
        <h1 className="hm-h1">{t("search.title")}</h1>
        <p className="hm-lead">{t("search.prompt")}</p>
        {hints.length > 0 && (
          <ul className="hm-chips">
            {hints.map((h) => <li key={h.text}><Link className="hm-chip" href={h.href ?? shopHref(lang, paths.search(h.text))}>{h.text}</Link></li>)}
          </ul>
        )}
      </section>
    );
  }

  const r = (await resolveListing({ kind: "search", q }, c.menu))!;
  const data = await runListing(r, state, lang);
  // запоминаем, что ищут покупатели (только первая страница без фильтров; сотрудников не считаем)
  if (q && data && state.page === 1 && !hasFilters(state) && !state.sort) await logSearchSafely(q, data.result.total);

  return (
    <ProductListing
      c={c}
      resolved={r}
      data={data}
      state={state}
      path="/search"
      title={q ? t("search.results", { q }) : flagTitle}
      crumbs={q ? [home, { label: t("search.title") }] : [home]}
    />
  );
}
