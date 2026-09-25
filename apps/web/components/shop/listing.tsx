// Список товаров (раздел, подраздел, задача, поиск): заголовок, подразделы, быстрый выбор размера, фильтры, выбранные фильтры,
// сортировка, карточки, «Показати ще» и номера страниц. Серверный компонент; интерактивные части — в listing-client.tsx.
import Link from "next/link";
import { clearFilters, countWord, hasFilters, listingQuery, shopHref, toggleFacet, type ListingState } from "@handyman/core/site";
import type { ShopContent } from "@/lib/shop/content";
import { PER_PAGE, type ListingData, type ResolvedListing } from "@/lib/shop/listing";
import { contactLinks } from "./site-chrome";
import { FilterSheet, FilterSide, LoadMore, SortSelect, type FilterLabels } from "./listing-client";
import { Icon } from "./icons";
import { ProductCard, cardLabels } from "./product-card";
import { Breadcrumbs, Pager, btn } from "./ui";

export type ListingProps = {
  c: ShopContent;
  resolved: ResolvedListing;
  data: ListingData | null;
  state: ListingState;
  /** адрес страницы украинской версии без ?запроса (например, /catalog/dysky-ta-kruhy) */
  path: string;
  title: string;
  crumbs: Array<{ href?: string; label: string }>;
  /** чипы подразделов (на странице раздела и подраздела) */
  subs?: Array<{ label: string; href: string; count: number; current: boolean }>;
};

