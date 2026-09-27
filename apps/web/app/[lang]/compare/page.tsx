// Сравнение товаров /compare (шаг 5.6): список — в браузере покупателя (кнопка «Порівняти» на странице товара), характеристики — с сервера.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isShopLang, paths, shopHref } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { stockLabels } from "@/components/shop/product-card";
import { CompareView } from "@/components/shop/plus";
import { Breadcrumbs } from "@/components/shop/ui";

export async function generateMetadata({ params }: PageProps<"/[lang]/compare">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("meta.compare.title"), robots: { index: false, follow: false } };
}

export default async function ComparePage({ params }: PageProps<"/[lang]/compare">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const { t } = await getShopContent(lang);
  return (
    <section className="hm-section">
      <Breadcrumbs label={t("crumbs.label")} items={[{ href: shopHref(lang, paths.home()), label: t("crumbs.home") }, { label: t("compare.title") }]} />
      <h1 className="hm-h1">{t("compare.title")}</h1>
      <CompareView
        lang={lang}
        catalogHref={shopHref(lang, paths.catalog())}
        labels={{
          empty: t("compare.empty"), diff: t("compare.diff"), remove: t("compare.remove", { name: "{name}" }), clear: t("compare.clear"),
          price: t("compare.price"), stock: stockLabels(t), stockRow: t("compare.stock"), brand: t("filtBrand"), buy: t("card.buy"),
          noPhoto: t("card.noPhoto"), catalog: t("toCatalog"), loading: t("cart.loading"),
        }}
      />
    </section>
  );
}
