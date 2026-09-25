/* eslint-disable @next/next/no-img-element -- в стенде фото берутся прямо с vitals.ua; оптимизация картинок — Шаг 2.5 */
import Link from "next/link";
import { loadSiteContent, type SiteContent } from "@handyman/db/site-content";
import { EMPTY_CONTACTS, countWord, defaultTexts, fillText, telHref, type Lang } from "@handyman/core/site";
import { defaultMenuConfig } from "@handyman/core/catalog";
import { DEMOS, loadV2, type V2Card, type V2Data } from "./data";
import { FONT_CLASSES } from "./fonts";
import { Icon } from "./icons";
import "./v2.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Мастерская v2 (служебная)", robots: { index: false, follow: false } };

type Params = { s?: string; w?: string; l?: string; c?: string; pick?: string };
const SCREENS = [
  { key: "home", name: "Головна" },
  { key: "menu", name: "Меню «Каталог»" },
  { key: "category", name: "Категорія" },
] as const;
const WIDTHS = [
  { key: "auto", name: "По окну", px: 0 },
  { key: "360", name: "Телефон 360", px: 360 },
  { key: "768", name: "Планшет 768", px: 768 },
  { key: "1280", name: "Компьютер 1280", px: 1280 },
] as const;

const fmt = (n: number) => `${n.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴`;
const TASK_DEMO: Record<string, string> = { cut: "cut", drill: "drill", screw: "bits" };
const SUB_DEMO: Record<string, string> = { "discs-cut": "cut", "drills-metal": "drill", "hand-screw": "bits" };

type Ctx = {
  lang: Lang;
  tx: (key: string, vars?: Record<string, string | number>) => string;
  pick: (uk: string, ru: string) => string;
  content: SiteContent;
  href: (over: Partial<Params>) => string;
};

async function loadContent(lang: Lang): Promise<SiteContent> {
  try {
    return await loadSiteContent(lang);
  } catch (e) {
    // База недоступна: показываем стандартные тексты, сайт не падает.
    console.error("[design/v2] не удалось загрузить контент сайта", e);
    return { texts: defaultTexts(lang), contacts: EMPTY_CONTACTS, menu: defaultMenuConfig(), pages: [] };
  }
}

