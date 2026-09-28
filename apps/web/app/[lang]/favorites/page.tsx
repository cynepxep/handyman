// «Обране» (шаг 5.5): гость видит избранное этого браузера, вошедший — из кабинета (общее для сайта и Mini App).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CLIENT_CABINET_ON, isShopLang, paths, shopHref } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { getClient } from "@/lib/client-auth";
import { Breadcrumbs, btn } from "@/components/shop/ui";
import { cardLabels } from "@/components/shop/product-card";
import { FavoritesView } from "@/components/shop/favorites";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/favorites">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("meta.favorites.title"), robots: { index: false, follow: false } };
}

export default async function FavoritesPage({ params }: PageProps<"/[lang]/favorites">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const { t } = await getShopContent(lang);
  const client = await getClient();
  return (
    <section className="hm-section" aria-labelledby="h-fav">
      <Breadcrumbs label={t("crumbs.label")} items={[{ href: shopHref(lang, paths.home()), label: t("crumbs.home") }, { label: t("fav.title") }]} />
      <h1 id="h-fav" className="hm-h1">{t("fav.title")}</h1>
      <FavoritesView
        lang={lang}
        labels={cardLabels(t)}
        empty={t("fav.empty")}
        guest={client || !CLIENT_CABINET_ON ? null : (
          <div className="hm-panel hm-row">
            <p>{t("fav.guest")}</p>
            <Link className={btn("secondary", { small: true })} href={shopHref(lang, paths.account())}>{t("fav.login")}</Link>
          </div>
        )}
      />
    </section>
  );
}