export function ProductListing({ c, resolved, data, state, path, title, crumbs, subs }: ListingProps) {
  const { t, lang } = c;
  const q = resolved.q;
  const base = shopHref(lang, path);
  const href = (s: ListingState) => `${base}${listingQuery(s, q)}`;
  const goods = (n: number) => countWord(c.texts, "goods", n);
  const head = (
    <>
      <Breadcrumbs label={t("crumbs.label")} items={crumbs} />
      <div className="hm-section-head">
        <h1 className="hm-h1">{title}</h1>
        {data && data.result.total > 0 && <p className="hm-muted">{goods(data.result.total)}</p>}
      </div>
      {subs && subs.length > 1 && (
        <ul className="hm-chips hm-chips-scroll" aria-label={t("listing.subs")}>
          {subs.map((s) => (
            <li key={s.href}>
              <Link className={`hm-chip${s.current ? " is-on" : ""}`} href={s.href} aria-current={s.current ? "page" : undefined}>
                {s.label} <em>{s.count}</em>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (!data) {
    return (
      <section className="hm-section">
        {head}
        <p className="hm-alert" role="alert">{t("search.unavailable")}</p>
      </section>
    );
  }

  const { result, cards, quick } = data;
  const labels: FilterLabels = {
    title: t("filters"), show: t("filters.show"), reset: t("filters.reset"), price: t("filters.price"), from: t("filters.from"), to: t("filters.to"),
    apply: t("filters.apply"), moreValues: t("filters.moreValues"), less: t("filters.less"), inStock: t("inStockOnly"), fast: t("filters.fast"), sale: t("onSale"), close: t("close"),
    goods: [t("unit.goods.one"), t("unit.goods.few"), t("unit.goods.many")],
  };
  const attrs = result.facets.attrs.filter((a) => a.key !== quick?.key);
  const panel = { lang, listingKey: resolved.key, base, q, state, attrs, price: result.facets.price, total: result.total, hasLocal: result.localCount > 0, labels };
  const sortOptions = [
    { value: "" as const, label: q ? t("category.sort.relevance") : t("sortDef") },
    { value: "price_asc" as const, label: t("sortPa") },
    { value: "price_desc" as const, label: t("sortPd") },
    { value: "new" as const, label: t("sortNew") },
    ...(q ? [{ value: "name" as const, label: t("sortName") }] : []),
  ];

  // выбранные фильтры чипами: нажатие убирает фильтр
  const labelOf = (key: string) => result.facets.attrs.find((a) => a.key === key)?.label.split(",")[0] ?? key;
  const chips: Array<{ text: string; href: string }> = [];
  for (const [key, values] of Object.entries(state.facets)) for (const v of values) chips.push({ text: `${labelOf(key)}: ${v}`, href: href(toggleFacet(state, key, v)) });
  if (state.available) chips.push({ text: t("inStockOnly"), href: href({ ...state, available: false, page: 1 }) });
  if (state.local) chips.push({ text: t("filters.fast"), href: href({ ...state, local: false, page: 1 }) });
  if (state.sale) chips.push({ text: t("onSale"), href: href({ ...state, sale: false, page: 1 }) });
  if (state.hit) chips.push({ text: t("home.hits.title"), href: href({ ...state, hit: false, page: 1 }) });
  if (state.isNew) chips.push({ text: t("home.new.title"), href: href({ ...state, isNew: false, page: 1 }) });
  if (state.min != null || state.max != null) {
    const noPrice: ListingState = { ...state, page: 1 };
    delete noPrice.min;
    delete noPrice.max;
    chips.push({ text: `${t("filters.price")} ${state.min ?? 0}–${state.max ?? "…"}`, href: href(noPrice) });
  }

  const help = contactLinks(c, t("help.call"));
  const cl = cardLabels(t);

  return (
    <section className="hm-section">
      {head}
      {result.correctedQuery && <p className="hm-alert">{t("search.corrected", { q: result.correctedQuery })}</p>}

      {quick && (
        <div className="hm-quick">
          <p className="hm-quick-title">{quick.key === "series" ? t("category.quick.battery") : t("category.quick.title", { name: quick.label })}</p>
          <ul className={`hm-quick-list${quick.values.length > 8 ? " hm-quick-scroll" : ""}`}>
            <li><Link className={!state.facets[quick.key] ? "is-on" : ""} href={href({ ...state, facets: Object.fromEntries(Object.entries(state.facets).filter(([k]) => k !== quick.key)), page: 1 })} scroll={false}>{t("category.quick.all")}</Link></li>
            {quick.values.map((v) => {
              const on = state.facets[quick.key]?.includes(v.value) ?? false;
              return (
                <li key={v.value}>
                  <Link className={on ? "is-on" : ""} href={href(toggleFacet(state, quick.key, v.value, true))} aria-current={on ? "true" : undefined} scroll={false}>
                    {v.value}<em>{v.count}</em>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="hm-listing">
        <FilterSide key={`side-${listingQuery(state, q)}`} {...panel} />
        <div className="hm-results">
          <div className="hm-toolbar">
            <FilterSheet key={`sheet-${listingQuery(state, q)}`} {...panel} />
            <SortSelect base={base} q={q} state={state} options={sortOptions} label={t("sort")} />
          </div>
          {chips.length > 0 && (
            <ul className="hm-chips" aria-label={t("filters.selected")}>
              {chips.map((ch) => (
                <li key={ch.href}><Link className="hm-chip" href={ch.href} aria-label={t("filters.remove", { name: ch.text })} scroll={false}>{ch.text} ✕</Link></li>
              ))}
              {hasFilters(state) && <li><Link className="hm-chip hm-chip-clear" href={href(clearFilters(state))} scroll={false}>{t("filters.reset")}</Link></li>}
            </ul>
          )}

          {cards.length === 0 ? (
            <div className="hm-empty">
              <h2 className="hm-h2">{q && !hasFilters(state) ? t("search.empty.title", { q }) : t("category.empty")}</h2>
              <p className="hm-muted">{q ? t("search.empty.text") : t("help.inline.text")}</p>
              <div className="hm-help-btns">
                {hasFilters(state) && <Link className={btn("primary")} href={href(clearFilters(state))}>{t("filters.reset")}</Link>}
                {help.map((h) => (
                  <a key={h.href} className={btn("secondary")} href={h.href} target={h.href.startsWith("http") ? "_blank" : undefined} rel="noopener">
                    <Icon name={h.icon} size={20} />{h.label}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <>
              <ul className="hm-grid">
                {cards.map((card, i) => <li key={card.id}><ProductCard card={card} labels={cl} priority={i < 2} /></li>)}
              </ul>
              <LoadMore
                key={listingQuery(state, q)}
                lang={lang}
                listingKey={resolved.key}
                query={listingQuery({ ...state, page: 1 })}
                page={result.page}
                pages={result.pages}
                total={result.total}
                shownFirst={cards.length}
                perPage={PER_PAGE}
                labels={{ card: cl, more: t("category.more"), loading: t("listing.loading"), shown: t("category.shown") }}
              />
              <Pager
                page={result.page}
                pages={result.pages}
                href={(p) => href({ ...state, page: p })}
                labels={{ nav: t("pager.label"), prev: t("pager.prev"), next: t("pager.next") }}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
