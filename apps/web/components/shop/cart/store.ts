"use client";

// Корзина в браузере: только артикулы и количество (localStorage «hm.cart»), одинаково во всех вкладках.
// Цены, наличие и суммы корзина всегда берёт с сервера (quoteCartAction) — браузеру не доверяем.
import { useSyncExternalStore } from "react";
import { cleanCart, MAX_QTY, type CartLineInput } from "@handyman/core/shop";

const KEY = "hm.cart";
const EMPTY: CartLineInput[] = [];
let cache: { raw: string | null; lines: CartLineInput[] } = { raw: null, lines: EMPTY };
let memoryOnly = false; // приватный режим браузера: корзина живёт до закрытия вкладки
const listeners = new Set<() => void>();

function read(): CartLineInput[] {
  if (memoryOnly) return cache.lines;
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    memoryOnly = true;
    return cache.lines;
  }
  if (raw === cache.raw) return cache.lines;
  let lines: CartLineInput[] = EMPTY;
  try {
    lines = cleanCart(JSON.parse(raw ?? "[]"));
  } catch {
    lines = EMPTY;
  }
  cache = { raw, lines };
  return lines;
}

function write(lines: CartLineInput[]) {
  const raw = JSON.stringify(lines);
  if (!memoryOnly) {
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      memoryOnly = true;
    }
  }
  cache = { raw, lines };
  listeners.forEach((l) => l());
}

export const cartStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  get: read,
  add(sku: string, qty = 1) {
    const lines = read();
    const cur = lines.find((l) => l.sku === sku);
    write(cur ? lines.map((l) => (l.sku === sku ? { sku, qty: Math.min(MAX_QTY, l.qty + qty) } : l)) : [...lines, { sku, qty: Math.min(MAX_QTY, qty) }]);
  },
  setQty(sku: string, qty: number) {
    if (qty < 1) return cartStore.remove(sku);
    write(read().map((l) => (l.sku === sku ? { sku, qty: Math.min(MAX_QTY, Math.floor(qty)) } : l)));
  },
  remove(sku: string) {
    write(read().filter((l) => l.sku !== sku));
  },
  removeMany(skus: string[]) {
    const set = new Set(skus);
    write(read().filter((l) => !set.has(l.sku)));
  },
  clear() {
    write([]);
  },
};

/** Строки корзины (на сервере и до загрузки страницы — пусто). */
export function useCart(): CartLineInput[] {
  return useSyncExternalStore(cartStore.subscribe, read, () => EMPTY);
}

export const cartCount = (lines: CartLineInput[]) => lines.reduce((a, l) => a + l.qty, 0);
