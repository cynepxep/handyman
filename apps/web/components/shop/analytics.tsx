"use client";

// Аналитика (шаг А1): события в `dataLayer` для Google Tag Manager (формат GA4 e-commerce). Контейнер GTM грузит layout витрины
// (analyticsInitScript + <AnalyticsTags>, только если аналитика включена и это не браузер с входом в админку); без них `track()` ничего не делает.
// Суммы и цены для событий приходят с сервера (analytics-actions.ts) — браузер их не считает.
import { useEffect } from "react";
import Script from "next/script";
import {
  ECOMMERCE_EVENTS, LIST_ITEMS_MAX, analyticsPageType, contactClick, ecommerceOf, type AnalyticsItem, type EcommerceData,
} from "@handyman/core/shop";
import { analyticsItemsAction, claimPurchaseAction } from "@/app/[lang]/analytics-actions";
import { countStep } from "./metrics-beacon";

type DataLayerEntry = Record<string, unknown>;
type W = Window & { dataLayer?: DataLayerEntry[]; __hmA?: number; __hmCh?: "web" | "miniapp" };

/** Аналитика на этой странице включена (ранний скрипт analyticsInitScript отработал до загрузки страницы). */
export function analyticsOn(): boolean {
  return typeof window !== "undefined" && (window as W).__hmA === 1;
}

/** Событие в `dataLayer`. Перед e-commerce событием — `{ ecommerce: null }`, чтобы GTM не склеил товары с прошлым событием. */
export function track(event: string, data: DataLayerEntry = {}): void {
  if (!analyticsOn()) return;
  const w = window as W;
  const dl = (w.dataLayer ??= []);
  if (ECOMMERCE_EVENTS.has(event)) dl.push({ ecommerce: null });
  dl.push({ event, channel: w.__hmCh ?? "web", ...data });
}

/**
 * Событие с товарами, которые собирает сервер (цена — как в корзине этого покупателя). `lines`: что добавили/убрали; `atQty` — сколько
 * стало в корзине (от него зависит оптовая цена).
 */
export function trackItems(event: string, lines: Array<{ sku: string; qty: number; atQty?: number }>, extra: Omit<EcommerceData, "currency" | "items"> = {}): void {
  // свой счётчик воронки («Отчёты → Метрики») — и без Google Analytics
  if (lines.length && event === "add_to_cart") countStep("cart");
  if (lines.length && event === "begin_checkout") countStep("checkout");
  if (!analyticsOn() || !lines.length) return;
  void analyticsItemsAction(lines).then(
    (items) => {
      if (items.length) track(event, { ecommerce: ecommerceOf(items, extra) });
    },
    () => {},
  );
}

/** Покупка: сервер отдаёт событие один раз на заказ (повторный показ «Дякуємо» — без события). */
export function trackPurchase(no: string, key: string): void {
  if (!analyticsOn()) return;
  void claimPurchaseAction(no, key).then(
    (e) => {
      if (e) track("purchase", { event_id: e.event_id, ecommerce: e.ecommerce });
    },
    () => {},
  );
}

// В режиме разработки React запускает эффекты дважды — одно и то же событие за секунду не повторяем.
let last: { key: string; at: number } | null = null;
function once(key: string): boolean {
  const now = Date.now();
  if (last && last.key === key && now - last.at < 1500) return false;
  last = { key, at: now };
  return true;
}

/** Событие при показе страницы (view_item): данные собраны на сервере. */
export function TrackView({ event, data, dedupe }: { event: string; data: DataLayerEntry; dedupe: string }) {
  useEffect(() => {
    if (analyticsOn() && once(`${event}:${dedupe}`)) track(event, data);
    // data собраны на сервере для этой страницы; новое событие — только при смене страницы (dedupe)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, dedupe]);
  return null;
}

/** Поиск: отправка формы и открытие /search?q=… Тот же запрос подряд (смена фильтров, сортировки) — один раз за полчаса. */
export function TrackSearch({ term }: { term: string }) {
  useEffect(() => {
    if (!analyticsOn() || !term) return;
    const k = "hm.a.search";
    try {
      const prev = JSON.parse(sessionStorage.getItem(k) ?? "null") as { term?: string; at?: number } | null;
      if (prev?.term === term && Date.now() - (prev.at ?? 0) < 30 * 60_000) return;
      sessionStorage.setItem(k, JSON.stringify({ term, at: Date.now() }));
    } catch {
      if (!once(`search:${term}`)) return;
    }
    track("search", { search_term: term });
  }, [term]);
  return null;
}

/** Список товаров (раздел, задача, поиск): view_item_list при показе и select_item при нажатии на товар из списка. */
export function TrackList({ listId, listName, items, dedupe }: { listId: string; listName: string; items: AnalyticsItem[]; dedupe: string }) {
  useEffect(() => {
    if (!analyticsOn()) return;
    if (items.length && once(`list:${listId}:${dedupe}`)) {
      track("view_item_list", { ecommerce: { item_list_id: listId, item_list_name: listName, items: items.slice(0, LIST_ITEMS_MAX) } });
    }
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      const box = a?.closest(`[data-a-list]`);
      if (!a || box?.getAttribute("data-a-list") !== listId) return;
      const card = a.closest("[data-sku]");
      const sku = card?.getAttribute("data-sku");
      if (!sku || !a.getAttribute("href")?.includes("/product/")) return;
      const found = items.find((i) => i.item_id === sku);
      const item: AnalyticsItem = found ?? { item_id: sku, item_name: (a.textContent ?? "").trim().slice(0, 100), price: 0, quantity: 1 };
      track("select_item", { ecommerce: { item_list_id: listId, item_list_name: listName, items: [{ ...item, item_list_id: listId, item_list_name: listName }] } });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, dedupe]);
  return null;
}

/** «Дякуємо»: покупка — один раз на заказ. */
export function TrackPurchase({ no, k }: { no: string; k: string }) {
  useEffect(() => {
    trackPurchase(no, k);
  }, [no, k]);
  return null;
}

/** Нажатия на телефон и мессенджеры по всему сайту (шапка, подвал, «Контакти», «Дякуємо», товар): phone_click / telegram_click. */
function ContactClicks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      const kind = contactClick(a.getAttribute("href") ?? "");
      if (!kind) return;
      const where = a.closest("header") ? "header" : a.closest("footer") ? "footer" : a.closest(".hm-bottomnav") ? "bottom_nav" : "page";
      track(kind.event, { ...(kind.event === "telegram_click" ? { messenger: kind.messenger } : {}), click_location: where, page_type: analyticsPageType(location.pathname) });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}

/** Контейнер GTM (после показа страницы) и счётчик нажатий на телефон/мессенджеры. Ранний скрипт — analyticsInitScript в layout. */
export function AnalyticsTags({ gtmId }: { gtmId: string }) {
  return (
    <>
      <Script id="hm-gtm" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`} />
      <ContactClicks />
    </>
  );
}
