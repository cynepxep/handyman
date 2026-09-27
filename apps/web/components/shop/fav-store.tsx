"use client";

// «Обране» (шаг 5.5). Гость: артикулы в браузере («hm.fav»). Вошедший: список в кабинете, браузер держит его копию
// («hm.fav.acct» = "1"), чтобы сердечки рисовались сразу. При входе гостевое избранное переносится в кабинет.
import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { favSyncAction, favToggleAction } from "@/app/[lang]/cabinet-actions";
import { Icon } from "./icons";
import { btn } from "./ui";

const KEY = "hm.fav";
const ACCT = "hm.fav.acct";
const MAX = 200;
const EMPTY: string[] = [];
let cache: { raw: string | null; skus: string[] } = { raw: null, skus: EMPTY };
let memory: string[] | null = null; // приватный режим
const listeners = new Set<() => void>();

function read(): string[] {
  if (memory) return memory;
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    memory = cache.skus;
    return memory;
  }
  if (raw === cache.raw) return cache.skus;
  let skus: string[] = EMPTY;
  try {
    const v = JSON.parse(raw ?? "[]");
    skus = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, MAX) : EMPTY;
  } catch {
    skus = EMPTY;
  }
  cache = { raw, skus };
  return skus;
}

function write(skus: string[]) {
  const raw = JSON.stringify(skus.slice(0, MAX));
  if (memory) memory = skus;
  else {
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      memory = skus;
    }
  }
  cache = { raw, skus };
  listeners.forEach((l) => l());
}

const isAcct = () => {
  try {
    return localStorage.getItem(ACCT) === "1";
  } catch {
    return false;
  }
};
const setAcct = (on: boolean) => {
  try {
    if (on) localStorage.setItem(ACCT, "1");
    else localStorage.removeItem(ACCT);
  } catch {
    /* приватный режим */
  }
};

export const favStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => e.key === KEY && listener();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  get: read,
  async toggle(sku: string): Promise<boolean> {
    const on = !read().includes(sku);
    write(on ? [sku, ...read()] : read().filter((s) => s !== sku));
    if (!isAcct()) return true;
    const ok = await favToggleAction(sku, on).catch(() => false);
    if (!ok) write(on ? read().filter((s) => s !== sku) : [sku, ...read()]); // не получилось — вернуть как было
    return ok;
  },
};

export function useFavorites(): string[] {
  return useSyncExternalStore(favStore.subscribe, read, () => EMPTY);
}

/** Сверка с кабинетом (ставится один раз в layout). */
export function FavSync({ loggedIn }: { loggedIn: boolean }) {
  useEffect(() => {
    if (!loggedIn) {
      // вышел: копия избранного из кабинета в браузере больше не нужна
      if (isAcct()) {
        setAcct(false);
        write([]);
      }
      return;
    }
    let alive = true;
    const pending = isAcct() ? [] : read();
    favSyncAction(pending).then((skus) => {
      if (!alive || !skus) return;
      setAcct(true);
      write(skus);
    }, () => {});
    return () => {
      alive = false;
    };
  }, [loggedIn]);
  return null;
}

/** Сердечко: на карточке — в углу фото, на странице товара — кнопка рядом с «У кошик». */
export function FavoriteButton({ sku, addLabel, removeLabel, variant = "card" }: { sku: string; addLabel: string; removeLabel: string; variant?: "card" | "page" }) {
  const on = useFavorites().includes(sku);
  const label = on ? removeLabel : addLabel;
  return (
    <button
      type="button"
      className={variant === "card" ? `hm-fav${on ? " is-on" : ""}` : `${btn("ghost")} hm-fav-page${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      data-action="favorite"
      data-sku={sku}
      onClick={() => void favStore.toggle(sku)}
    >
      <Icon name={on ? "heartFill" : "heart"} size={variant === "card" ? 20 : 22} />
      {variant === "page" && <span className="hm-fav-page-text">{label}</span>}
    </button>
  );
}

/** Сердечко в шапке со счётчиком → страница «Обране». */
export function HeaderFav({ href, label }: { href: string; label: string }) {
  const n = useFavorites().length;
  return (
    <Link className="hm-cart hm-headfav" href={href} aria-label={label.replace("{n}", String(n))}>
      <Icon name="heart" size={24} />
      {n > 0 && <span className="hm-cart-count">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}

/** Блок «Обране» в кабинете: число — живое (гостевое избранное переносится в кабинет уже после отрисовки страницы). */
export function AccountFavorites({ href, count, none, open }: { href: string; count: string; none: string; open: string }) {
  const n = useFavorites().length;
  return (
    <>
      <p>{n > 0 ? count.replace("{n}", String(n)) : none}</p>
      {n > 0 && <div><Link className={btn("secondary", { small: true })} href={href}>{open}</Link></div>}
    </>
  );
}
