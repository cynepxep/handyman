// Базовые элементы дизайн-системы витрины. Серверные компоненты: без JS в браузере.
// Все подписи приходят параметрами (из реестра текстов), здесь строк нет.
import { Fragment } from "react";
import Link from "next/link";
import { formatPrice } from "./format";

type Variant = "primary" | "secondary" | "ghost" | "dark";

/** Классы кнопки — для <button>, <Link> и <a>, чтобы все кнопки сайта выглядели одинаково. */
export function btn(variant: Variant = "primary", opts: { block?: boolean; small?: boolean } = {}): string {
  return ["hm-btn", `hm-btn-${variant}`, opts.block ? "hm-btn-block" : "", opts.small ? "hm-btn-sm" : ""].filter(Boolean).join(" ");
}

export type StockLabels = { local: string; supplier: string; order: string };

/** Наличие: «В наявності в Одесі» (наш склад) · «Відправка за 3–4 дні» (у поставщика) · «Під замовлення». Подписи — из админки. */
export function StockBadge({ level, labels, note }: { level: "local" | "supplier" | "order"; labels: StockLabels; note?: string }) {
  return (
    <p className={`hm-stock hm-stock-${level}`}>
      {labels[level]}
      {note && <span className="hm-stock-note">{note}</span>}
    </p>
  );
}

/** Цена: текущая крупно, старая зачёркнута (для незрячих — подпись «старая цена»). */
export function Price({ price, oldPrice, oldLabel }: { price: number; oldPrice?: number | null; oldLabel: (price: string) => string }) {
  return (
    <div className="hm-price-row">
      <span className="hm-price">{formatPrice(price)}</span>
      {oldPrice ? <s className="hm-price-old" aria-label={oldLabel(formatPrice(oldPrice))}>{formatPrice(oldPrice)}</s> : null}
    </div>
  );
}

export function Breadcrumbs({ items, label }: { items: Array<{ href?: string; label: string }>; label: string }) {
  return (
    <nav className="hm-crumbs" aria-label={label}>
      <ol>
        {items.map((it, i) => (
          <li key={`${i}-${it.label}`}>{it.href ? <Link href={it.href}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

/** Номера страниц: 1 … 4 5 [6] 7 8 … 26, плюс «Попередня» / «Наступна». */
export function Pager({ page, pages, href, labels }: {
  page: number;
  pages: number;
  href: (page: number) => string;
  labels: { nav: string; prev: string; next: string };
}) {
  if (pages <= 1) return null;
  const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages));
  const list = [...nums].sort((a, b) => a - b);
  return (
    <nav className="hm-pager" aria-label={labels.nav}>
      {page > 1 && <Link href={href(page - 1)} rel="prev">{labels.prev}</Link>}
      {list.map((n, i) => (
        <Fragment key={n}>
          {i > 0 && n - list[i - 1] > 1 && <span className="is-gap" aria-hidden="true">…</span>}
          {n === page ? <span aria-current="page">{n}</span> : <Link href={href(n)}>{n}</Link>}
        </Fragment>
      ))}
      {page < pages && <Link href={href(page + 1)} rel="next">{labels.next}</Link>}
    </nav>
  );
}

/** Счётчик количества (внешний вид; работать начнёт вместе с корзиной, шаг 2.6). */
export function QtyStepper({ value, labels }: { value: number; labels: { group: string; dec: string; inc: string } }) {
  return (
    <div className="hm-stepper" role="group" aria-label={labels.group}>
      <button type="button" aria-label={labels.dec}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={labels.inc}>+</button>
    </div>
  );
}

/** Заглушки на время загрузки: сетка карточек того же размера, что и настоящие (страница не «прыгает»). */
export function CardSkeletons({ count = 8, label }: { count?: number; label: string }) {
  return (
    <ul className="hm-grid" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="hm-card" aria-hidden="true">
          <div className="hm-card-media hm-skel" style={{ borderRadius: 0 }} />
          <div className="hm-card-body">
            <div className="hm-skel" style={{ height: 16 }} />
            <div className="hm-skel" style={{ height: 16, width: "70%" }} />
            <div className="hm-skel" style={{ height: 26, width: "45%", marginTop: 8 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
