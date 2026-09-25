// Главная: шапка с поиском, дальше блоки в порядке из админки «Сайт → Главная» (баннер, задачи, батарея, разделы, хиты, акции, новинки,
// «Ви переглядали», доверие, «Не знайшли? Підберемо»). Надписи — «Сайт → Тексты», задачи и разделы — «Сайт → Меню и задачи». Пустые блоки не показываются.
import Link from "next/link";
import { notFound } from "next/navigation";
import { slugOf } from "@handyman/core/catalog";
import { countWord, isShopLang, listingQuery, paths, shopHref } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { getSearchHints } from "@/lib/shop/search-hints";
import { getBatteries, getFlaggedCards, getMenuView, getSaleCards, type ShopCard } from "@/lib/shop/catalog";
import { loadHomeSettings } from "@handyman/db/site-content";
import { DEFAULT_HOME, type HomeBlock } from "@handyman/core/site";
import { PromoBanner } from "@/components/shop/promo-banner";
import { bannersFor } from "@/lib/shop/banners";
import { ViewedRail } from "@/components/shop/viewed";
import { Icon } from "@/components/shop/icons";
import { ProductCard, cardLabels } from "@/components/shop/product-card";
import { contactLinks } from "@/components/shop/site-chrome";
import { GroupTile, TaskTile } from "@/components/shop/tiles";
import { btn } from "@/components/shop/ui";

