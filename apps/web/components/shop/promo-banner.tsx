// Баннер из «Реклама и баннеры»: большой (главная, страница товара) или плитка между товарами в списке.
// Мягкий стиль (правило владельца): скругления, плавный фон, мягкая тень. Нажатие идёт через /api/banner/<id> — считается.
import type { BannerRow } from "@handyman/core/site";
import type { ShopLang } from "@handyman/core/site/routes";

export function PromoBanner({ banner: b, lang, variant = "wide" }: { banner: BannerRow; lang: ShopLang; variant?: "wide" | "tile" }) {
  const c = b.content;
  const pick = (uk: string, ru: string) => (lang === "ru" && ru.trim() ? ru : uk);
  const title = pick(c.titleUk, c.titleRu);
  const text = pick(c.textUk, c.textRu);
  const button = pick(c.buttonUk, c.buttonRu);
  const go = c.href ? `/api/banner/${b.id}?l=${lang}` : null;
  const external = c.href.startsWith("http");
  const body = (
    <>
      <div className="hm-promo-text">
        <p className="hm-promo-title">{title}</p>
        {text && <p className="hm-promo-desc">{text}</p>}
        {button && go && <span className="hm-promo-btn">{button}</span>}
      </div>
      {c.image && (
        // eslint-disable-next-line @next/next/no-img-element -- картинка по ссылке владельца (любой сайт); своё хранилище картинок баннеров — позже
        <img className="hm-promo-img" src={c.image} alt="" loading="lazy" decoding="async" />
      )}
    </>
  );
  const cls = `hm-promo hm-promo-${c.theme} hm-promo-${variant}${c.image ? " has-image" : ""}`;
  return go ? (
    <a className={cls} href={go} {...(external ? { target: "_blank", rel: "noopener" } : {})} data-banner-id={b.id} aria-label={title}>{body}</a>
  ) : (
    <section className={cls} aria-label={title} data-banner-id={b.id}>{body}</section>
  );
}
