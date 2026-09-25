"use client";

// Клиентские части списка товаров: фильтры (на компьютере — слева и сразу; на телефоне — шторка снизу с кнопкой «Показати N»),
// сортировка и «Показати ще» (догрузка без перезагрузки страницы). Все подписи приходят готовыми строками.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { listingQuery, filterCount, clearFilters, type ListingSort, type ListingState } from "@handyman/core/site/listing";
import type { ShopLang } from "@handyman/core/site/routes";
import { countAction, loadMoreAction } from "@/app/[lang]/listing-actions";
import type { ListingKey } from "@/lib/shop/listing";
import { Icon } from "./icons";
import { ProductCard, type CardData, type CardLabels } from "./product-card";
import { btn } from "./ui";

export type FacetGroup = { key: string; label: string; values: Array<{ value: string; count: number; selected: boolean }> };
export type FilterLabels = {
  title: string; show: string; reset: string; price: string; from: string; to: string; apply: string; moreValues: string; less: string;
  inStock: string; fast: string; sale: string; close: string; goods: [string, string, string];
};

/** 1 товар, 2 товари, 5 товарів (формы слова приходят из реестра текстов). */
function goodsWord(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}

const VISIBLE_VALUES = 8;

function FacetBlock({ g, draft, onToggle, labels }: { g: FacetGroup; draft: ListingState; onToggle: (key: string, value: string) => void; labels: FilterLabels }) {
  const [open, setOpen] = useState(false);
  const selected = draft.facets[g.key] ?? [];
  const values = open ? g.values : g.values.slice(0, VISIBLE_VALUES);
  const hiddenCount = g.values.length - VISIBLE_VALUES;
  return (
    <fieldset className="hm-fgroup">
      <legend>{g.label}</legend>
      {values.map((v) => (
        <label key={v.value} className="hm-check">
          <input type="checkbox" checked={selected.includes(v.value)} onChange={() => onToggle(g.key, v.value)} />
          <span>{v.value}</span>
          <em>{v.count}</em>
        </label>
      ))}
      {hiddenCount > 0 && (
        <button type="button" className="hm-linkbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? labels.less : labels.moreValues.replace("{n}", String(hiddenCount))}
        </button>
      )}
    </fieldset>
  );
}

type PanelProps = {
  lang: ShopLang;
  listingKey: ListingKey;
  /** адрес страницы без ?запроса (уже с языком) */
  base: string;
  q?: string;
  state: ListingState;
  attrs: FacetGroup[];
  price: { min: number; max: number } | null;
  total: number;
  /** показывать «Швидка відправка з Одеси» (есть товары на нашем складе) */
  hasLocal: boolean;
  labels: FilterLabels;
};

