// Страница корзины /cart: то же, что мини-корзина сбоку, но на весь экран (для ссылок и без JS-окна).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isShopLang, paths, shopHref } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { CartPageView } from "@/components/shop/cart/cart-view";
import { Breadcrumbs } from "@/components/shop/ui";

export async function generateMetadata({ params }: PageProps<"/[lang]/cart">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("cart"), robots: { index: false, follow: false } };
}

export default async function CartPage({ params }: PageProps<"/[lang]/cart">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const { t } = await getShopContent(lang);
  return (
    <section className="hm-section">
      <Breadcrumbs label={t("crumbs.label")} items={[{ href: shopHref(lang, paths.home()), label: t("crumbs.home") }, { label: t("cart") }]} />
      <h1 className="hm-h1">{t("cart")}</h1>
      <div className="hm-cart-page">
        <CartPageView catalogHref={shopHref(lang, paths.catalog())} catalogLabel={t("toCatalog")} />
      </div>
    </section>
  );
}
