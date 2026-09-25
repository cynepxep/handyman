// Меню каталога на языке покупателя: группы и подгруппы из админки «Сайт → Меню и задачи».
import type { Metadata } from "next";
import Image from "next/image";
import { optimizable } from "@/lib/image-hosts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { slugOf } from "@handyman/core/catalog";
import { isShopLang, paths, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { getMenuView } from "@/lib/shop/catalog";
import { Breadcrumbs } from "@/components/shop/ui";

export async function generateMetadata({ params }: PageProps<"/[lang]/catalog">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("menu.title"), alternates: alternatesFor(lang, paths.catalog()) };
}

export default async function CatalogPage({ params }: PageProps<"/[lang]/catalog">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const c = await getShopContent(lang);
  const { t, pick } = c;
  const { groups } = await getMenuView(c.menu);
  const visible = groups.filter((g) => !g.group.hidden && g.total > 0);

  return (
    <section className="hm-section" aria-labelledby="h-catalog">
      <Breadcrumbs label={t("crumbs.label")} items={[{ href: shopHref(lang, paths.home()), label: t("crumbs.home") }, { label: t("menu.title") }]} />
      <h1 id="h-catalog" className="hm-h1">{t("menu.title")}</h1>
      <p className="hm-lead">{t("menu.lead")}</p>
      <ul className="hm-menu">
        {visible.map((g) => (
          <li key={g.group.id} id={`g-${g.group.id}`} className="hm-menu-group">
            <details>
              <summary>
                <span className="hm-group-img hm-menu-img">
                  {g.image && <Image src={g.image} alt="" fill sizes="56px" unoptimized={!optimizable(g.image)} />}
                </span>
                <span className="hm-menu-title">
                  <b>{pick(g.group.nameUk, g.group.nameRu)}</b>
                  {pick(g.group.hintUk, g.group.hintRu) && <small>{pick(g.group.hintUk, g.group.hintRu)}</small>}
                </span>
                <span className="hm-group-count">{g.total}</span>
              </summary>
              <ul className="hm-menu-subs">
                <li>
                  <Link href={shopHref(lang, paths.group(slugOf(g.group)))}>
                    <b>{t("category.quick.all")}</b>
                    <em>{g.total}</em>
                  </Link>
                </li>
                {g.subs.filter((s) => !s.hidden && s.total > 0).map((s) => (
                  <li key={s.id}>
                    <Link href={shopHref(lang, paths.sub(slugOf(g.group), s.slug))}>
                      <span>{pick(s.nameUk, s.nameRu)}</span>
                      <em>{s.total}</em>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
