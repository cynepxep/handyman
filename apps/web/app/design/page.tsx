/* eslint-disable @next/next/no-img-element -- в стенде фото берутся прямо с vitals.ua; оптимизация картинок — Шаг 2.5 */
import Link from "next/link";
import { loadDesignData, type Card } from "./data";

export const dynamic = "force-dynamic";

const DIRECTIONS = [
  { key: "workshop", name: "Мастерская", hint: "жёлтый + графит" },
  { key: "steel", name: "Сталь", hint: "сине-серый + оранжевый" },
  { key: "contrast", name: "Контраст", hint: "тёмная шапка, крупные цены" },
] as const;
type DirKey = (typeof DIRECTIONS)[number]["key"];

const WIDTHS = [
  { key: "auto", name: "По окну", px: 0 },
  { key: "360", name: "Телефон 360", px: 360 },
  { key: "768", name: "Планшет 768", px: 768 },
  { key: "1280", name: "Компьютер 1280", px: 1280 },
] as const;

const fmt = (n: number) => `${n.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴`;

function ProductCard({ c, qty }: { c: Card; qty?: number }) {
  return (
    <article className="dz-card">
      <div className="dz-card-media">
        {c.image ? (
          <img src={c.image} alt={c.name} loading="lazy" width={300} height={300} />
        ) : (
          <div className="dz-noimg" aria-label="Фото немає">Фото немає</div>
        )}
        {c.discountPct > 0 && <span className="dz-badge dz-badge-sale">−{c.discountPct}%</span>}
      </div>
      <div className="dz-card-body">
        <h3 className="dz-card-title">{c.name}</h3>
        <p className={c.available ? "dz-stock dz-stock-in" : "dz-stock dz-stock-order"}>
          {c.available ? "В наявності" : "Під замовлення"}
        </p>
        <div className="dz-price-row">
          <span className="dz-price">{fmt(c.price)}</span>
          {c.oldPrice && <s className="dz-old">{fmt(c.oldPrice)}</s>}
        </div>
        {qty ? (
          <div className="dz-stepper" role="group" aria-label="Кількість">
            <button type="button" aria-label="Менше">−</button>
            <span>{qty}</span>
            <button type="button" aria-label="Більше">+</button>
          </div>
        ) : (
          <button type="button" className="dz-btn dz-btn-primary dz-btn-block">У кошик</button>
        )}
      </div>
    </article>
  );
}

