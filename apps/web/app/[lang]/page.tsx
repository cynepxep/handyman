// Главная: «Що потрібно зробити?» (задачи), «Яка у вас батарея?», разделы каталога, акции, доверие, «Не знайшли? Підберемо».
// Все надписи — из админки «Сайт → Тексты», задачи и разделы — из «Сайт → Меню и задачи». Пустые блоки не показываются.
import Link from "next/link";
import { notFound } from "next/navigation";
import { countWord, isShopLang, paths, shopHref } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { getBatteries, getMenuView, getSaleCards } from "@/lib/shop/catalog";
import { Icon } from "@/components/shop/icons";
import { ProductCard } from "@/components/shop/product-card";
import { contactLinks } from "@/components/shop/site-chrome";
import { GroupTile, TaskTile } from "@/components/shop/tiles";
import { btn } from "@/components/shop/ui";

export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const c = await getShopContent(lang);
  const { t, pick } = c;
  const [menu, batteries, sale] = await Promise.all([getMenuView(c.menu), getBatteries(), getSaleCards(lang)]);
  const goods = (n: number) => countWord(c.texts, "goods", n);
  const tasks = menu.tasks.filter((x) => !x.task.hidden && x.total > 0);
  const groups = menu.groups.filter((g) => !g.group.hidden && g.total > 0);
  const hints = t("home.hints").split(",").map((s) => s.trim()).filter(Boolean);
  // Кнопки «Не знайшли?»: Telegram и звонок — только те, что владелец заполнил в «Сайт → Контакти».
  const phone = contactLinks(c, t("help.call")).find((l) => l.icon === "phone");

  return (
    <>
      <section className="hm-hero">
        <h1 className="hm-h1">{t("home.title")}</h1>
        <p className="hm-lead">{t("home.lead")}</p>
        {hints.length > 0 && (
          <ul className="hm-chips">
            {hints.map((h) => <li key={h}><Link className="hm-chip" href={shopHref(lang, paths.search(h))}>{h}</Link></li>)}
          </ul>
        )}
      </section>

      {tasks.length > 0 && (
        <section className="hm-section" aria-labelledby="h-tasks">
          <h2 id="h-tasks" className="hm-h2">{t("home.tasks.title")}</h2>
          <ul className="hm-tasks">
            {tasks.map(({ task, total }) => (
              <li key={task.id}>
                <TaskTile href={shopHref(lang, paths.task(task.id))} icon={task.icon} name={pick(task.nameUk, task.nameRu)} hint={pick(task.hintUk, task.hintRu)} count={goods(total)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {batteries.length > 0 && (
        <section className="hm-section hm-battery" aria-labelledby="h-battery">
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
                <Link className="hm-battery-btn" href={shopHref(lang, paths.search(b.value))}>
                  <b>{b.value}</b><span>{goods(b.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <section className="hm-section" aria-labelledby="h-groups">
          <div className="hm-section-head">
            <h2 id="h-groups" className="hm-h2">{t("home.groups.title")}</h2>
            <Link className="hm-link" href={shopHref(lang, paths.catalog())}>{t("header.catalog")} →</Link>
          </div>
          <ul className="hm-groups">
            {groups.map((g) => (
              <li key={g.group.id}>
                <GroupTile href={shopHref(lang, paths.group(g.group.id))} image={g.image} name={pick(g.group.nameUk, g.group.nameRu)} count={goods(g.total)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {sale.length > 0 && (
        <section className="hm-section" aria-labelledby="h-sale">
          <h2 id="h-sale" className="hm-h2">{t("home.sale.title")}</h2>
          <ul className="hm-rail">
            {sale.map((card) => <li key={card.id}><ProductCard card={card} href={shopHref(lang, paths.product(card.sku))} t={t} rail /></li>)}
          </ul>
        </section>
      )}

      <section className="hm-section hm-trust" aria-label={t("trust.warranty.title")}>
        <div><Icon name="shield" size={26} /><b>{t("trust.warranty.title")}</b><span>{t("trust.warranty.text")}</span></div>
        <div><Icon name="back" size={26} /><b>{t("trust.return.title")}</b><span>{t("trust.return.text")}</span></div>
        <div><Icon name="truck" size={26} /><b>{t("trust.delivery.title")}</b><span>{t("trust.delivery.text")}</span></div>
      </section>

      <section className="hm-help" aria-labelledby="h-help">
        <h2 id="h-help" className="hm-h2">{t("help.title")}</h2>
        <p>{t("help.text")}</p>
        {(c.contacts.telegram || phone) && (
          <div className="hm-help-btns">
            {c.contacts.telegram && <a className={btn("primary")} href={c.contacts.telegram} target="_blank" rel="noopener"><Icon name="chat" size={20} />{t("help.telegram")}</a>}
            {phone && <a className={btn("secondary")} href={phone.href}><Icon name="phone" size={20} />{phone.label}</a>}
          </div>
        )}
      </section>
    </>
  );
}
