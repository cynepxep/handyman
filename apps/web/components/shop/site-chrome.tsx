// Шапка, подвал и нижняя панель телефона — общие для всех страниц витрины.
// Тексты — из реестра (админка «Сайт → Тексты»), контакты и страницы — из «Сайт → Контакты» и «Сайт → Страницы».
import Link from "next/link";
import { paths, shopHref, telHref } from "@handyman/core/site";
import type { ShopContent } from "@/lib/shop/content";
import { FocusSearchButton, LangSwitch } from "./client-bits";
import { Icon } from "./icons";
import { SearchBox, type SearchLabels } from "./search-box";
import { btn } from "./ui";

/** Ссылка на мессенджер или звонок: снаружи сайта — в новой вкладке. */
function ContactPill({ href, icon, label }: { href: string; icon: string; label: string }) {
  const external = href.startsWith("http");
  return (
    <a className="hm-pill" href={href} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined} data-contact={icon}>
      <Icon name={icon} size={18} />
      {label}
    </a>
  );
}

/** Кнопки связи, которые владелец заполнил в админке (пустые не показываем). */
export function contactLinks(c: ShopContent, callLabel: string) {
  const phone = c.contacts.phones[0];
  return [
    c.contacts.telegram ? { href: c.contacts.telegram, icon: "chat", label: "Telegram" } : null,
    c.contacts.viber ? { href: c.contacts.viber, icon: "chat", label: "Viber" } : null,
    phone ? { href: telHref(phone), icon: "phone", label: callLabel } : null,
  ].filter((x): x is { href: string; icon: string; label: string } => x !== null);
}

export function SiteHeader({ c }: { c: ShopContent }) {
  const { t, lang } = c;
  const phone = c.contacts.phones[0];
  const links = contactLinks(c, t("header.help.call"));
  const labels: SearchLabels = {
    label: t("header.search.label"), placeholder: t("header.search.placeholder"), submit: t("search.submit"), history: t("search.history"),
    popular: t("search.popular"), clear: t("search.clear"), all: t("search.all"), none: t("search.none"), inStock: t("card.inStock"), onOrder: t("card.onOrder"),
  };
  const popular = t("home.hints").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  return (
    <header className="hm-header">
      <div className="hm-topline">
        <div className="hm-topline-in">
          <span>{t("header.trust.warranty")}</span>
          <span>{t("header.trust.return")}</span>
          <span className="hm-hide-sm">{t("header.trust.delivery")}</span>
          <span className="hm-topline-end">
            {phone && <a className="hm-hide-sm" href={telHref(phone)}>{phone}</a>}
            <LangSwitch lang={lang} label={t("header.lang")} />
          </span>
        </div>
      </div>
      <div className="hm-headrow">
        <Link className="hm-logo" href={shopHref(lang, paths.home())} aria-label={`${t("meta.siteName")} — ${t("header.home")}`}>
          <span className="hm-logo-mark" aria-hidden="true">H</span>
          <span aria-hidden="true">{t("meta.siteName")}</span>
        </Link>
        <Link className={`${btn("primary")} hm-catalog-btn`} href={shopHref(lang, paths.catalog())}>
          <Icon name="menu" size={20} />
          {t("header.catalog")}
        </Link>
        <SearchBox lang={lang} labels={labels} popular={popular} />
        <Link className="hm-cart" href={shopHref(lang, paths.cart())} aria-label={t("nav.cart")}>
          <Icon name="cart" size={26} />
        </Link>
      </div>
      {links.length > 0 && (
        <div className="hm-contacts">
          <span className="hm-contacts-lead">{t("header.help.lead")}</span>
          {links.map((l) => <ContactPill key={l.label} {...l} />)}
        </div>
      )}
    </header>
  );
}

export function SiteFooter({ c }: { c: ShopContent }) {
  const { t, pick, lang, contacts: k } = c;
  const unknown = t("footer.unknown");
  const address = pick(k.addressUk, k.addressRu);
  const hours = pick(k.hoursUk, k.hoursRu);
  const social = (
    [["Telegram", k.telegram], ["Viber", k.viber], ["Instagram", k.instagram], ["TikTok", k.tiktok], ["Facebook", k.facebook], ["YouTube", k.youtube]] as const
  ).filter(([, url]) => url);
  const pages = c.pages.filter((p) => p.inMenu);
  return (
    <footer className="hm-footer">
      <div className="hm-footer-in">
        <p className="hm-footer-title">{t("footer.title")}</p>
        <dl>
          <div><dt>{t("footer.address")}</dt><dd>{address || unknown}</dd></div>
          <div><dt>{t("footer.hours")}</dt><dd style={{ whiteSpace: "pre-line" }}>{hours || unknown}</dd></div>
          <div>
            <dt>{t("footer.phone")}</dt>
            <dd>{k.phones.length ? k.phones.map((p) => <div key={p}><a href={telHref(p)}>{p}</a></div>) : unknown}</dd>
          </div>
          {k.email && <div><dt>{t("footer.email")}</dt><dd><a href={`mailto:${k.email}`}>{k.email}</a></dd></div>}
        </dl>
        {pages.length > 0 && (
          <nav aria-label={t("footer.pages")}>
            <p className="hm-footer-h">{t("footer.pages")}</p>
            <ul className="hm-footer-links">
              {pages.map((p) => <li key={p.slug}><Link href={shopHref(lang, paths.info(p.slug))}>{p.title}</Link></li>)}
            </ul>
          </nav>
        )}
        {social.length > 0 && (
          <nav aria-label={t("footer.social")}>
            <p className="hm-footer-h">{t("footer.social")}</p>
            <ul className="hm-footer-links">
              {social.map(([name, url]) => <li key={name}><a href={url} target="_blank" rel="noopener">{name}</a></li>)}
            </ul>
          </nav>
        )}
        <p className="hm-footer-copy">{t("footer.copy", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}

/** Нижняя панель на телефоне (как в приложении): Каталог, Пошук, Кошик, Кабінет. На планшете и компьютере скрыта. */
export function BottomNav({ c }: { c: ShopContent }) {
  const { t, lang } = c;
  return (
    <nav className="hm-bottomnav" aria-label={t("nav.label")}>
      <Link href={shopHref(lang, paths.catalog())}><Icon name="menu" size={22} />{t("nav.catalog")}</Link>
      <FocusSearchButton label={t("nav.search")} />
      <Link href={shopHref(lang, paths.cart())}><Icon name="cart" size={22} />{t("nav.cart")}</Link>
      <Link href={shopHref(lang, paths.account())}><Icon name="user" size={22} />{t("nav.account")}</Link>
    </nav>
  );
}
