"use client";

// Корзина в браузере: только артикулы и количество (localStorage «hm.cart»), одинаково во всех вкладках.
// Цены, наличие и суммы корзина всегда берёт с сервера (quoteCartAction) — браузеру не доверяем.
// Шаг 5.5: у вошедшего покупателя корзина ещё и хранится в кабинете (общая для сайта и Mini App) — см. cart-sync.tsx.
// «hm.cart.sync» помнит версию корзины на сервере, которую браузер видел последней, и менял ли он корзину после этого.
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

const SYNC_KEY = "hm.cart.sync";
export type CartSyncMeta = { v: number; dirty: boolean };
let memoryMeta: CartSyncMeta = { v: 0, dirty: false };
/** Растёт при каждом изменении корзины в этой вкладке (синхронизация понимает, что корзину поменяли, пока ждали ответ). */
let localEdits = 0;

function readMeta(): CartSyncMeta {
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_KEY) ?? "null");
    if (m && Number.isInteger(m.v) && typeof m.dirty === "boolean") return { v: m.v, dirty: m.dirty };
  } catch {
    /* приватный режим */
  }
  return memoryMeta;
}

function writeMeta(m: CartSyncMeta) {
  memoryMeta = m;
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(m));
  } catch {
    /* приватный режим */
  }
}

function write(lines: CartLineInput[], fromSync = false) {
  if (!fromSync) {
    localEdits++;
    writeMeta({ ...readMeta(), dirty: true });
  }
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
  /** Для синхронизации с кабинетом. */
  syncMeta: readMeta,
  setSyncMeta: writeMeta,
  edits: () => localEdits,
  /** Корзина пришла из кабинета: записать без отметки «менял браузер». */
  applySynced(lines: CartLineInput[], version: number) {
    writeMeta({ v: version, dirty: false });
    const cur = read();
    if (JSON.stringify(cur) !== JSON.stringify(lines)) write(lines, true);
  },
};

/** Строки корзины (на сервере и до загрузки страницы — пусто). */
export function useCart(): CartLineInput[] {
  return useSyncExternalStore(cartStore.subscribe, read, () => EMPTY);
}

export const cartCount = (lines: CartLineInput[]) => lines.reduce((a, l) => a + l.qty, 0);
