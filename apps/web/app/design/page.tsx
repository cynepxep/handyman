// Стенд дизайн-системы «Мастерская»: токены, типографика и все компоненты витрины во всех состояниях, на реальных товарах.
// Служебная страница (закрыта от поисковиков). Подписи разделов стенда — для владельца и разработки, в сайт не попадают.
import Link from "next/link";
import { countWord } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { getMenuView } from "@/lib/shop/catalog";
import { Icon } from "@/components/shop/icons";
import { ProductCard, cardLabels } from "@/components/shop/product-card";
import { GroupTile, TaskTile } from "@/components/shop/tiles";
import { Breadcrumbs, CardSkeletons, Pager, Price, QtyStepper, StockBadge, btn } from "@/components/shop/ui";
import { ContrastTable } from "./contrast";
import { loadSampleCards } from "./samples";
import "./ds.css";

export const dynamic = "force-dynamic";

const TOKENS: Array<[string, string]> = [
  ["--c-bg", "Фон страницы"], ["--c-surface", "Карточки, шапка"], ["--c-text", "Основной текст"], ["--c-muted", "Второстепенный текст"],
  ["--c-line", "Линии, рамки"], ["--c-chip", "Чипы, характеристики"], ["--c-primary", "Фирменный жёлтый"], ["--c-primary-hover", "Жёлтый при наведении"],
  ["--c-dark", "Тёмные блоки"], ["--c-accent", "Скидка, счётчик"], ["--c-success", "В наличии"], ["--c-warn", "Под заказ"],
];

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="ds-block">
      <h2 className="hm-h2">{title}</h2>
      {children}
    </section>
  );
}

