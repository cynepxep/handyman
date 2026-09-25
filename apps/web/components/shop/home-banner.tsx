// Баннер акции на главной: заголовок, текст, кнопка и картинка — владелец задаёт в «Сайт → Главная».
// Картинка — по ссылке https:// (своё хранилище картинок появится позже), поэтому обычный <img>, а не next/image.
import Link from "next/link";
import { shopHref, type ShopLang, type HomeBanner as Banner } from "@handyman/core/site";
import { btn } from "./ui";

export function HomeBanner({ banner: b, lang }: { banner: Banner; lang: ShopLang }) {
  const pick = (uk: string, ru: string) => (lang === "ru" && ru.trim() ? ru : uk);
  const title = pick(b.titleUk, b.titleRu);
  const text = pick(b.textUk, b.textRu);
  const button = pick(b.buttonUk, b.buttonRu);
  const internal = b.href.startsWith("/");
  const href = internal ? shopHref(lang, b.href) : b.href;
  return (
    <section className={`hm-banner${b.image ? " has-image" : ""}`} aria-label={title}>
      <div className="hm-banner-text">
        <h2 className="hm-h2">{title}</h2>
        {text && <p>{text}</p>}
        {button && b.href && (
          internal
            ? <Link className={btn("primary")} href={href}>{button}</Link>
            : <a className={btn("primary")} href={href} target="_blank" rel="noopener">{button}</a>
        )}
      </div>
      {b.image && (
        // eslint-disable-next-line @next/next/no-img-element -- картинка по ссылке владельца (любой сайт), оптимизация — когда будет своё хранилище
        <img className="hm-banner-img" src={b.image} alt="" loading="eager" decoding="async" />
      )}
    </section>
  );
}
