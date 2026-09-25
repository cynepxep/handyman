// Страница товара: /product/<артикул>/<название>. Если название в адресе устарело или его нет — перенаправляем на правильный адрес (308).
// Галерея, цена, наличие и срок отправки, кнопки «У кошик» и «Купити в 1 клік», доверие, характеристики, описание, похожие товары, разметка для поисковиков.
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { htmlToText, slugOf } from "@handyman/core/catalog";
import { isShopLang, paths, productSlug, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent, siteUrl } from "@/lib/shop/content";
import { loadProduct, productDescription, productPlace, similarProducts } from "@/lib/shop/product";
import { formatPrice } from "@/components/shop/format";
import { Gallery } from "@/components/shop/gallery";
import { Icon } from "@/components/shop/icons";
import { ProductCard, cardLabels, stockLabels } from "@/components/shop/product-card";
import { AddToCartButton, OneClickButton } from "@/components/shop/cart/cart-buttons";
import { RememberView } from "@/components/shop/viewed";
import { contactLinks } from "@/components/shop/site-chrome";
import { Breadcrumbs, Price, StockBadge, btn } from "@/components/shop/ui";

const SPECS_VISIBLE = 8;

async function load(params: PageProps<"/[lang]/product/[sku]/[[...slug]]">["params"]) {
  const { lang, sku, slug } = await params;
  if (!isShopLang(lang)) return null;
  const p = await loadProduct(decodeURIComponent(sku));
  if (!p) return null;
  return { lang, p, slug: slug?.join("/") ?? "" };
}

export async function generateMetadata({ params }: PageProps<"/[lang]/product/[sku]/[[...slug]]">): Promise<Metadata> {
  const x = await load(params);
  if (!x) return {};
  const { lang, p } = x;
  const c = await getShopContent(lang);
  const name = c.pick(p.nameUk, p.nameRu);
  const desc = htmlToText(productDescription(p, lang)).slice(0, 160) || c.t("meta.description");
  return {
    title: name,
    description: desc,
    alternates: alternatesFor(lang, paths.product(p.sku, p.nameUk)),
    openGraph: { title: name, description: desc, type: "website", images: p.images[0] ? [{ url: p.images[0] }] : undefined },
  };
}