export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const c = await getShopContent(lang);
  const { t, pick } = c;
  const home = await loadHomeSettings().catch(() => null);
  const on = (id: HomeBlock) => home ? home.blocks.some((b) => b.id === id && b.on) : true;
  const [menu, batteries, sale, hits, news, homeBanners] = await Promise.all([
    getMenuView(c.menu), on("battery") ? getBatteries() : [], on("sale") ? getSaleCards(lang) : [],
    on("hits") ? getFlaggedCards(lang, "hit") : null, on("new") ? getFlaggedCards(lang, "isNew") : null,
    on("banner") ? bannersFor("home") : [],
  ]);
  const homeBanner = homeBanners[0] ?? null;
  const cl = cardLabels(t);
  const rail = (id: string, title: string, cards: ShopCard[], allHref?: string) =>
    cards.length > 0 && (
      <section key={id} className="hm-section" aria-labelledby={`h-${id}`}>
        <div className="hm-section-head">
          <h2 id={`h-${id}`} className="hm-h2">{title}</h2>
          {allHref && <Link className="hm-link" href={allHref}>{t("home.all")} →</Link>}
        </div>
        <ul className="hm-rail">
          {cards.map((card) => <li key={card.id}><ProductCard card={card} labels={cl} rail /></li>)}
        </ul>
      </section>
    );
  const goods = (n: number) => countWord(c.texts, "goods", n);
  const tasks = menu.tasks.filter((x) => !x.task.hidden && x.total > 0);
  const groups = menu.groups.filter((g) => !g.group.hidden && g.total > 0);
  const hints = await getSearchHints(c);
  // Кнопки «Не знайшли?»: Telegram и звонок — только те, что владелец заполнил в «Сайт → Контакти».
  const phone = contactLinks(c, t("help.call")).find((l) => l.icon === "phone");
  // «Яка у вас батарея?» ведёт в раздел, где быстрый выбор — серия батареи (по умолчанию «Акумуляторний інструмент»), с уже выбранной серией.
  const batteryGroup = c.menu.groups.find((g) => !g.hidden && g.quickPick.includes("series"));
  const batteryHref = (series: string) =>
    batteryGroup
      ? `${shopHref(lang, paths.group(slugOf(batteryGroup)))}${listingQuery({ facets: { series: [series] }, available: false, local: false, sale: false, page: 1 })}`
      : shopHref(lang, paths.search(series));

  const blocks: Record<HomeBlock, React.ReactNode> = {
    // баннер главной — из «Реклама и баннеры» (место «Главная»); несколько — первый по порядку
    banner: homeBanner ? <PromoBanner key="banner" banner={homeBanner} lang={lang} /> : null,
    tasks: tasks.length > 0 && (
      <section key="tasks" className="hm-section" aria-labelledby="h-tasks">
          <h2 id="h-tasks" className="hm-h2">{t("home.tasks.title")}</h2>
          <ul className="hm-tasks">
            {tasks.map(({ task, total }) => (
              <li key={task.id}>
                <TaskTile href={shopHref(lang, paths.task(slugOf(task)))} icon={task.icon} name={pick(task.nameUk, task.nameRu)} hint={pick(task.hintUk, task.hintRu)} count={goods(total)} />
              </li>
            ))}
          </ul>
        </section>
      
    ),
    battery: batteries.length > 0 && (
      <section key="battery" className="hm-section hm-battery" aria-labelledby="h-battery">
          <div className="hm-battery-head">
            <span className="hm-task-icon"><Icon name="battery" size={28} /></span>
            <div>
              <h2 id="h-battery" className="hm-h2">{t("home.battery.title")}</h2>
              <p className="hm-muted">{t("home.battery.lead")}</p>
            </div>
          </div>
          <ul className="hm-battery-list">
            {batteries.map((b) => (
              <li key={b.value}>
                <Link className="hm-battery-btn" href={batteryHref(b.value)}>
                  <b>{[t("home.battery.brand"), b.value].filter(Boolean).join(" ")}</b><span>{goods(b.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      
    ),
    groups: groups.length > 0 && (
      <section key="groups" className="hm-section" aria-labelledby="h-groups">
          <div className="hm-section-head">
            <h2 id="h-groups" className="hm-h2">{t("home.groups.title")}</h2>
            <Link className="hm-link" href={shopHref(lang, paths.catalog())}>{t("header.catalog")} →</Link>
          </div>
          <ul className="hm-groups">
            {groups.map((g) => (
              <li key={g.group.id}>
                <GroupTile href={shopHref(lang, paths.group(slugOf(g.group)))} image={g.image} name={pick(g.group.nameUk, g.group.nameRu)} count={goods(g.total)} />
              </li>
            ))}
          </ul>
        </section>
      
    ),
    hits: hits && rail("hits", t("home.hits.title"), hits.cards, shopHref(lang, paths.hits())),
    sale: rail("sale", t("home.sale.title"), sale),
    new: news && rail("new", t("home.new.title"), news.cards, shopHref(lang, paths.news())),
    viewed: <ViewedRail key="viewed" lang={lang} title={t("home.viewed.title")} clear={t("home.viewed.clear")} labels={cl} />,
    trust: (
      <section key="trust" className="hm-section hm-trust" aria-label={t("trust.warranty.title")}>
        <div><Icon name="shield" size={26} /><b>{t("trust.warranty.title")}</b><span>{t("trust.warranty.text")}</span></div>
        <div><Icon name="back" size={26} /><b>{t("trust.return.title")}</b><span>{t("trust.return.text")}</span></div>
        <div><Icon name="truck" size={26} /><b>{t("trust.delivery.title")}</b><span>{t("trust.delivery.text")}</span></div>
      </section>
    ),
    help: (
      <section key="help" className="hm-help" aria-labelledby="h-help">
        <h2 id="h-help" className="hm-h2">{t("help.title")}</h2>
        <p>{t("help.text")}</p>
        {(c.contacts.telegram || phone) && (
          <div className="hm-help-btns">
            {c.contacts.telegram && <a className={btn("primary")} href={c.contacts.telegram} target="_blank" rel="noopener"><Icon name="chat" size={20} />{t("help.telegram")}</a>}
            {phone && <a className={btn("secondary")} href={phone.href}><Icon name="phone" size={20} />{phone.label}</a>}
          </div>
        )}
      </section>
    ),
  };
  const order = home?.blocks ?? DEFAULT_HOME.blocks;

  return (
    <>
      <section className="hm-hero">
        <h1 className="hm-h1">{t("home.title")}</h1>
        <p className="hm-lead">{t("home.lead")}</p>
        {hints.length > 0 && (
          <ul className="hm-chips">
            {hints.map((h) => <li key={h.text}><Link className="hm-chip" href={h.href ?? shopHref(lang, paths.search(h.text))}>{h.text}</Link></li>)}
          </ul>
        )}
      </section>
      {order.filter((b) => b.on).map((b) => blocks[b.id])}
    </>
  );
}
