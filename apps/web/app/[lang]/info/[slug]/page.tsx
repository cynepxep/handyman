// Текстовые страницы из админки «Сайт → Страницы»: «Доставка і оплата», «Про магазин», «Контакти», оферта и свои.
// Текст хранится простой разметкой и выводится через renderPageBody() — вставить скрипт или чужой код нельзя.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageBySlug } from "@handyman/db/site-content";
import { isShopLang, paths, renderPageBody, shopHref, telHref } from "@handyman/core/site";
import { alternatesFor, getShopContent } from "@/lib/shop/content";
import { Breadcrumbs } from "@/components/shop/ui";

async function loadPage(lang: string, slug: string) {
  if (!isShopLang(lang)) return null;
  const page = await getPageBySlug(slug);
  if (!page || !page.visible) return null;
  const ru = lang === "ru";
  return {
    lang,
    slug: page.slug,
    title: (ru && page.titleRu.trim()) || page.titleUk,
    body: (ru && page.bodyRu.trim()) || page.bodyUk, // русского текста нет — показываем украинский
  };
}

export async function generateMetadata({ params }: PageProps<"/[lang]/info/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  const p = await loadPage(lang, slug);
  if (!p) return {};
  return { title: p.title, alternates: alternatesFor(p.lang, paths.info(p.slug)) };
}

export default async function InfoPage({ params }: PageProps<"/[lang]/info/[slug]">) {
  const { lang, slug } = await params;
  const p = await loadPage(lang, slug);
  if (!p) notFound();
  const c = await getShopContent(p.lang);
  const { t, pick, contacts: k } = c;
  const unknown = t("footer.unknown");
  const html = renderPageBody(p.body);
  const howTo = pick(k.howToUk, k.howToRu);

  return (
    <section className="hm-section" aria-labelledby="h-page">
      <Breadcrumbs label={t("crumbs.label")} items={[{ href: shopHref(p.lang, paths.home()), label: t("crumbs.home") }, { label: p.title }]} />
      <h1 id="h-page" className="hm-h1">{p.title}</h1>
      {p.slug === "contacts" && (
        <div className="hm-contact-card">
          <dl>
            <div><dt>{t("footer.address")}</dt><dd>{pick(k.addressUk, k.addressRu) || unknown}</dd></div>
            {howTo && <div><dt>{t("footer.howTo")}</dt><dd>{howTo}</dd></div>}
            <div><dt>{t("footer.hours")}</dt><dd style={{ whiteSpace: "pre-line" }}>{pick(k.hoursUk, k.hoursRu) || unknown}</dd></div>
            <div><dt>{t("footer.phone")}</dt><dd>{k.phones.length ? k.phones.map((ph) => <div key={ph}><a href={telHref(ph)}>{ph}</a></div>) : unknown}</dd></div>
            {k.email && <div><dt>{t("footer.email")}</dt><dd><a href={`mailto:${k.email}`}>{k.email}</a></dd></div>}
          </dl>
        </div>
      )}
      {html && <div className="hm-prose" dangerouslySetInnerHTML={{ __html: html }} />}
    </section>
  );
}
