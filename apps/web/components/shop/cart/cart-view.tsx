"use client";

// Строки корзины с актуальными ценами с сервера: фото, название, наличие, цена, количество ±, убрать, итог.
// Используется в мини-корзине и на странице /cart. Если товара больше нет в продаже — он убирается с пояснением.
import { useEffect, useState } from "react";
import Image from "next/image";
import { optimizable } from "@/lib/image-hosts";
import Link from "next/link";
import { quoteCartAction, type CartQuote } from "@/app/[lang]/cart-actions";
import { formatPrice } from "../format";
import { StockBadge } from "../ui";
import { btn } from "../ui";
import { useShopCart } from "./cart-context";
import { cartStore, useCart } from "./store";

export function CartLines({ compact, onNavigate, footer, emptyExtra }: {
  compact?: boolean; onNavigate?: () => void; footer?: (hasLines: boolean) => React.ReactNode; emptyExtra?: React.ReactNode;
}) {
  const { lang, labels } = useShopCart();
  const lines = useCart();
  const key = JSON.stringify(lines);
  const [quote, setQuote] = useState<{ key: string; data: CartQuote } | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    quoteCartAction(lang, JSON.parse(key)).then((data) => {
      if (!alive) return;
      if (data.missing.length) {
        cartStore.removeMany(data.missing);
        setGone(true);
      }
      setQuote({ key, data });
    });
    return () => {
      alive = false;
    };
  }, [key, lang]);

  if (!lines.length) {
    return (
      <div className="hm-cart-empty">
        {gone && <p className="hm-alert">{labels.gone}</p>}
        <p className="hm-h2">{labels.empty}</p>
        <p className="hm-muted">{labels.emptyText}</p>
        {emptyExtra}
      </div>
    );
  }

  // пока сервер считает — показываем прошлый расчёт (если количество поменялось, суммы обновятся через мгновение)
  const data = quote?.data;
  const byS = new Map(data?.lines.map((l) => [l.sku, l]));
  const subtotal = data ? lines.reduce((a, l) => a + (byS.get(l.sku)?.price ?? 0) * l.qty, 0) : null;

  return (
    <div className={`hm-cartbox${compact ? " is-compact" : ""}`}>
      {gone && <p className="hm-alert">{labels.gone}</p>}
      <ul className="hm-cart-lines">
        {lines.map((l) => {
          const v = byS.get(l.sku);
          return (
            <li key={l.sku} className="hm-cart-line">
              <span className="hm-cart-img">{v?.image ? <Image src={v.image} alt="" fill sizes="72px" unoptimized={!optimizable(v.image)} /> : null}</span>
              <div className="hm-cart-info">
                {v ? <Link href={v.href} onClick={onNavigate} className="hm-cart-name">{v.name}</Link> : <span className="hm-skel" style={{ height: 16, width: "80%" }} />}
                {v && <StockBadge level={v.stock} labels={labels.stock} />}
                <div className="hm-cart-row">
                  <div className="hm-stepper" role="group" aria-label={labels.qtyGroup}>
                    <button type="button" aria-label={labels.qtyDec} onClick={() => cartStore.setQty(l.sku, l.qty - 1)}>−</button>
                    <span aria-live="polite">{l.qty}</span>
                    <button type="button" aria-label={labels.qtyInc} onClick={() => cartStore.setQty(l.sku, l.qty + 1)}>+</button>
                  </div>
                  <span className="hm-price">{v ? formatPrice(v.price * l.qty) : "…"}</span>
                </div>
              </div>
              <button type="button" className="hm-iconbtn hm-cart-remove" onClick={() => cartStore.remove(l.sku)} aria-label={labels.remove.replace("{name}", v?.name ?? l.sku)}>✕</button>
            </li>
          );
        })}
      </ul>
      <div className="hm-cart-total">
        <span>{labels.subtotal}</span>
        <b className="hm-price">{subtotal == null ? labels.loading : formatPrice(subtotal)}</b>
      </div>
      {footer?.(true)}
    </div>
  );
}

/** Большая корзина на странице /cart. */
export function CartPageView({ catalogHref, catalogLabel }: { catalogHref: string; catalogLabel: string }) {
  const { labels, checkoutHref } = useShopCart();
  const lines = useCart();
  return (
    <CartLines
      emptyExtra={<div><Link className={btn("primary")} href={catalogHref}>{catalogLabel}</Link></div>}
      footer={() =>
        lines.length ? (
          <div className="hm-help-btns">
            <Link className={btn("primary")} href={checkoutHref}>{labels.checkout}</Link>
          </div>
        ) : null
      }
    />
  );
}