export default async function DesignPage({ searchParams }: { searchParams: Promise<{ d?: string; w?: string }> }) {
  const sp = await searchParams;
  const dir: DirKey = DIRECTIONS.some((x) => x.key === sp.d) ? (sp.d as DirKey) : "workshop";
  const width = WIDTHS.find((x) => x.key === sp.w) ?? WIDTHS[0];
  const href = (d: string, w: string) => `/design?d=${d}&w=${w}`;

  const data = await loadDesignData();
  const { listing } = data;
  const total = listing?.total ?? 0;
  const brandFacet = listing?.facets.brand ?? [];
  const attrs = [...(listing?.facets.attrs ?? [])].sort((a, b) => Number(b.key === "diameter") - Number(a.key === "diameter")).slice(0, 4);
  const price = listing?.facets.price;

  const shop = (
    <div className="dz-app" data-dir={dir}>
      {/* ---------- шапка ---------- */}
      <header className="dz-header">
        <div className="dz-topline">
          <span>Гарантія 12 міс.</span>
          <span>Повернення 14 днів</span>
          <span className="dz-hide-sm">Доставка по Одесі сьогодні</span>
          <span className="dz-topline-end">
            <span>+380&nbsp;XX&nbsp;XXX&nbsp;XX&nbsp;XX</span>
            <span className="dz-lang" role="group" aria-label="Мова">
              <b>УКР</b>
              <span>РУС</span>
            </span>
          </span>
        </div>
        <div className="dz-headrow">
          <a className="dz-logo" href="#">
            <span className="dz-logo-mark" aria-hidden="true">H</span>
            <span>Handyman</span>
          </a>
          <button type="button" className="dz-btn dz-btn-catalog dz-hide-sm">Каталог</button>
          <label className="dz-search">
            <span className="dz-visually-hidden">Пошук</span>
            <input type="search" placeholder="Назва або артикул" />
            <button type="button" aria-label="Знайти">⌕</button>
          </label>
          <a className="dz-cart" href="#">
            <span aria-hidden="true">🛒</span>
            <span className="dz-cart-sum">2&nbsp;450&nbsp;₴</span>
            <span className="dz-cart-count">3</span>
            <span className="dz-visually-hidden">Кошик</span>
          </a>
        </div>
      </header>

      <main className="dz-main">
        {/* ---------- категории ---------- */}
        <section className="dz-section" aria-labelledby="dz-cats">
          <h2 id="dz-cats" className="dz-h2">Категорії</h2>
          <ul className="dz-tiles">
            {data.tiles.map((t) => (
              <li key={t.id}>
                <a className="dz-tile" href="#">
                  <span className="dz-tile-img">{t.image && <img src={t.image} alt="" loading="lazy" width={120} height={120} />}</span>
                  <span className="dz-tile-name">{t.name}</span>
                  <span className="dz-tile-count">{t.total}&nbsp;товарів</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- крайние случаи ---------- */}
        <section className="dz-section" aria-labelledby="dz-edges">
          <h2 id="dz-edges" className="dz-h2">Картка товару: складні випадки з реального каталогу</h2>
          <ul className="dz-edge-list">
            {data.edges.map((e, i) => (
              <li key={e.label}>
                <p className="dz-edge-label">{e.label}</p>
                <ProductCard c={e.card} qty={i === 1 ? 2 : undefined} />
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- каталог ---------- */}
        <section className="dz-section" aria-labelledby="dz-catalog">
          <nav className="dz-crumbs" aria-label="Хлібні крихти">
            <a href="#">Головна</a> / <a href="#">Каталог</a> / <span>Результати пошуку «круг»</span>
          </nav>
          <div className="dz-cat-head">
            <h2 id="dz-catalog" className="dz-h1">Круг</h2>
            <p className="dz-muted">{total} товарів</p>
          </div>
          {data.searchDown && <p className="dz-alert">Пошук тимчасово недоступний — показано те, що вдалося завантажити.</p>}

          <div className="dz-catalog">
            <aside className="dz-filters" aria-label="Фільтри">
              <details className="dz-filter-toggle">
                <summary className="dz-btn dz-btn-secondary">Фільтри <span className="dz-count-pill">3</span></summary>
                <div className="dz-filter-panel">
                  <FilterGroups brandFacet={brandFacet} attrs={attrs} price={price ?? null} />
                  <div className="dz-apply">
                    <button type="button" className="dz-btn dz-btn-primary dz-btn-block">Показати 48 товарів</button>
                  </div>
                </div>
              </details>
              <div className="dz-filter-side">
                <FilterGroups brandFacet={brandFacet} attrs={attrs} price={price ?? null} />
              </div>
            </aside>

            <div className="dz-results">
              <div className="dz-toolbar">
                <ul className="dz-chips" aria-label="Обрані фільтри">
                  <li><button type="button" className="dz-chip">Діаметр: 125 мм ✕</button></li>
                  <li><button type="button" className="dz-chip">В наявності ✕</button></li>
                  <li><button type="button" className="dz-chip dz-chip-clear">Скинути все</button></li>
                </ul>
                <label className="dz-sort">
                  <span className="dz-visually-hidden">Сортування</span>
                  <select defaultValue="relevance">
                    <option value="relevance">За релевантністю</option>
                    <option value="price_asc">Спочатку дешевші</option>
                    <option value="price_desc">Спочатку дорожчі</option>
                  </select>
                </label>
              </div>
              <ul className="dz-grid">
                {data.listingCards.map((c) => (
                  <li key={c.id}><ProductCard c={c} /></li>
                ))}
              </ul>
              <div className="dz-more">
                <button type="button" className="dz-btn dz-btn-secondary">Показати ще 12</button>
                <p className="dz-muted">Показано 12 з {total}</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ---------- нижняя панель телефона ---------- */}
      <nav className="dz-bottomnav" aria-label="Основна навігація">
        <a href="#"><span aria-hidden="true">☰</span>Каталог</a>
        <a href="#"><span aria-hidden="true">⌕</span>Пошук</a>
        <a href="#"><span aria-hidden="true">🛒</span>Кошик</a>
        <a href="#"><span aria-hidden="true">☺</span>Кабінет</a>
      </nav>
    </div>
  );

  return (
    <div className="dz-root">
      <div className="dz-bar">
        <div className="dz-bar-row">
          <strong>Стенд дизайна</strong>
          <nav aria-label="Направление">
            {DIRECTIONS.map((x) => (
              <Link key={x.key} href={href(x.key, width.key)} className={x.key === dir ? "on" : ""} title={x.hint}>
                {x.name}
              </Link>
            ))}
          </nav>
        </div>
        <div className="dz-bar-row">
          <span>Ширина:</span>
          <nav aria-label="Ширина экрана">
            {WIDTHS.map((x) => (
              <Link key={x.key} href={href(dir, x.key)} className={x.key === width.key ? "on" : ""}>
                {x.name}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {width.px ? (
        <div className="dz-stage">
          <div className="dz-frame" style={{ width: `min(100%, ${width.px}px)` }}>{shop}</div>
        </div>
      ) : (
        shop
      )}
    </div>
  );
}

function FilterGroups({
  brandFacet,
  attrs,
  price,
}: {
  brandFacet: { value: string; count: number; selected: boolean }[];
  attrs: { key: string; label: string; values: { value: string; count: number; selected: boolean }[] }[];
  price: { min: number; max: number } | null;
}) {
  return (
    <>
      <label className="dz-check dz-check-row"><input type="checkbox" defaultChecked /> В наявності</label>
      <label className="dz-check dz-check-row"><input type="checkbox" /> Зі знижкою</label>
      {price && (
        <fieldset className="dz-fgroup">
          <legend>Ціна, ₴</legend>
          <div className="dz-range">
            <input type="text" inputMode="numeric" placeholder={String(Math.floor(price.min))} aria-label="Ціна від" />
            <span>—</span>
            <input type="text" inputMode="numeric" placeholder={String(Math.ceil(price.max))} aria-label="Ціна до" />
          </div>
        </fieldset>
      )}
      {brandFacet.length > 0 && (
        <details className="dz-fgroup" open>
          <summary>Бренд</summary>
          {brandFacet.slice(0, 5).map((b) => (
            <label key={b.value} className="dz-check"><input type="checkbox" defaultChecked={b.selected} /> <span>{b.value}</span> <em>{b.count}</em></label>
          ))}
        </details>
      )}
      {attrs.map((a, i) => (
        <details key={a.key} className="dz-fgroup" open={i < 2}>
          <summary>{a.label}</summary>
          {a.values.slice(0, 6).map((v, j) => (
            <label key={v.value} className="dz-check">
              <input type="checkbox" defaultChecked={a.key === "diameter" && j === 0} /> <span>{v.value}</span> <em>{v.count}</em>
            </label>
          ))}
          {a.values.length > 6 && <button type="button" className="dz-linkbtn">Показати ще {a.values.length - 6}</button>}
        </details>
      ))}
    </>
  );
}
