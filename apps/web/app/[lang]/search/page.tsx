// Результаты поиска: исправление раскладки («rheu» → «круг»), «ничего не найдено» с советом, номера страниц.
// Фильтры и «Показати ще» с догрузкой — вместе со страницей раздела каталога (шаг 2.5).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SearchUnavailableError, searchProducts } from "@handyman/db/catalog-search";
import { countWord, isShopLang, paths, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { toCards } from "@/lib/shop/catalog";
import { Icon } from "@/components/shop/icons";
import { ProductCard } from "@/components/shop/product-card";
import { contactLinks } from "@/components/shop/site-chrome";
import { Breadcrumbs, Pager, btn } from "@/components/shop/ui";

const PER_PAGE = 24;

type SP = { q?: string | string[]; page?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function generateMetadata({ params, searchParams }: PageProps<"/[lang]/search">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const q = one((await searchParams as SP).q).trim().slice(0, 100);
  const { t } = await getShopContent(lang);
  return { title: q ? t("search.results", { q }) : t("search.title"), alternates: alternatesFor(lang, paths.search(q || undefined)) };
}

export default async function SearchPage({ params, searchParams }: PageProps<"/[lang]/search">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const sp = (await searchParams) as SP;
  const q = one(sp.q).trim().slice(0, 100);
  const page = Math.max(1, Math.min(500, Math.floor(Number(one(sp.page)) || 1)));
  const c = await getShopContent(lang);
  const { t } = c;
  const crumbs = <Breadcrumbs label={t("crumbs.label")} items={[{ href: shopHref(lang, paths.home()), label: t("crumbs.home") }, { label: t("search.title") }]} />;
  const hints = t("home.hints").split(",").map((s) => s.trim()).filter(Boolean);
  const hintChips = hints.length > 0 && (
    <ul className="hm-chips">
      {hints.map((h) => <li key={h}><Link className="hm-chip" href={shopHref(lang, paths.search(h))}>{h}</Link></li>)}
    </ul>
  );

  if (!q) {
    return (
      <section className="hm-section">
        {crumbs}
        <h1 className="hm-h1">{t("search.title")}</h1>
        <p className="hm-lead">{t("search.prompt")}</p>
        {hintChips}
      </section>
    );
  }

  let result: Awaited<ReturnType<typeof searchProducts>> | null = null;
  try {
    result = await searchProducts({ q, page, perPage: PER_PAGE });
  } catch (e) {
    if (!(e instanceof SearchUnavailableError)) throw e;
  }
  if (!result) {
    return (
      <section className="hm-section">
        {crumbs}
        <h1 className="hm-h1">{t("search.results", { q })}</h1>
        <p className="hm-alert" role="alert">{t("search.unavailable")}</p>
      </section>
    );
  }

  const cards = await toCards(result.items, lang);
  const telegram = c.contacts.telegram;
  const phone = contactLinks(c, t("help.call")).find((l) => l.icon === "phone");

  return (
    <section className="hm-section" aria-labelledby="h-search">
      {crumbs}
      <div className="hm-section-head">
        <h1 id="h-search" className="hm-h1">{t("search.results", { q })}</h1>
        {result.total > 0 && <p className="hm-muted">{countWord(c.texts, "goods", result.total)}</p>}
      </div>
      {result.correctedQuery && <p className="hm-alert">{t("search.corrected", { q: result.correctedQuery })}</p>}

      {cards.length === 0 ? (
        <div className="hm-empty">
          <h2 className="hm-h2">{t("search.empty.title", { q })}</h2>
          <p className="hm-muted">{t("search.empty.text")}</p>
          {hintChips}
          <p><b>{t("help.inline.title")}</b> {t("help.inline.text")}</p>
          {(telegram || phone) && (
            <div className="hm-help-btns">
              {telegram && <a className={btn("primary")} href={telegram} target="_blank" rel="noopener"><Icon name="chat" size={20} />{t("help.telegram")}</a>}
              {phone && <a className={btn("secondary")} href={phone.href}><Icon name="phone" size={20} />{phone.label}</a>}
            </div>
          )}
        </div>
      ) : (
        <>
          <ul className="hm-grid">
            {cards.map((card, i) => (
              <li key={card.id}><ProductCard card={card} href={shopHref(lang, paths.product(card.sku))} t={t} priority={i < 2} /></li>
            ))}
          </ul>
          <p className="hm-muted" style={{ textAlign: "center" }}>
            {t("category.shown", { n: (page - 1) * PER_PAGE + cards.length, total: result.total })}
          </p>
          <Pager
            page={result.page}
            pages={result.pages}
            href={(p) => shopHref(lang, paths.search(q, p))}
            labels={{ nav: t("pager.label"), prev: t("pager.prev"), next: t("pager.next") }}
          />
        </>
      )}
    </section>
  );
}