export default async function DesignSystemPage() {
  const c = await getShopContent("uk");
  const { t } = c;
  const [samples, menu] = await Promise.all([loadSampleCards(), getMenuView(c.menu)]);
  const goods = (n: number) => countWord(c.texts, "goods", n);
  const noop = "#";

  return (
    <div className="ds">
      <header className="ds-head">
        <div>
          <p className="hm-muted">Handyman · служебная страница</p>
          <h1 className="hm-h1">Дизайн-система «Мастерская»</h1>
          <p className="hm-lead">Все элементы сайта в одном месте. Цвета и размеры — в <code>components/shop/shop.css</code>: поменяли там — поменялось везде.</p>
        </div>
        <nav className="hm-chips" aria-label="Разделы стенда">
          {[["colors", "Цвета"], ["type", "Шрифты"], ["buttons", "Кнопки"], ["labels", "Цены и метки"], ["fields", "Поля"], ["cards", "Карточки"], ["tiles", "Плитки"], ["states", "Состояния"]].map(([id, name]) => (
            <a key={id} className="hm-chip" href={`#${id}`}>{name}</a>
          ))}
          <Link className="hm-chip is-on" href="/">Открыть сайт →</Link>
          <Link className="hm-chip" href="/ru">Русская версия →</Link>
        </nav>
      </header>

      <Block id="colors" title="Цвета">
        <ul className="ds-swatches">
          {TOKENS.map(([v, label]) => (
            <li key={v}><span className="ds-swatch" style={{ background: `var(${v})` }} /><b>{label}</b><code>{v}</code></li>
          ))}
        </ul>
        <h3>Контраст текста (норма — не меньше 4,5:1)</h3>
        <ContrastTable />
      </Block>

      <Block id="type" title="Шрифты: Roboto Condensed (заголовки, цены) + Roboto (текст)">
        <p className="hm-h1">Інструмент і витратні матеріали</p>
        <p className="hm-h2">Що потрібно зробити? Ґрунтовка, їжак, є</p>
        <p>Основний текст 16 px: круг відрізний по металу 125×1,2×22,2 мм, ґатунок «А». Щодня відправляємо Новою Поштою.</p>
        <p className="hm-muted" style={{ fontSize: "var(--fs-small)" }}>Дрібний текст: підписи, лічильники, пояснення.</p>
        <p className="hm-price">999 999 ₴</p>
      </Block>

      <Block id="buttons" title="Кнопки">
        <div className="ds-row">
          <button type="button" className={btn("primary")}>{t("card.buy")}</button>
          <button type="button" className={btn("secondary")}>{t("header.catalog")}</button>
          <button type="button" className={btn("ghost")}>{t("card.buy1click")}</button>
          <button type="button" className={btn("dark")}>{t("search.submit")}</button>
          <button type="button" className={btn("primary", { small: true })}>Маленька</button>
          <button type="button" className={btn("primary")} disabled>Недоступна</button>
          <button type="button" className={btn("primary")} aria-busy="true"><span className="hm-spinner" aria-hidden="true" />Зачекайте…</button>
        </div>
        <div className="ds-row">
          <a className="hm-pill" href={noop}><Icon name="chat" size={18} />Telegram</a>
          <a className="hm-pill" href={noop}><Icon name="phone" size={18} />{t("header.help.call")}</a>
          <a className="hm-link" href={noop}>Звичайне посилання</a>
        </div>
        <p className="hm-muted">Все кнопки не ниже 44 px (удобно пальцем), у всех видна рамка при переходе клавишей Tab.</p>
      </Block>

      <Block id="labels" title="Цены, наличие, скидка, характеристики, чипы">
        <div className="ds-row" style={{ alignItems: "center" }}>
          <Price price={1599} oldPrice={1909} oldLabel={(p) => t("card.oldPrice", { price: p })} />
          <Price price={999999} oldLabel={(p) => p} />
          <span className="hm-badge hm-badge-sale">−16%</span>
          <StockBadge available inStock={t("card.inStock")} onOrder={t("card.onOrder")} />
          <StockBadge available={false} inStock={t("card.inStock")} onOrder={t("card.onOrder")} />
        </div>
        <ul className="hm-specs"><li>Діаметр 125 мм</li><li>Посадковий отвір 22,2 мм</li><li>Товщина 1,2 мм</li></ul>
        <ul className="hm-chips">
          <li><a className="hm-chip is-on" href={noop}>125 <em>5</em></a></li>
          <li><a className="hm-chip" href={noop}>180 <em>3</em></a></li>
          <li><a className="hm-chip" href={noop}>230 <em>3</em></a></li>
          <li><a className="hm-chip" href={noop}>Діаметр: 125 ✕</a></li>
        </ul>
      </Block>

      <Block id="fields" title="Поля и количество">
        <div className="ds-fields">
          <div className="hm-field">
            <label htmlFor="ds-name">{t("name")}</label>
            <input id="ds-name" className="hm-input" placeholder="Іван Петренко" />
          </div>
          <div className="hm-field">
            <label htmlFor="ds-phone">{t("phone")}</label>
            <input id="ds-phone" className="hm-input" inputMode="tel" defaultValue="+380 67" aria-invalid="true" aria-describedby="ds-phone-err" />
            <span id="ds-phone-err" className="hm-field-error">{t("errPhone")}</span>
          </div>
          <div className="hm-field">
            <label htmlFor="ds-comment">{t("comment")}</label>
            <input id="ds-comment" className="hm-input" />
            <span className="hm-field-hint">Підказка під полем</span>
          </div>
        </div>
        <QtyStepper value={2} labels={{ group: t("qty.label"), dec: t("qty.dec"), inc: t("qty.inc") }} />
        <p className="hm-muted">Поля заработают в оформлении заказа (шаг 2.6): маска телефона +380, цифровая клавиатура.</p>
      </Block>

      <Block id="cards" title="Карточки товаров (реальные трудные случаи из каталога)">
        <p className="hm-muted">На телефоне уже 480 px карточка становится строкой: фото слева, название целиком. Подписи над карточками — только на стенде.</p>
        <ul className="hm-grid">
          {samples.map(({ label, card }) => (
            <li key={card.id} className="ds-labeled">
              <span className="ds-label">{label}</span>
              <ProductCard card={card} labels={cardLabels(t)} />
            </li>
          ))}
        </ul>
        <h3>Полка на главной (прокрутка вбок)</h3>
        <ul className="hm-rail">
          {samples.map(({ card }) => <li key={card.id}><ProductCard card={card} labels={cardLabels(t)} rail /></li>)}
        </ul>
      </Block>

      <Block id="tiles" title="Плитки главной: задачи и разделы">
        <ul className="hm-tasks">
          {menu.tasks.slice(0, 4).map(({ task, total }) => (
            <li key={task.id}><TaskTile href={noop} icon={task.icon} name={task.nameUk} hint={task.hintUk} count={goods(total)} /></li>
          ))}
        </ul>
        <ul className="hm-groups">
          {menu.groups.slice(0, 6).map((g) => (
            <li key={g.group.id}><GroupTile href={noop} image={g.image} name={g.group.nameUk} count={goods(g.total)} /></li>
          ))}
        </ul>
      </Block>

      <Block id="states" title="Навигация и состояния">
        <Breadcrumbs label={t("crumbs.label")} items={[{ href: noop, label: t("crumbs.home") }, { href: noop, label: "Диски та круги" }, { label: "Відрізні по металу" }]} />
        <Pager page={6} pages={26} href={() => noop} labels={{ nav: t("pager.label"), prev: t("pager.prev"), next: t("pager.next") }} />
        <p className="hm-alert">{t("search.corrected", { q: "круг" })}</p>
        <div className="hm-empty">
          <h3 className="hm-h2">{t("search.empty.title", { q: "zzzz" })}</h3>
          <p className="hm-muted">{t("search.empty.text")}</p>
          <button type="button" className={btn("primary")}>{t("notFound.catalog")}</button>
        </div>
        <h3>Загрузка (заглушки вместо карточек)</h3>
        <CardSkeletons count={4} label={t("a11y.loading")} />
      </Block>
    </div>
  );
}
