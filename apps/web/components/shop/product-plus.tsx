// Страница товара, «Витрина+» (шаг 5.6): блок цен от количества, совместимость, отзывы и вопросы. Серверные части;
// интерактивное (формы, кнопки) — в plus.tsx. Все подписи — из реестра текстов.
import Image from "next/image";
import Link from "next/link";
import { REVIEW_MAX_PHOTOS, type QtyPrice } from "@handyman/core/shop";
import { listingQuery, shopHref, type ShopLang } from "@handyman/core/site";
import type { PublicReview } from "@handyman/db/storefront-plus";
import type { ShopContent } from "@/lib/shop/content";
import type { CompatBlock } from "@/lib/shop/product-plus";
import { optimizable } from "@/lib/image-hosts";
import { AddToCartButton } from "./cart/cart-buttons";
import { formatPrice } from "./format";
import { Icon } from "./icons";
import { ProductCard, cardLabels } from "./product-card";
import { ReviewForm, type ReviewFormLabels } from "./plus";

/** «Дешевше від кількості»: от N шт. — цена за штуку; упаковки — кнопкой «У кошик N шт.». */
export function QtyPrices({ c, sku, tiers }: { c: ShopContent; sku: string; tiers: QtyPrice[] }) {
  const { t } = c;
  if (!tiers.length) return null;
  return (
    <div className="hm-qty-prices">
      <p className="hm-qty-title">{t("qty.title")}</p>
      <ul>
        {tiers.map((q) => (
          <li key={q.minQty}>
            {q.pack ? (
              <>
                <span>{t("qty.pack", { label: q.pack.label, n: q.pack.units, price: formatPrice(q.pack.price), each: formatPrice(q.unitPrice) })}</span>
                <AddToCartButton sku={sku} qty={q.pack.units} label={t("qty.packBtn", { n: q.pack.units })} variant="ghost" className="hm-btn-sm" />
              </>
            ) : (
              <span>{t("qty.from", { n: q.minQty, price: formatPrice(q.unitPrice) })}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="hm-muted hm-qty-note">{t("qty.note")}</p>
    </div>
  );
}

/** «Підходить до» (у расходника) и «Витратні матеріали та аксесуари» (у инструмента). */
export function CompatSections({ c, blocks }: { c: ShopContent; blocks: CompatBlock[] }) {
  const { t, lang } = c;
  const cl = cardLabels(t);
  return (
    <>
      {blocks.map((b) => {
        const id = `h-compat-${b.title}`;
        const all = b.allKey ? shopHref(lang, `/search${listingQuery({ facets: {}, available: false, local: false, sale: false, page: 1, ...(b.title === "fits" ? { tool: b.allKey } : { fit: b.allKey }) })}`) : null;
        return (
          <section key={b.title} className="hm-product-block" aria-labelledby={id} data-compat={b.title}>
            <div className="hm-section-head">
              <h2 id={id} className="hm-h2">{t(b.title === "fits" ? "compat.fits" : "compat.accessories")}</h2>
              {all && b.total > b.cards.length && <Link className="hm-link" href={all}>{t("compat.all", { n: b.total })}</Link>}
            </div>
            <ul className="hm-chips">
              {b.groups.map((g) => (
                <li key={g.key}>
                  <Link className="hm-chip" href={shopHref(lang, `/search${listingQuery({ facets: {}, available: false, local: false, sale: false, page: 1, ...(b.title === "fits" ? { tool: g.key } : { fit: g.key }) })}`)}>{g.label}</Link>
                </li>
              ))}
            </ul>
            {b.cards.length > 0 && (
              <ul className="hm-rail">
                {b.cards.map((card) => <li key={card.id}><ProductCard card={card} labels={cl} rail /></li>)}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

function Stars({ value, label }: { value: number; label: string }) {
  return (
    <span className="hm-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= Math.round(value) ? "is-on" : ""}><Icon name="star" size={18} /></i>)}
    </span>
  );
}

function ReviewItem({ r, c }: { r: PublicReview; c: ShopContent }) {
  const { t, lang } = c;
  const date = new Date(r.date).toLocaleDateString(lang === "ru" ? "ru-RU" : "uk-UA", { timeZone: "Europe/Kyiv" });
  return (
    <li className="hm-review">
      <div className="hm-review-head">
        <b>{r.name}</b>
        {r.verified && <span className="hm-review-verified"><Icon name="check" size={16} />{t("reviews.verified")}</span>}
        <span className="hm-muted">{date}</span>
      </div>
      {r.rating != null && <Stars value={r.rating} label={t("reviews.form.star", { n: r.rating })} />}
      <p className="hm-review-text">{r.text}</p>
      {r.photos.length > 0 && (
        <ul className="hm-review-photos">
          {r.photos.map((src, i) => (
            <li key={src}>
              <a href={src} target="_blank" rel="noopener">
                <Image src={src} alt={t("reviews.photo", { n: i + 1 })} width={88} height={88} sizes="88px" unoptimized={!optimizable(src)} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {r.answer && (
        <div className="hm-review-answer">
          <b>{t("reviews.answer")}</b>
          <p>{r.answer}</p>
        </div>
      )}
    </li>
  );
}

/** Отзывы (оценка, фото, ответ магазина) и вопросы; формы раскрываются кнопкой (работает и без JS — details). */
export function ReviewsSection({ c, productId, data }: { c: ShopContent; productId: string; data: { items: PublicReview[]; summary: { avg: number; count: number } } }) {
  const { t, lang } = c;
  const reviews = data.items.filter((r) => r.kind === "review");
  const questions = data.items.filter((r) => r.kind === "question");
  const labels = (kind: "review" | "question"): ReviewFormLabels => ({
    name: t("reviews.form.name"), rating: t("reviews.form.rating"), star: t("reviews.form.star", { n: "{n}" }),
    text: t(kind === "review" ? "reviews.form.text" : "questions.form.text"), photos: t("reviews.form.photos", { n: REVIEW_MAX_PHOTOS }),
    send: t("reviews.form.send"), sending: t("reviews.form.sending"), photoErr: t("review.err.photo", { n: REVIEW_MAX_PHOTOS }),
  });
  return (
    <section className="hm-product-block hm-reviews" aria-labelledby="h-reviews" id="reviews">
      <h2 id="h-reviews" className="hm-h2">{t("reviews.title")}</h2>
      <div className="hm-reviews-cols">
        <div className="hm-panel">
          <div className="hm-section-head">
            <h3 className="hm-reviews-h">{t("reviews.tab.reviews", { n: reviews.length })}</h3>
            {data.summary.count > 0 && (
              <p className="hm-reviews-avg"><Stars value={data.summary.avg} label={t("reviews.avg", { avg: data.summary.avg, n: data.summary.count })} /> {t("reviews.avg", { avg: String(data.summary.avg).replace(".", ","), n: data.summary.count })}</p>
            )}
          </div>
          {reviews.length ? <ul className="hm-review-list">{reviews.map((r) => <ReviewItem key={r.id} r={r} c={c} />)}</ul> : <p className="hm-muted">{t("reviews.none")}</p>}
          <details className="hm-review-details">
            <summary className={`hm-btn hm-btn-secondary`}>{t("reviews.write")}</summary>
            <ReviewForm lang={lang as ShopLang} productId={productId} kind="review" labels={labels("review")} maxPhotos={REVIEW_MAX_PHOTOS} />
          </details>
        </div>
        <div className="hm-panel">
          <h3 className="hm-reviews-h">{t("reviews.tab.questions", { n: questions.length })}</h3>
          {questions.length ? <ul className="hm-review-list">{questions.map((r) => <ReviewItem key={r.id} r={r} c={c} />)}</ul> : <p className="hm-muted">{t("questions.none")}</p>}
          <details className="hm-review-details">
            <summary className={`hm-btn hm-btn-ghost`}>{t("questions.ask")}</summary>
            <ReviewForm lang={lang as ShopLang} productId={productId} kind="question" labels={labels("question")} maxPhotos={REVIEW_MAX_PHOTOS} />
          </details>
        </div>
      </div>
    </section>
  );
}
