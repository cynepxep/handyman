"use client";

// Корзина на всех страницах витрины: мини-корзина, которая выезжает сбоку, и окно «Купити в 1 клік».
// Кнопки (cart-buttons.tsx) открывают их через контекст. Все подписи приходят из реестра текстов (layout).
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { ShopLang } from "@handyman/core/site/routes";
import { oneClickAction } from "@/app/[lang]/cart-actions";
import type { StockLabels } from "../ui";
import { btn } from "../ui";
import { Icon } from "../icons";
import { CartLines } from "./cart-view";
import { PhoneInput } from "./phone-input";
import { cartStore, useCart } from "./store";

const SHOWN_KEY = "hm.cartShown";

/** Фото товара «летит» от кнопки к круглой кнопке корзины. Без анимации, если в телефоне включено «меньше движения». */
function flyToCart(from: Element | null | undefined) {
  const target = document.querySelector(".hm-fab-cart");
  const img = from?.closest("article, .hm-product")?.querySelector("img");
  if (!target || !img || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const a = img.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const ghost = img.cloneNode() as HTMLImageElement;
  Object.assign(ghost.style, { position: "fixed", left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px", objectFit: "contain", zIndex: "80", pointerEvents: "none", borderRadius: "12px", background: "#fff" });
  ghost.removeAttribute("srcset");
  ghost.src = (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src;
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = ghost.animate(
    [{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(0.12)`, opacity: 0.6 }],
    { duration: 650, easing: "cubic-bezier(.5,-0.2,.7,1)" },
  );
  anim.onfinish = () => ghost.remove();
  anim.oncancel = () => ghost.remove();
}

export type CartUiLabels = {
  cart: string; empty: string; emptyText: string; subtotal: string; checkout: string; continueShopping: string;
  /** «Прибрати з кошика: {name}» */ remove: string;
  gone: string; loading: string; qtyGroup: string; qtyDec: string; qtyInc: string; close: string;
  /** «Кошик: {n}» */ openCart: string;
  stock: StockLabels;
  oneClickTitle: string; oneClickLead: string; phone: string; oneClickName: string; oneClickSubmit: string; sending: string;
};

type Ctx = {
  lang: ShopLang;
  labels: CartUiLabels;
  checkoutHref: string;
  cartHref: string;
  openCart: () => void;
  /** Положить товар: первый раз за визит — открыть мини-корзину, дальше — «полёт» фото в круглую кнопку корзины. */
  addToCart: (sku: string, from?: Element | null) => void;
  openOneClick: (sku: string, name: string) => void;
};

const CartContext = createContext<Ctx | null>(null);

export function useShopCart(): Ctx {
  const c = useContext(CartContext);
  if (!c) throw new Error("useShopCart вне ShopCartProvider");
  return c;
}

export function ShopCartProvider({ lang, labels, checkoutHref, cartHref, children }: {
  lang: ShopLang; labels: CartUiLabels; checkoutHref: string; cartHref: string; children: React.ReactNode;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const oneClick = useRef<HTMLDialogElement>(null);
  const [oc, setOc] = useState<{ sku: string; name: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const value: Ctx = {
    lang, labels, checkoutHref, cartHref,
    openCart: () => {
      drawer.current?.showModal();
      setDrawerOpen(true);
    },
    addToCart: (sku, from) => {
      cartStore.add(sku, 1);
      let shown = false;
      try {
        shown = sessionStorage.getItem(SHOWN_KEY) === "1";
        sessionStorage.setItem(SHOWN_KEY, "1");
      } catch {
        /* нет хранилища — ведём себя как в первый раз */
      }
      if (!shown) {
        drawer.current?.showModal();
        setDrawerOpen(true);
      } else {
        // круглая кнопка появляется после перерисовки — запускаем полёт на следующем кадре
        setTimeout(() => flyToCart(from), 30);
      }
    },
    openOneClick: (sku, name) => {
      setOc({ sku, name });
      oneClick.current?.showModal();
    },
  };

  return (
    <CartContext.Provider value={value}>
      {children}
      <FloatingCart label={labels.openCart} onOpen={() => {
        drawer.current?.showModal();
        setDrawerOpen(true);
      }} />
      <dialog
        ref={drawer}
        className="hm-drawer"
        aria-label={labels.cart}
        onClose={() => setDrawerOpen(false)}
        onClick={(e) => e.target === drawer.current && drawer.current?.close()}
      >
        <div className="hm-drawer-head">
          <b>{labels.cart}</b>
          <button type="button" className="hm-iconbtn" onClick={() => drawer.current?.close()} aria-label={labels.close}>✕</button>
        </div>
        {drawerOpen && (
          <CartLines
            compact
            onNavigate={() => drawer.current?.close()}
            footer={(hasLines) =>
              hasLines ? (
                <div className="hm-drawer-actions">
                  <Link className={btn("primary", { block: true })} href={checkoutHref} onClick={() => drawer.current?.close()}>{labels.checkout}</Link>
                  <button type="button" className={btn("ghost", { block: true })} onClick={() => drawer.current?.close()}>{labels.continueShopping}</button>
                </div>
              ) : null
            }
          />
        )}
      </dialog>
      <dialog ref={oneClick} className="hm-modal" aria-label={labels.oneClickTitle} onClick={(e) => e.target === oneClick.current && oneClick.current?.close()}>
        {oc && <OneClickForm key={oc.sku} sku={oc.sku} name={oc.name} onClose={() => oneClick.current?.close()} />}
      </dialog>
    </CartContext.Provider>
  );
}

function OneClickForm({ sku, name, onClose }: { sku: string; name: string; onClose: () => void }) {
  const { lang, labels } = useShopCart();
  const [phone, setPhone] = useState("");
  const [who, setWho] = useState("");
  const [trap, setTrap] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="hm-modal-body"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await oneClickAction(lang, { sku, qty: 1, phone, name: who, website: trap })));
      }}
    >
      <div className="hm-drawer-head">
        <b>{labels.oneClickTitle}</b>
        <button type="button" className="hm-iconbtn" onClick={onClose} aria-label={labels.close}>✕</button>
      </div>
      <p className="hm-muted">{name}</p>
      {result?.ok ? (
        <p className="hm-alert hm-alert-ok" role="status">{result.message}</p>
      ) : (
        <>
          <p>{labels.oneClickLead}</p>
          <div className="hm-field">
            <label htmlFor="oc-phone">{labels.phone}</label>
            <PhoneInput id="oc-phone" value={phone} onChange={setPhone} invalid={result ? !result.ok : false} describedBy={result && !result.ok ? "oc-err" : undefined} autoFocus />
          </div>
          <div className="hm-field">
            <label htmlFor="oc-name">{labels.oneClickName}</label>
            <input id="oc-name" className="hm-input" autoComplete="given-name" value={who} onChange={(e) => setWho(e.target.value)} maxLength={80} />
          </div>
          {/* ловушка для ботов: людям не видна */}
          <input className="hm-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} />
          {result && !result.ok && <p id="oc-err" className="hm-field-error" role="alert">{result.message}</p>}
          <button type="submit" className={btn("primary", { block: true })} aria-busy={pending} disabled={pending}>
            {pending ? <><span className="hm-spinner" aria-hidden="true" />{labels.sending}</> : labels.oneClickSubmit}
          </button>
        </>
      )}
    </form>
  );
}

/** Значок корзины со счётчиком (шапка, нижняя панель). */
export function CartCount({ className }: { className?: string }) {
  const lines = useCart();
  const n = lines.reduce((a, l) => a + l.qty, 0);
  const [bump, setBump] = useState(false);
  const prev = useRef(n);
  useEffect(() => {
    if (n > prev.current) {
      const on = requestAnimationFrame(() => setBump(true));
      const off = setTimeout(() => setBump(false), 400);
      prev.current = n;
      return () => {
        cancelAnimationFrame(on);
        clearTimeout(off);
      };
    }
    prev.current = n;
  }, [n]);
  if (!n) return null;
  return <span className={`hm-cart-count${bump ? " is-bump" : ""}${className ? ` ${className}` : ""}`}>{n > 99 ? "99+" : n}</span>;
}

/** Круглая кнопка корзины внизу справа: видна, когда в корзине что-то есть. */
function FloatingCart({ label, onOpen }: { label: string; onOpen: () => void }) {
  const n = useCart().reduce((a, l) => a + l.qty, 0);
  if (!n) return null;
  return (
    <button type="button" className="hm-fab-cart" onClick={onOpen} aria-label={label.replace("{n}", String(n))} data-te-ui>
      <Icon name="cart" size={26} />
      <CartCount />
    </button>
  );
}