export default async function ProductPage({ params }: PageProps<"/[lang]/product/[sku]/[[...slug]]">) {
  const x = await load(params);
  if (!x) notFound();
  const { lang, p } = x;
  const canonical = paths.product(p.sku, p.nameUk);
  if (x.slug !== productSlug(p.nameUk)) permanentRedirect(shopHref(lang, canonical));

  const c = await getShopContent(lang);
  const { t, pick } = c;
  const [place, similar] = await Promise.all([productPlace(c.menu, p.categoryId), similarProducts(p, lang)]);
  const name = pick(p.nameUk, p.nameRu);
  const desc = productDescription(p, lang);
  const help = contactLinks(c, t("help.call"));
  const crumbs = [
    { href: shopHref(lang, paths.home()), label: t("crumbs.home") },
    { href: shopHref(lang, paths.catalog()), label: t("menu.title") },
    ...(place
      ? [
          { href: shopHref(lang, paths.group(slugOf(place.group))), label: pick(place.group.nameUk, place.group.nameRu) },
          { href: shopHref(lang, paths.sub(slugOf(place.group), slugOf(place.sub))), label: pick(place.sub.nameUk, place.sub.nameRu) },
        ]
      : []),
    { label: name },
  ];

  // Разметка для поисковиков (Google, превью): товар, цена в гривнах, наличие, хлебные крошки.
  const base = siteUrl();
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name,
      sku: p.sku,
      ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
      ...(p.images.length ? { image: p.images.slice(0, 5) } : {}),
      ...(desc ? { description: htmlToText(desc).slice(0, 500) } : {}),
      offers: {
        "@type": "Offer",
        price: p.price.toFixed(2),
        priceCurrency: "UAH",
        availability: p.stock === "order" ? "https://schema.org/PreOrder" : "https://schema.org/InStock",
        url: new URL(shopHref(lang, canonical), base).toString(),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((cr, i) => ({ "@type": "ListItem", position: i + 1, name: cr.label, ...(cr.href ? { item: new URL(cr.href, base).toString() } : {}) })),
    },
  ];

  return (
    <article className="hm-section hm-product" data-product-id={p.id}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <RememberView sku={p.sku} />
      <Breadcrumbs label={t("crumbs.label")} items={crumbs} />

      <div className="hm-product-top">
        <Gallery
          images={p.images}
          alt={name}
          badge={p.discountPct > 0 ? `−${p.discountPct}%` : undefined}
          labels={{
            photo: t("product.photo"), zoom: t("product.zoom"), prev: t("product.prev"), next: t("product.next"),
            close: t("close"), thumbs: t("product.thumbs"), noPhoto: t("card.noPhoto"),
          }}
        />

        <div className="hm-product-info">
          <h1 className="hm-h1 hm-product-title">{name}</h1>
          <p className="hm-muted hm-product-meta">
            {t("sku")}: <b>{p.sku}</b>
            {p.brand && <> · {t("filtBrand")}: <b>{p.brand}</b></>}
          </p>

          <div className="hm-buy">
            <div className="hm-buy-price">
              <Price price={p.price} oldPrice={p.oldPrice} oldLabel={(v) => t("card.oldPrice", { price: v })} />
              <StockBadge level={p.stock} labels={stockLabels(t)} note={t(`stock.${p.stock}.note`)} />
            </div>
            <div className="hm-buy-actions">
              <AddToCartButton sku={p.sku} label={t("card.buy")} className="hm-buy-main" />
              <OneClickButton sku={p.sku} name={name} label={t("card.buy1click")} />
            </div>
          </div>
          {/* Телефон: цена и «У кошик» всегда видны внизу экрана (над нижней панелью). На планшете и компьютере скрыто. */}
          <div className="hm-buybar">
            <span className="hm-price">{formatPrice(p.price)}</span>
            <AddToCartButton sku={p.sku} label={t("card.buy")} />
          </div>

          <ul className="hm-product-trust">
            <li><Icon name="shield" size={22} /><span><b>{t("trust.warranty.title")}</b> {t("trust.warranty.text")}</span></li>
            <li><Icon name="back" size={22} /><span><b>{t("trust.return.title")}</b> {t("trust.return.text")}</span></li>
            <li><Icon name="truck" size={22} /><span><b>{t("trust.delivery.title")}</b> {t("trust.delivery.text")}</span></li>
          </ul>

          {help.length > 0 && (
            <div className="hm-product-help">
              <p className="hm-muted">{t("product.help")}</p>
              <div className="hm-chips">
                {help.map((h) => (
                  <a key={h.href} className="hm-pill" href={h.href} target={h.href.startsWith("http") ? "_blank" : undefined} rel="noopener">
                    <Icon name={h.icon} size={18} />{h.label}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {p.attributes.length > 0 && (
        <section className="hm-product-block" aria-labelledby="h-specs">
          <h2 id="h-specs" className="hm-h2">{t("specT")}</h2>
          <dl className="hm-specs-table">
            {p.attributes.slice(0, SPECS_VISIBLE).map((a, i) => <div key={`${i}-${a.name}`}><dt>{a.name}</dt><dd>{a.value}</dd></div>)}
          </dl>
          {p.attributes.length > SPECS_VISIBLE && (
            <details className="hm-specs-more">
              <summary className={btn("ghost", { small: true })}>{t("product.specsAll", { n: p.attributes.length })}</summary>
              <dl className="hm-specs-table">
                {p.attributes.slice(SPECS_VISIBLE).map((a, i) => <div key={`${i}-${a.name}`}><dt>{a.name}</dt><dd>{a.value}</dd></div>)}
              </dl>
            </details>
          )}
        </section>
      )}

      {desc && (
        <section className="hm-product-block" aria-labelledby="h-desc">
          <h2 id="h-desc" className="hm-h2">{t("descT")}</h2>
          <div className="hm-prose" dangerouslySetInnerHTML={{ __html: desc }} />
        </section>
      )}

      {similar.length > 0 && (
        <section className="hm-product-block" aria-labelledby="h-similar">
          <h2 id="h-similar" className="hm-h2">{t("similar")}</h2>
          <ul className="hm-rail">
            {similar.map((card) => <li key={card.id}><ProductCard card={card} labels={cardLabels(t)} rail /></li>)}
          </ul>
        </section>
      )}
    </article>
  );
}
