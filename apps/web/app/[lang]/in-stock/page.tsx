// «Є в наявності»: все товары, которые владелец выбрал для полки на главной («Сайт → Главная» или галочка в карточке товара).
// Ссылка «Дивитись усі» у полки и пункт в начале каталога. Распроданные не показываются; порядок — как у владельца.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isShopLang, paths, shopHref } from "@handyman/core/site";
import { loadHomeSettings } from "@handyman/db/site-content";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { getInstockCards } from "@/lib/shop/catalog";
import { Breadcrumbs, btn } from "@/components/shop/ui";
import { ProductCard, cardLabels } from "@/components/shop/product-card";

export async function generateMetadata({ params }: PageProps<"/[lang]/in-stock">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("home.instock.title"), description: t("instock.lead"), alternates: alternatesFor(lang, paths.inStock()) };
}

export default async function InStockPage({ params }: PageProps<"/[lang]/in-stock">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const { t } = await getShopContent(lang);
  const home = await loadHomeSettings().catch(() => null);
  const cards = home?.instock.length ? await getInstockCards(lang, home.instock) : [];
  const cl = cardLabels(t);

  return (
    <section className="hm-section" aria-labelledby="h-instock-all">
      <Breadcrumbs label={t("crumbs.label")} items={[{ href: shopHref(lang, paths.home()), label: t("crumbs.home") }, { label: t("home.instock.title") }]} />
      <h1 id="h-instock-all" className="hm-h1">{t("home.instock.title")}</h1>
      <p className="hm-lead">{t("instock.lead")}</p>
      {cards.length > 0 ? (
        <ul className="hm-grid">
          {cards.map((card) => <li key={card.id}><ProductCard card={card} labels={cl} /></li>)}
        </ul>
      ) : (
        <div className="hm-panel">
          <p>{t("instock.empty")}</p>
          <Link className={btn("primary", { small: true })} href={shopHref(lang, paths.catalog())}>{t("header.catalog")}</Link>
        </div>
      )}
    </section>
  );
}