export default async function V2Page({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const screen = SCREENS.some((x) => x.key === sp.s) ? (sp.s as string) : "home";
  const width = WIDTHS.find((x) => x.key === sp.w) ?? WIDTHS[0];
  const lang: Lang = sp.l === "ru" ? "ru" : "uk";
  const demoKey = DEMOS.some((d) => d.key === sp.c) ? sp.c : DEMOS[0].key;

  const content = await loadContent(lang);
  const data = await loadV2({ screen, demoKey, pick: sp.pick, content });
  const href = (over: Partial<Params>) => {
    const q = new URLSearchParams({ s: screen, w: width.key, l: lang, ...(screen === "category" ? { c: demoKey! } : {}) });
    for (const [k, v] of Object.entries(over)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    return `/design/v2?${q.toString()}`;
  };
  const ctx: Ctx = {
    lang,
    tx: (key, vars) => fillText(content.texts[key] ?? key, vars),
    pick: (uk, ru) => (lang === "uk" ? uk : ru),
    content,
    href,
  };

  const shop = (
    <div className={`v2 ${FONT_CLASSES}`} lang={lang}>
      <Header ctx={ctx} />
      <main className="v2-main">
        {data.problems.length > 0 && (
          <div className="v2-problems" role="alert">
            <b>Проверка меню нашла проблемы (поправьте в админке: Сайт → Меню и задачи):</b>
            <ul>{data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {screen === "home" && <Home data={data} ctx={ctx} />}
        {screen === "menu" && <MenuScreen data={data} ctx={ctx} />}
        {screen === "category" && <CategoryScreen data={data} ctx={ctx} />}
        <Footer ctx={ctx} />
      </main>
      <nav className="v2-bottomnav" aria-label="Основна навігація">
        <Link href={href({ s: "home" })}><Icon name="bolt" size={22} />{ctx.tx("nav.home")}</Link>
        <Link href={href({ s: "menu" })}><Icon name="menu" size={22} />{ctx.tx("nav.catalog")}</Link>
        <a href="#"><Icon name="cart" size={22} />{ctx.tx("nav.cart")}</a>
        <a href="#"><Icon name="user" size={22} />{ctx.tx("nav.account")}</a>
      </nav>
    </div>
  );

  return (
    <div className="v2-root">
      <div className="v2-bar">
        <div className="v2-bar-row">
          <strong>Мастерская v2</strong>
          <nav aria-label="Екран">
            {SCREENS.map((x) => <Link key={x.key} href={href({ s: x.key })} className={x.key === screen ? "on" : ""}>{x.name}</Link>)}
          </nav>
          {screen === "category" && (
            <nav aria-label="Приклад категорії">
              {DEMOS.map((d) => <Link key={d.key} href={href({ c: d.key, pick: undefined })} className={d.key === demoKey ? "on2" : ""}>{d.label}</Link>)}
            </nav>
          )}
        </div>
        <div className="v2-bar-row">
          <span>Ширина:</span>
          <nav aria-label="Ширина">
            {WIDTHS.map((x) => <Link key={x.key} href={href({ w: x.key })} className={x.key === width.key ? "on" : ""}>{x.name}</Link>)}
          </nav>
          <span>Мова:</span>
          <nav aria-label="Мова">
            <Link href={href({ l: "uk" })} className={lang === "uk" ? "on" : ""}>Українська</Link>
            <Link href={href({ l: "ru" })} className={lang === "ru" ? "on" : ""}>Русский</Link>
          </nav>
          <Link href="/admin/site/texts" className="on2">Править тексты в админке →</Link>
        </div>
      </div>
      {width.px ? (
        <div className="v2-stage"><div className="v2-frame" style={{ width: `min(100%, ${width.px}px)` }}>{shop}</div></div>
      ) : (
        shop
      )}
    </div>
  );
}

// ---------- общие части ----------

/** Ссылка на контакт: если он ещё не заполнен в админке — неактивная «таблетка» с подсказкой. */
function ContactPill({ href, icon, label, ctx }: { href: string | null; icon: string; label: string; ctx: Ctx }) {
  if (!href) {
    return <span className="v2-pill v2-pill-off" title={ctx.tx("footer.unknown")}><Icon name={icon} size={18} />{label}</span>;
  }
  return <a className="v2-pill" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener"><Icon name={icon} size={18} />{label}</a>;
}

function Header({ ctx }: { ctx: Ctx }) {
  const { tx, content, href, lang } = ctx;
  const phone = content.contacts.phones[0];
  return (
    <header className="v2-header">
      <div className="v2-topline">
        <span>{tx("header.trust.warranty")}</span>
        <span>{tx("header.trust.return")}</span>
        <span className="v2-hide-sm">{tx("header.trust.delivery")}</span>
        <span className="v2-topline-end">
          {phone && <a className="v2-hide-sm" href={telHref(phone)}>{phone}</a>}
          <span className="v2-lang" role="group" aria-label="Мова">
            {lang === "uk" ? <b>УКР</b> : <Link href={href({ l: "uk" })}>УКР</Link>}
            {lang === "ru" ? <b>РУС</b> : <Link href={href({ l: "ru" })}>РУС</Link>}
          </span>
        </span>
      </div>
      <div className="v2-headrow">
        <Link className="v2-logo" href={href({ s: "home" })}><span className="v2-logo-mark" aria-hidden="true">H</span><span>Handyman</span></Link>
        <Link href={href({ s: "menu" })} className="v2-btn v2-btn-primary v2-catalog-btn v2-hide-sm"><Icon name="menu" size={20} />{tx("header.catalog")}</Link>
        <label className="v2-search">
          <span className="v2-vh">{tx("header.search.label")}</span>
          <input type="search" placeholder={tx("header.search.placeholder")} />
          <button type="button" aria-label={tx("header.search.label")}><Icon name="search" size={22} /></button>
        </label>
        <a className="v2-cart" href="#"><Icon name="cart" size={26} /><span className="v2-cart-sum">2&nbsp;450&nbsp;₴</span><span className="v2-cart-count">3</span><span className="v2-vh">{tx("nav.cart")}</span></a>
      </div>
      <div className="v2-contact">
        <span className="v2-contact-text">{tx("header.help.lead")}</span>
        <ContactPill ctx={ctx} href={content.contacts.telegram || null} icon="chat" label="Telegram" />
        <ContactPill ctx={ctx} href={content.contacts.viber || null} icon="chat" label="Viber" />
        <ContactPill ctx={ctx} href={phone ? telHref(phone) : null} icon="phone" label={tx("header.help.call")} />
      </div>
    </header>
  );
}

function Footer({ ctx }: { ctx: Ctx }) {
  const { tx, pick, content } = ctx;
  const c = content.contacts;
  const unknown = tx("footer.unknown");
  const addr = pick(c.addressUk, c.addressRu);
  const hours = pick(c.hoursUk, c.hoursRu);
  const howTo = pick(c.howToUk, c.howToRu);
  const social = [["Telegram", c.telegram], ["Viber", c.viber], ["Instagram", c.instagram], ["TikTok", c.tiktok], ["Facebook", c.facebook], ["YouTube", c.youtube]].filter(([, url]) => url);
  return (
    <footer className="v2-footer">
      <p className="v2-footer-title">{tx("footer.title")}</p>
      <dl className="v2-footer-list">
        <div><dt>{ctx.pick("Адреса", "Адрес")}</dt><dd>{addr || unknown}{howTo && <><br /><span className="v2-muted">{howTo}</span></>}</dd></div>
        <div><dt>{ctx.pick("Графік", "График")}</dt><dd>{hours || unknown}</dd></div>
        <div><dt>{ctx.pick("Телефон", "Телефон")}</dt><dd>{c.phones.length ? c.phones.map((p) => <a key={p} href={telHref(p)} className="v2-block">{p}</a>) : unknown}</dd></div>
        {c.email && <div><dt>E-mail</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></div>}
      </dl>
      {social.length > 0 && <p className="v2-footer-links">{social.map(([name, url]) => <a key={name} href={url} target="_blank" rel="noopener">{name}</a>)}</p>}
      <p className="v2-footer-links">{content.pages.filter((p) => p.inMenu).map((p) => <a key={p.slug} href="#">{p.title}</a>)}</p>
    </footer>
  );
}

function ProductCard({ c, ctx, rail }: { c: V2Card; ctx: Ctx; rail?: boolean }) {
  const { tx } = ctx;
  return (
    <article className={`v2-card${rail ? " v2-card-rail" : ""}`}>
      <div className="v2-card-media">
        {c.image ? <img src={c.image} alt={c.name} loading="lazy" width={300} height={300} /> : <div className="v2-noimg">{tx("card.noPhoto")}</div>}
        {c.discountPct > 0 && <span className="v2-badge">−{c.discountPct}%</span>}
      </div>
      <div className="v2-card-body">
        <h3 className="v2-card-title"><a href="#">{c.name}</a></h3>
        {c.specs.length > 0 && <ul className="v2-specs" aria-label={tx("card.specs.label")}>{c.specs.map((s) => <li key={s.key}>{s.text}</li>)}</ul>}
        <p className={c.available ? "v2-stock v2-in" : "v2-stock v2-order"}>{c.available ? tx("card.inStock") : tx("card.onOrder")}</p>
        <div className="v2-price-row">
          <span className="v2-price">{fmt(c.price)}</span>
          {c.oldPrice && <s className="v2-old">{fmt(c.oldPrice)}</s>}
        </div>
        <div className="v2-actions">
          <button type="button" className="v2-btn v2-btn-primary">{tx("card.buy")}</button>
          <button type="button" className="v2-btn v2-btn-ghost">{tx("card.buy1click")}</button>
        </div>
      </div>
    </article>
  );
}

// ---------- Головна ----------

function Home({ data, ctx }: { data: V2Data; ctx: Ctx }) {
  const { tx, pick, href, content } = ctx;
  const goods = (n: number) => countWord(content.texts, "goods", n);
  const groups = data.groups.filter((g) => !g.group.hidden);
  const tasks = data.tasks.filter((t) => !t.task.hidden);
  return (
    <>
      <section className="v2-hero">
        <h1 className="v2-h1">{tx("home.title")}</h1>
        <p className="v2-lead">{tx("home.lead")}</p>
        <ul className="v2-hints" aria-label="Приклади запитів">
          {tx("home.hints").split(",").map((h) => h.trim()).filter(Boolean).map((h) => <li key={h}>{h}</li>)}
        </ul>
      </section>

      {tasks.length > 0 && (
        <section className="v2-section" aria-labelledby="v2-tasks">
          <h2 id="v2-tasks" className="v2-h2">{tx("home.tasks.title")}</h2>
          <ul className="v2-tasks">
            {tasks.map(({ task, total }) => (
              <li key={task.id}>
                <Link className="v2-task" href={TASK_DEMO[task.id] ? href({ s: "category", c: TASK_DEMO[task.id], pick: undefined }) : href({ s: "menu" })}>
                  <span className="v2-task-icon"><Icon name={task.icon} size={28} /></span>
                  <span className="v2-task-name">{pick(task.nameUk, task.nameRu)}</span>
                  <span className="v2-task-hint">{pick(task.hintUk, task.hintRu)}</span>
                  <span className="v2-task-count">{goods(total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.batteries.length > 0 && (
        <section className="v2-section v2-battery" aria-labelledby="v2-bat">
          <div className="v2-battery-head">
            <span className="v2-task-icon"><Icon name="battery" size={28} /></span>
            <div>
              <h2 id="v2-bat" className="v2-h2">{tx("home.battery.title")}</h2>
              <p className="v2-muted">{tx("home.battery.lead")}</p>
            </div>
          </div>
          <ul className="v2-battery-list">
            {data.batteries.map((b) => (
              <li key={b.value}>
                <Link className="v2-battery-btn" href={href({ s: "category", c: "cordless", pick: b.value })}>
                  <b>{b.value}</b><span>{goods(b.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="v2-section" aria-labelledby="v2-groups">
        <h2 id="v2-groups" className="v2-h2">{tx("home.groups.title")}</h2>
        <ul className="v2-groups">
          {groups.map((g) => (
            <li key={g.group.id}>
              <Link className="v2-group" href={href({ s: "menu" })}>
                <span className="v2-group-img">{g.image && <img src={g.image} alt="" loading="lazy" width={120} height={120} />}</span>
                <span className="v2-group-name">{pick(g.group.nameUk, g.group.nameRu)}</span>
                <span className="v2-group-count">{goods(g.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {data.sale.length > 0 && (
        <section className="v2-section" aria-labelledby="v2-sale">
          <h2 id="v2-sale" className="v2-h2">{tx("home.sale.title")}</h2>
          <ul className="v2-rail">
            {data.sale.map((c) => <li key={c.id}><ProductCard c={c} ctx={ctx} rail /></li>)}
          </ul>
        </section>
      )}

      <section className="v2-section v2-trust" aria-label={tx("trust.warranty.title")}>
        <div><Icon name="shield" size={26} /><b>{tx("trust.warranty.title")}</b><span>{tx("trust.warranty.text")}</span></div>
        <div><Icon name="back" size={26} /><b>{tx("trust.return.title")}</b><span>{tx("trust.return.text")}</span></div>
        <div><Icon name="truck" size={26} /><b>{tx("trust.delivery.title")}</b><span>{tx("trust.delivery.text")}</span></div>
      </section>

      <section className="v2-section v2-help" aria-labelledby="v2-help">
        <h2 id="v2-help" className="v2-h2">{tx("help.title")}</h2>
        <p>{tx("help.text")}</p>
        <div className="v2-help-btns">
          <ContactAction ctx={ctx} href={content.contacts.telegram || null} icon="chat" label={tx("help.telegram")} primary />
          <ContactAction ctx={ctx} href={content.contacts.phones[0] ? telHref(content.contacts.phones[0]) : null} icon="phone" label={tx("help.call")} />
        </div>
      </section>
    </>
  );
}

function ContactAction({ href, icon, label, primary, ctx }: { href: string | null; icon: string; label: string; primary?: boolean; ctx: Ctx }) {
  const cls = `v2-btn ${primary ? "v2-btn-primary" : "v2-btn-secondary"}`;
  if (!href) return <span className={`${cls} v2-pill-off`} title={ctx.tx("footer.unknown")}><Icon name={icon} size={20} />{label}</span>;
  return <a className={cls} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener"><Icon name={icon} size={20} />{label}</a>;
}

// ---------- Меню «Каталог» ----------

function MenuScreen({ data, ctx }: { data: V2Data; ctx: Ctx }) {
  const { tx, pick, href } = ctx;
  const groups = data.groups.filter((g) => !g.group.hidden);
  return (
    <section className="v2-section" aria-labelledby="v2-menu-h">
      <nav className="v2-crumbs" aria-label={tx("crumbs.label")}><Link href={href({ s: "home" })}>{tx("crumbs.home")}</Link> / <span>{tx("menu.title")}</span></nav>
      <h1 id="v2-menu-h" className="v2-h1">{tx("menu.title")}</h1>
      <p className="v2-muted">{tx("menu.lead")}</p>
      <ul className="v2-menu">
        {groups.map((g) => (
          <li key={g.group.id} className="v2-menu-group">
            <details open>
              <summary>
                <span className="v2-group-img v2-group-img-sm">{g.image && <img src={g.image} alt="" loading="lazy" width={64} height={64} />}</span>
                <span className="v2-menu-title"><b>{pick(g.group.nameUk, g.group.nameRu)}</b><small>{pick(g.group.hintUk, g.group.hintRu)}</small></span>
                <span className="v2-group-count">{g.total}</span>
              </summary>
              <ul className="v2-menu-subs">
                {g.group.subs.filter((s) => !s.hidden).map((s) => {
                  const total = g.subs.find((x) => x.id === s.id)?.total ?? 0;
                  return (
                    <li key={s.id}>
                      <Link href={SUB_DEMO[s.id] ? href({ s: "category", c: SUB_DEMO[s.id], pick: undefined }) : "#"}>
                        <span>{pick(s.nameUk, s.nameRu)}</span><em>{total}</em>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Категория ----------

function CategoryScreen({ data, ctx }: { data: V2Data; ctx: Ctx }) {
  const { tx, pick, href, content } = ctx;
  const c = data.category;
  if (!c) return <p className="v2-alert">{tx("category.searchDown")}</p>;
  const goods = (n: number) => countWord(content.texts, "goods", n);
  const subCfg = c.group.subs.find((s) => s.id === c.demo.subId);
  const subs = c.group.subs.filter((s) => !s.hidden);
  const totalOf = (id: string) => c.subsInGroup.find((s) => s.id === id)?.total ?? 0;
  const title = pick(subCfg?.nameUk ?? c.group.nameUk, subCfg?.nameRu ?? c.group.nameRu);
  const shortLabel = c.quickLabel.split(",")[0];
  return (
    <section className="v2-section" aria-labelledby="v2-cat-h">
      <nav className="v2-crumbs" aria-label={tx("crumbs.label")}>
        <Link href={href({ s: "home" })}>{tx("crumbs.home")}</Link> / <Link href={href({ s: "menu" })}>{tx("menu.title")}</Link> / <span>{pick(c.group.nameUk, c.group.nameRu)}</span>{subCfg && <> / <span>{title}</span></>}
      </nav>
      <div className="v2-cat-head">
        <h1 id="v2-cat-h" className="v2-h1">{title}</h1>
        <p className="v2-muted">{goods(c.total)}</p>
      </div>

      {subs.length > 1 && (
        <ul className="v2-subchips" aria-label={pick(c.group.nameUk, c.group.nameRu)}>
          {subs.map((s) => (
            <li key={s.id}><Link className={s.id === c.demo.subId ? "on" : ""} href={SUB_DEMO[s.id] ? href({ c: SUB_DEMO[s.id], pick: undefined }) : "#"}>{pick(s.nameUk, s.nameRu)} <em>{totalOf(s.id)}</em></Link></li>
          ))}
        </ul>
      )}

      {c.quickValues.length > 0 && (
        <div className="v2-quick">
          <p className="v2-quick-title">{c.quickKey === "series" ? tx("category.quick.battery") : tx("category.quick.title", { name: c.quickLabel })}</p>
          <ul className={`v2-quick-list${c.quickValues.length > 8 ? " v2-quick-scroll" : ""}`}>
            <li><Link className={!c.pick ? "on" : ""} href={href({ pick: undefined })}>{tx("category.quick.all")}</Link></li>
            {c.quickValues.map((v) => (
              <li key={v.value}><Link className={v.value === c.pick ? "on" : ""} href={href({ pick: v.value })}>{v.value}<em>{v.count}</em></Link></li>
            ))}
          </ul>
        </div>
      )}

      <div className="v2-catalog">
        <aside className="v2-filters" aria-label={tx("category.filters")}>
          <details className="v2-filter-toggle">
            <summary className="v2-btn v2-btn-secondary">{tx("category.filters")}</summary>
            <div className="v2-filter-panel"><FilterGroups c={c} ctx={ctx} /></div>
          </details>
          <div className="v2-filter-side"><FilterGroups c={c} ctx={ctx} /></div>
        </aside>
        <div className="v2-results">
          <div className="v2-toolbar">
            <ul className="v2-chips" aria-label={tx("category.filters")}>
              {c.pick && <li><Link className="v2-chip" href={href({ pick: undefined })}>{shortLabel}: {c.pick} ✕</Link></li>}
            </ul>
            <label className="v2-sort"><span className="v2-vh">Сортування</span>
              <select defaultValue="rel">
                <option value="rel">{tx("category.sort.relevance")}</option>
                <option value="asc">{tx("category.sort.asc")}</option>
                <option value="desc">{tx("category.sort.desc")}</option>
              </select>
            </label>
          </div>
          {c.cards.length === 0 ? <p className="v2-alert">{tx("category.empty")}</p> : (
            <ul className="v2-grid">{c.cards.map((card) => <li key={card.id}><ProductCard c={card} ctx={ctx} /></li>)}</ul>
          )}
          <div className="v2-more">
            <button type="button" className="v2-btn v2-btn-secondary">{tx("category.more", { n: 12 })}</button>
            <p className="v2-muted">{tx("category.shown", { n: c.cards.length, total: c.total })}</p>
          </div>
          <div className="v2-help v2-help-inline">
            <b>{tx("help.inline.title")}</b> <span>{tx("help.inline.text")}</span>
            <ContactPill ctx={ctx} href={content.contacts.telegram || null} icon="chat" label="Telegram" />
          </div>
        </div>
      </div>
    </section>
  );
}

function FilterGroups({ c, ctx }: { c: NonNullable<V2Data["category"]>; ctx: Ctx }) {
  return (
    <>
      <label className="v2-check v2-check-row"><input type="checkbox" defaultChecked /> {ctx.tx("card.inStock")}</label>
      <label className="v2-check v2-check-row"><input type="checkbox" /> {ctx.tx("onSale")}</label>
      {c.price && (
        <fieldset className="v2-fgroup">
          <legend>{ctx.tx("priceFrom")} — {ctx.tx("priceTo")}, ₴</legend>
          <div className="v2-range">
            <input type="text" inputMode="numeric" placeholder={String(Math.floor(c.price.min))} aria-label={ctx.tx("priceFrom")} /><span>—</span>
            <input type="text" inputMode="numeric" placeholder={String(Math.ceil(c.price.max))} aria-label={ctx.tx("priceTo")} />
          </div>
        </fieldset>
      )}
      {c.attrs.filter((a) => a.key !== c.quickKey).slice(0, 4).map((a, i) => (
        <details key={a.key} className="v2-fgroup" open={i < 2}>
          <summary>{a.label}</summary>
          {a.values.slice(0, 5).map((v) => (
            <label key={v.value} className="v2-check"><input type="checkbox" /> <span>{v.value}</span> <em>{v.count}</em></label>
          ))}
        </details>
      ))}
    </>
  );
}
