/* eslint-disable @next/next/no-img-element -- в стенде фото берутся прямо с vitals.ua; оптимизация картинок — Шаг 2.5 */
import Link from "next/link";
import { DEMOS, loadV2, type V2Card, type V2Data } from "./data";
import { DEFAULT_FONT, FONT_CLASSES, FONT_PAIRS } from "./fonts";
import { Icon } from "./icons";
import "./v2.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Мастерская v2 (служебная)", robots: { index: false, follow: false } };

type Params = { s?: string; w?: string; f?: string; c?: string; pick?: string };
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

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const goods = (n: number) => `${n}\u00A0${plural(n, "товар", "товари", "товарів")}`;
const fmt = (n: number) => `${n.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴`;
const TASK_DEMO: Record<string, string> = { cut: "cut", drill: "drill", screw: "bits" };
const SUB_DEMO: Record<string, string> = { "discs-cut": "cut", "drills-metal": "drill", "hand-screw": "bits" };

export default async function V2Page({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const screen = SCREENS.some((x) => x.key === sp.s) ? (sp.s as string) : "home";
  const width = WIDTHS.find((x) => x.key === sp.w) ?? WIDTHS[0];
  const font = FONT_PAIRS.some((x) => x.key === sp.f) ? (sp.f as string) : DEFAULT_FONT;
  const demoKey = DEMOS.some((d) => d.key === sp.c) ? sp.c : DEMOS[0].key;

  const data = await loadV2({ screen, demoKey, pick: sp.pick });
  const href = (over: Partial<Params>) => {
    const q = new URLSearchParams({ s: screen, w: width.key, f: font, ...(screen === "category" ? { c: demoKey! } : {}) });
    for (const [k, v] of Object.entries(over)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    return `/design/v2?${q.toString()}`;
  };

  const shop = (
    <div className={`v2 ${FONT_CLASSES}`} data-font={font}>
      <Header />
      <main className="v2-main">
        {data.problems.length > 0 && (
          <div className="v2-problems" role="alert">
            <b>Проверка меню нашла проблемы:</b>
            <ul>{data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {screen === "home" && <Home data={data} href={href} />}
        {screen === "menu" && <MenuScreen data={data} href={href} />}
        {screen === "category" && <CategoryScreen data={data} href={href} />}
        <Footer />
      </main>
      <nav className="v2-bottomnav" aria-label="Основна навігація">
        <Link href={href({ s: "home" })}><Icon name="bolt" size={22} />Головна</Link>
        <Link href={href({ s: "menu" })}><Icon name="menu" size={22} />Каталог</Link>
        <a href="#"><Icon name="cart" size={22} />Кошик</a>
        <a href="#"><Icon name="user" size={22} />Кабінет</a>
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
        </div>
        <div className="v2-bar-row">
          <span>Шрифт:</span>
          <nav aria-label="Шрифт">
            {FONT_PAIRS.map((x) => <Link key={x.key} href={href({ f: x.key })} className={x.key === font ? "on" : ""}>{x.label}</Link>)}
          </nav>
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

function Header() {
  return (
    <header className="v2-header">
      <div className="v2-topline">
        <span>Гарантія 12 міс.</span>
        <span>Повернення 14 днів</span>
        <span className="v2-hide-sm">Доставка по Одесі сьогодні</span>
        <span className="v2-topline-end">
          <span className="v2-hide-sm">+380&nbsp;XX&nbsp;XXX&nbsp;XX&nbsp;XX</span>
          <span className="v2-lang" role="group" aria-label="Мова"><b>УКР</b><span>РУС</span></span>
        </span>
      </div>
      <div className="v2-headrow">
        <a className="v2-logo" href="#"><span className="v2-logo-mark" aria-hidden="true">H</span><span>Handyman</span></a>
        <button type="button" className="v2-btn v2-btn-primary v2-catalog-btn v2-hide-sm"><Icon name="menu" size={20} />Каталог</button>
        <label className="v2-search">
          <span className="v2-vh">Пошук</span>
          <input type="search" placeholder="Назва або артикул" />
          <button type="button" aria-label="Знайти"><Icon name="search" size={22} /></button>
        </label>
        <a className="v2-cart" href="#"><Icon name="cart" size={26} /><span className="v2-cart-sum">2&nbsp;450&nbsp;₴</span><span className="v2-cart-count">3</span><span className="v2-vh">Кошик</span></a>
      </div>
      <div className="v2-contact">
        <span className="v2-contact-text">Не впевнені, що обрати? Підкажемо:</span>
        <a className="v2-pill" href="#"><Icon name="chat" size={18} />Telegram</a>
        <a className="v2-pill" href="#"><Icon name="chat" size={18} />Viber</a>
        <a className="v2-pill" href="#"><Icon name="phone" size={18} />Подзвонити</a>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="v2-footer">
      <p className="v2-footer-title">Handyman — магазин інструменту, Одеса</p>
      <p>Адреса, телефон і графік роботи — <b>заглушка</b>, чекаємо від власника (питання В3).</p>
      <p>Доставка й оплата · Гарантія та повернення · Публічна оферта · Контакти</p>
    </footer>
  );
}

function ProductCard({ c, rail }: { c: V2Card; rail?: boolean }) {
  return (
    <article className={`v2-card${rail ? " v2-card-rail" : ""}`}>
      <div className="v2-card-media">
        {c.image ? <img src={c.image} alt={c.name} loading="lazy" width={300} height={300} /> : <div className="v2-noimg">Фото немає</div>}
        {c.discountPct > 0 && <span className="v2-badge">−{c.discountPct}%</span>}
      </div>
      <div className="v2-card-body">
        <h3 className="v2-card-title"><a href="#">{c.name}</a></h3>
        {c.specs.length > 0 && <ul className="v2-specs" aria-label="Ключові характеристики">{c.specs.map((s) => <li key={s.key}>{s.text}</li>)}</ul>}
        <p className={c.available ? "v2-stock v2-in" : "v2-stock v2-order"}>{c.available ? "В наявності" : "Під замовлення"}</p>
        <div className="v2-price-row">
          <span className="v2-price">{fmt(c.price)}</span>
          {c.oldPrice && <s className="v2-old">{fmt(c.oldPrice)}</s>}
        </div>
        <div className="v2-actions">
          <button type="button" className="v2-btn v2-btn-primary">У кошик</button>
          <button type="button" className="v2-btn v2-btn-ghost">Купити в 1 клік</button>
        </div>
      </div>
    </article>
  );
}

type Href = (over: Partial<Params>) => string;

// ---------- Головна ----------

function Home({ data, href }: { data: V2Data; href: Href }) {
  return (
    <>
      <section className="v2-hero">
        <h1 className="v2-h1">Інструмент і витратні матеріали</h1>
        <p className="v2-lead">Оберіть, що потрібно зробити, — покажемо, що підійде. Або знайдіть за назвою чи артикулом.</p>
        <ul className="v2-hints" aria-label="Приклади запитів">
          <li>круг 125</li><li>свердло 6 мм</li><li>болгарка</li><li>000237651</li>
        </ul>
      </section>

      <section className="v2-section" aria-labelledby="v2-tasks">
        <h2 id="v2-tasks" className="v2-h2">Що потрібно зробити?</h2>
        <ul className="v2-tasks">
          {data.tasks.map(({ task, total }) => (
            <li key={task.id}>
              <Link className="v2-task" href={TASK_DEMO[task.id] ? href({ s: "category", c: TASK_DEMO[task.id], pick: undefined }) : href({ s: "menu" })}>
                <span className="v2-task-icon"><Icon name={task.icon} size={28} /></span>
                <span className="v2-task-name">{task.nameUk}</span>
                <span className="v2-task-hint">{task.hintUk}</span>
                <span className="v2-task-count">{goods(total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {data.batteries.length > 0 && (
        <section className="v2-section v2-battery" aria-labelledby="v2-bat">
          <div className="v2-battery-head">
            <span className="v2-task-icon"><Icon name="battery" size={28} /></span>
            <div>
              <h2 id="v2-bat" className="v2-h2">Яка у вас батарея?</h2>
              <p className="v2-muted">Покажемо інструмент, акумулятори й зарядки, які підходять саме до неї.</p>
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
        <h2 id="v2-groups" className="v2-h2">Каталог</h2>
        <ul className="v2-groups">
          {data.groups.map((g) => (
            <li key={g.group.id}>
              <Link className="v2-group" href={href({ s: "menu" })}>
                <span className="v2-group-img">{g.image && <img src={g.image} alt="" loading="lazy" width={120} height={120} />}</span>
                <span className="v2-group-name">{g.group.nameUk}</span>
                <span className="v2-group-count">{goods(g.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {data.sale.length > 0 && (
        <section className="v2-section" aria-labelledby="v2-sale">
          <h2 id="v2-sale" className="v2-h2">Вигідні пропозиції</h2>
          <ul className="v2-rail">
            {data.sale.map((c) => <li key={c.id}><ProductCard c={c} rail /></li>)}
          </ul>
        </section>
      )}

      <section className="v2-section v2-trust" aria-label="Чому нам довіряють">
        <div><Icon name="shield" size={26} /><b>Гарантія 12 місяців</b><span>на весь інструмент</span></div>
        <div><Icon name="back" size={26} /><b>Повернення 14 днів</b><span>без зайвих запитань</span></div>
        <div><Icon name="truck" size={26} /><b>Доставка сьогодні</b><span>по Одесі; Нова Пошта — по Україні</span></div>
      </section>

      <section className="v2-section v2-help" aria-labelledby="v2-help">
        <h2 id="v2-help" className="v2-h2">Не знайшли? Підберемо</h2>
        <p>Опишіть задачу або надішліть фото — підкажемо, що взяти. Відповідаємо в робочий час.</p>
        <div className="v2-help-btns">
          <a className="v2-btn v2-btn-primary" href="#"><Icon name="chat" size={20} />Написати в Telegram</a>
          <a className="v2-btn v2-btn-secondary" href="#"><Icon name="phone" size={20} />Зателефонувати</a>
        </div>
      </section>
    </>
  );
}

// ---------- Меню «Каталог» ----------

function MenuScreen({ data, href }: { data: V2Data; href: Href }) {
  return (
    <section className="v2-section" aria-labelledby="v2-menu-h">
      <nav className="v2-crumbs" aria-label="Хлібні крихти"><Link href={href({ s: "home" })}>Головна</Link> / <span>Каталог</span></nav>
      <h1 id="v2-menu-h" className="v2-h1">Каталог</h1>
      <p className="v2-muted">Розділи названі так, як звикли шукати покупці. Категорії постачальника не змінювались.</p>
      <ul className="v2-menu">
        {data.groups.map((g) => (
          <li key={g.group.id} className="v2-menu-group">
            <details open={g.group.id === "discs"}>
              <summary>
                <span className="v2-group-img v2-group-img-sm">{g.image && <img src={g.image} alt="" loading="lazy" width={64} height={64} />}</span>
                <span className="v2-menu-title"><b>{g.group.nameUk}</b><small>{g.group.hintUk}</small></span>
                <span className="v2-group-count">{g.total}</span>
              </summary>
              <ul className="v2-menu-subs">
                {g.subs.map((s) => (
                  <li key={s.id}>
                    <Link href={SUB_DEMO[s.id] ? href({ s: "category", c: SUB_DEMO[s.id], pick: undefined }) : "#"}>
                      <span>{s.nameUk}</span><em>{s.total}</em>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Категория ----------

function CategoryScreen({ data, href }: { data: V2Data; href: Href }) {
  const c = data.category;
  if (!c) return <p className="v2-alert">Пошук тимчасово недоступний. Спробуйте пізніше.</p>;
  const sub = c.subsInGroup.find((s) => s.id === c.demo.subId);
  return (
    <section className="v2-section" aria-labelledby="v2-cat-h">
      <nav className="v2-crumbs" aria-label="Хлібні крихти">
        <Link href={href({ s: "home" })}>Головна</Link> / <Link href={href({ s: "menu" })}>Каталог</Link> / <span>{c.group.nameUk}</span>{sub && <> / <span>{sub.nameUk}</span></>}
      </nav>
      <div className="v2-cat-head">
        <h1 id="v2-cat-h" className="v2-h1">{sub?.nameUk ?? c.group.nameUk}</h1>
        <p className="v2-muted">{goods(c.total)}</p>
      </div>

      {c.subsInGroup.length > 1 && (
        <ul className="v2-subchips" aria-label="Розділи групи">
          {c.subsInGroup.map((s) => (
            <li key={s.id}><Link className={s.id === c.demo.subId ? "on" : ""} href={SUB_DEMO[s.id] ? href({ c: SUB_DEMO[s.id], pick: undefined }) : "#"}>{s.nameUk} <em>{s.total}</em></Link></li>
          ))}
        </ul>
      )}

      {c.quickValues.length > 0 && (
        <div className="v2-quick">
          <p className="v2-quick-title">{c.quickKey === "series" ? "Яка у вас батарея?" : `Оберіть: ${c.quickLabel}`}</p>
          <ul className={`v2-quick-list${c.quickValues.length > 8 ? " v2-quick-scroll" : ""}`}>
            <li><Link className={!c.pick ? "on" : ""} href={href({ pick: undefined })}>Усі</Link></li>
            {c.quickValues.map((v) => (
              <li key={v.value}><Link className={v.value === c.pick ? "on" : ""} href={href({ pick: v.value })}>{v.value}<em>{v.count}</em></Link></li>
            ))}
          </ul>
        </div>
      )}

      <div className="v2-catalog">
        <aside className="v2-filters" aria-label="Фільтри">
          <details className="v2-filter-toggle">
            <summary className="v2-btn v2-btn-secondary">Усі фільтри</summary>
            <div className="v2-filter-panel"><FilterGroups c={c} /></div>
          </details>
          <div className="v2-filter-side"><FilterGroups c={c} /></div>
        </aside>
        <div className="v2-results">
          <div className="v2-toolbar">
            <ul className="v2-chips" aria-label="Обрані фільтри">
              {c.pick && <li><Link className="v2-chip" href={href({ pick: undefined })}>{c.quickLabel.split(",")[0]}: {c.pick} ✕</Link></li>}
            </ul>
            <label className="v2-sort"><span className="v2-vh">Сортування</span>
              <select defaultValue="rel"><option value="rel">За релевантністю</option><option value="asc">Спочатку дешевші</option><option value="desc">Спочатку дорожчі</option></select>
            </label>
          </div>
          {c.cards.length === 0 ? <p className="v2-alert">За цим вибором нічого немає.</p> : (
            <ul className="v2-grid">{c.cards.map((card) => <li key={card.id}><ProductCard c={card} /></li>)}</ul>
          )}
          <div className="v2-more">
            <button type="button" className="v2-btn v2-btn-secondary">Показати ще 12</button>
            <p className="v2-muted">Показано {c.cards.length} з {c.total}</p>
          </div>
          <div className="v2-help v2-help-inline">
            <b>Не знайшли потрібне?</b> <span>Напишіть — підберемо аналог.</span>
            <a className="v2-pill" href="#"><Icon name="chat" size={18} />Telegram</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function FilterGroups({ c }: { c: NonNullable<V2Data["category"]> }) {
  return (
    <>
      <label className="v2-check v2-check-row"><input type="checkbox" defaultChecked /> В наявності</label>
      <label className="v2-check v2-check-row"><input type="checkbox" /> Зі знижкою</label>
      {c.price && (
        <fieldset className="v2-fgroup">
          <legend>Ціна, ₴</legend>
          <div className="v2-range">
            <input type="text" inputMode="numeric" placeholder={String(Math.floor(c.price.min))} aria-label="Ціна від" /><span>—</span>
            <input type="text" inputMode="numeric" placeholder={String(Math.ceil(c.price.max))} aria-label="Ціна до" />
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