/** Форма фильтров. `live` — применять сразу (компьютер); иначе копить выбор и показывать, сколько найдётся (шторка). */
function FilterForm({ p, live, onApplied }: { p: PanelProps; live: boolean; onApplied?: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ListingState>(p.state);
  const [count, setCount] = useState<number | null>(p.total);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  const go = (s: ListingState) => {
    router.push(`${p.base}${listingQuery({ ...s, page: 1 }, p.q)}`, { scroll: false });
    onApplied?.();
  };
  const update = (s: ListingState) => {
    setDraft(s);
    if (live) return go(s);
    const my = ++seq.current;
    start(async () => {
      const n = await countAction(p.lang, p.listingKey, listingQuery({ ...s, page: 1 }));
      if (my === seq.current) setCount(n);
    });
  };
  const toggle = (key: string, value: string) => {
    const cur = draft.facets[key] ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    const facets = { ...draft.facets };
    if (next.length) facets[key] = next;
    else delete facets[key];
    update({ ...draft, facets, page: 1 });
  };
  const priceNum = (v: string) => {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return v.trim() === "" || !Number.isFinite(n) ? undefined : n;
  };

  return (
    <form
      className="hm-filter-form"
      onSubmit={(e) => {
        e.preventDefault();
        go(draft);
      }}
    >
      <label className="hm-check hm-check-strong">
        <input type="checkbox" checked={draft.available} onChange={(e) => update({ ...draft, available: e.target.checked, page: 1 })} />
        <span>{p.labels.inStock}</span>
      </label>
      {(p.hasLocal || draft.local) && (
        <label className="hm-check hm-check-strong">
          <input type="checkbox" checked={draft.local} onChange={(e) => update({ ...draft, local: e.target.checked, page: 1 })} />
          <span>{p.labels.fast}</span>
        </label>
      )}
      <label className="hm-check hm-check-strong">
        <input type="checkbox" checked={draft.sale} onChange={(e) => update({ ...draft, sale: e.target.checked, page: 1 })} />
        <span>{p.labels.sale}</span>
      </label>
      {p.price && (
        <fieldset className="hm-fgroup">
          <legend>{p.labels.price}</legend>
          <div className="hm-range">
            <input
              className="hm-input" inputMode="numeric" aria-label={`${p.labels.price}: ${p.labels.from}`} placeholder={`${p.labels.from} ${Math.floor(p.price.min)}`}
              defaultValue={draft.min ?? ""} onBlur={(e) => !live && update({ ...draft, min: priceNum(e.target.value), page: 1 })}
              onChange={(e) => live && setDraft({ ...draft, min: priceNum(e.target.value) })}
            />
            <span aria-hidden="true">—</span>
            <input
              className="hm-input" inputMode="numeric" aria-label={`${p.labels.price}: ${p.labels.to}`} placeholder={`${p.labels.to} ${Math.ceil(p.price.max)}`}
              defaultValue={draft.max ?? ""} onBlur={(e) => !live && update({ ...draft, max: priceNum(e.target.value), page: 1 })}
              onChange={(e) => live && setDraft({ ...draft, max: priceNum(e.target.value) })}
            />
          </div>
          {live && <button type="submit" className={btn("secondary", { small: true, block: true })}>{p.labels.apply}</button>}
        </fieldset>
      )}
      {p.attrs.map((g) => <FacetBlock key={g.key} g={g} draft={draft} onToggle={toggle} labels={p.labels} />)}
      {!live && (
        <div className="hm-sheet-actions">
          <button type="button" className={btn("ghost")} onClick={() => update(clearFilters(draft))}>{p.labels.reset}</button>
          <button type="submit" className={btn("primary")} aria-busy={pending}>
            {pending ? <span className="hm-spinner" aria-hidden="true" /> : null}
            {p.labels.show.replace("{n}", count == null ? "" : goodsWord(count, p.labels.goods))}
          </button>
        </div>
      )}
    </form>
  );
}

/** Фильтры слева (компьютер): применяются сразу. */
export function FilterSide(p: PanelProps) {
  return (
    <aside className="hm-filters-side" aria-label={p.labels.title}>
      <FilterForm p={p} live />
    </aside>
  );
}

/** Кнопка «Фільтри» и шторка снизу (телефон, планшет). */
export function FilterSheet(p: PanelProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const n = filterCount(p.state);
  return (
    <>
      <button type="button" className={`${btn("secondary")} hm-filters-btn`} onClick={() => ref.current?.showModal()} aria-haspopup="dialog">
        <Icon name="menu" size={20} />
        {p.labels.title}
        {n > 0 && <span className="hm-count-pill">{n}</span>}
      </button>
      <dialog ref={ref} className="hm-sheet" aria-label={p.labels.title} onClick={(e) => e.target === ref.current && ref.current?.close()}>
        <div className="hm-sheet-head">
          <b>{p.labels.title}</b>
          <button type="button" className="hm-iconbtn" onClick={() => ref.current?.close()} aria-label={p.labels.close}>✕</button>
        </div>
        <FilterForm p={p} live={false} onApplied={() => ref.current?.close()} />
      </dialog>
    </>
  );
}

/** Сортировка: применяется сразу. */
export function SortSelect({ base, q, state, options, label }: {
  base: string; q?: string; state: ListingState; options: Array<{ value: ListingSort | ""; label: string }>; label: string;
}) {
  const router = useRouter();
  return (
    <label className="hm-sort">
      <span className="hm-vh">{label}</span>
      <select
        className="hm-input"
        value={state.sort ?? ""}
        onChange={(e) => {
          const v = e.target.value as ListingSort | "";
          const next: ListingState = { ...state, page: 1 };
          if (v) next.sort = v;
          else delete next.sort;
          router.push(`${base}${listingQuery(next, q)}`, { scroll: false });
        }}
      >
        {options.map((o) => <option key={o.value || "default"} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** «Показати ще»: догружает следующие страницы под уже показанными карточками. */
export function LoadMore({ lang, listingKey, query, page, pages, total, shownFirst, perPage, labels }: {
  lang: ShopLang; listingKey: ListingKey; query: string; page: number; pages: number; total: number; shownFirst: number; perPage: number;
  labels: { card: CardLabels; more: string; loading: string; shown: string };
}) {
  const [cards, setCards] = useState<CardData[]>([]);
  const [last, setLast] = useState(page);
  const [pending, start] = useTransition();
  // сколько товаров уже видно с начала списка (с учётом того, что страница могла открыться не с первой)
  const seen = (page - 1) * perPage + shownFirst + cards.length;
  const left = Math.max(0, total - seen);
  const canMore = last < pages && left > 0;

  return (
    <>
      {cards.length > 0 && (
        <ul className="hm-grid hm-grid-more">
          {cards.map((c) => <li key={c.id}><ProductCard card={c} labels={labels.card} /></li>)}
        </ul>
      )}
      <div className="hm-more">
        <p className="hm-muted" aria-live="polite">{labels.shown.replace("{n}", String(seen)).replace("{total}", String(total))}</p>
        {canMore && (
          <button
            type="button"
            className={btn("secondary")}
            aria-busy={pending}
            onClick={() =>
              start(async () => {
                const res = await loadMoreAction(lang, listingKey, query, last + 1);
                setCards((prev) => [...prev, ...res.cards.filter((c) => !prev.some((p) => p.id === c.id))]);
                setLast((l) => l + 1);
              })
            }
          >
            {pending ? <><span className="hm-spinner" aria-hidden="true" />{labels.loading}</> : labels.more.replace("{n}", String(Math.min(perPage, left)))}
          </button>
        )}
      </div>
    </>
  );
}
