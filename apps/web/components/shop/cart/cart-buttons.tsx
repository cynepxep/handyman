"use client";

// Кнопки корзины: «У кошик» (первый раз открывает мини-корзину, дальше — «полёт» в круглую кнопку), «Купити в 1 клік» (окно с телефоном), значок корзины.
import Link from "next/link";
import { btn } from "../ui";
import { Icon } from "../icons";
import { CartCount, useShopCart } from "./cart-context";
import { useCart } from "./store";

export function AddToCartButton({ sku, label, block, variant = "primary", className }: {
  sku: string; label: string; block?: boolean; variant?: "primary" | "secondary"; className?: string;
}) {
  const { addToCart } = useShopCart();
  return (
    <button
      type="button"
      className={`${btn(variant, { block })}${className ? ` ${className}` : ""}`}
      data-action="add-to-cart"
      data-sku={sku}
      onClick={(e) => addToCart(sku, e.currentTarget)}
    >
      {label}
    </button>
  );
}

export function OneClickButton({ sku, name, label, block }: { sku: string; name: string; label: string; block?: boolean }) {
  const { openOneClick } = useShopCart();
  return (
    <button type="button" className={btn("ghost", { block })} data-action="buy-one-click" data-sku={sku} onClick={() => openOneClick(sku, name)}>
      {label}
    </button>
  );
}

/** Значок корзины в шапке: нажатие открывает мини-корзину; без JS — ссылка на страницу корзины. */
export function HeaderCart() {
  const { labels, cartHref, openCart } = useShopCart();
  const n = useCart().reduce((a, l) => a + l.qty, 0);
  return (
    <Link
      className="hm-cart"
      href={cartHref}
      aria-label={labels.openCart.replace("{n}", String(n))}
      onClick={(e) => {
        e.preventDefault();
        openCart();
      }}
    >
      <Icon name="cart" size={26} />
      <CartCount />
    </Link>
  );
}

/** Корзина в нижней панели телефона. */
export function BottomCart({ label }: { label: string }) {
  const { cartHref, openCart } = useShopCart();
  return (
    <Link
      href={cartHref}
      className="hm-bottom-cart"
      onClick={(e) => {
        e.preventDefault();
        openCart();
      }}
    >
      <span className="hm-bottom-cart-icon"><Icon name="cart" size={22} /><CartCount /></span>
      {label}
    </Link>
  );
}
