"use client";

// Шаг 3.4: стоимость и срок доставки Новой Почтой в город покупателя (корзина, оформление, страница товара) и полоса
// «ще N ₴ до безкоштовної доставки». Город — тот, что покупатель выбрал в прошлом оформлении (запомнен в этом браузере),
// или выбранный сейчас в оформлении. Цифры считает сервер (npEstimateAction); подписи — «Сайт → Тексты → Доставка».
import { useEffect, useState } from "react";
import type { ShopLang } from "@handyman/core/site/routes";
import { npEstimateAction, type NpEstimateView } from "@/app/[lang]/np-actions";
import { formatPrice } from "./format";

export type NpEstLabels = {
  /** «Нова Пошта в {city}: {cost}, орієнтовно {date}» */ line: string;
  /** «~{sum} за тарифом» */ cost: string;
  free: string; today: string; tomorrow: string;
  /** «Ще {n} ₴ до безкоштовної доставки» */ freeLeft: string;
  freeDone: string;
  /** «Безкоштовна доставка Новою Поштою від {sum}» */ freeFrom: string;
};

/** Город из прошлого оформления (localStorage «hm.buyer»). */
export function savedNpCity(): { ref: string; name: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem("hm.buyer") ?? "{}") as { cityRef?: unknown; city?: unknown; delivery?: unknown };
    return typeof v.cityRef === "string" && v.cityRef && typeof v.city === "string" ? { ref: v.cityRef, name: v.city } : null;
  } catch {
    return null;
  }
}

/** «м. Київ, Київська обл.» → «Київ». */
export const shortCity = (name: string) => name.replace(/^(м|с|смт|сел)\.\s*/i, "").split(",")[0].trim();

/** «2026-10-01» → «сьогодні» / «завтра» / «чт, 1 жовтня». */
export function npDay(iso: string, lang: ShopLang, l: Pick<NpEstLabels, "today" | "tomorrow">, now = new Date()): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target - today) / 86400_000);
  if (diff <= 0) return l.today;
  if (diff === 1) return l.tomorrow;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "uk-UA", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(target));
}

export function npEstText(e: NpEstimateView, city: string, lang: ShopLang, l: NpEstLabels): string | null {
  if (!e.free && e.cost == null) return null;
  const cost = e.free ? l.free : l.cost.replace("{sum}", formatPrice(e.cost!));
  const date = e.date ? npDay(e.date, lang, l) : "";
  let s = l.line.replace("{city}", shortCity(city)).replace("{cost}", cost).replace("{date}", date);
  if (!date) s = s.replace(/,\s*[^,]*$/, ""); // без даты — без хвоста «орієнтовно …»
  return s;
}

/** Хук: оценка доставки для товаров в город (null — не знаем город или НП не ответила). */
export function useNpEstimate(cityRef: string | null | undefined, items: Array<{ sku: string; qty: number }>, pay?: string): NpEstimateView | null {
  const [est, setEst] = useState<{ key: string; v: NpEstimateView | null } | null>(null);
  const key = cityRef && items.length ? `${cityRef}|${pay ?? ""}|${JSON.stringify(items)}` : "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const t = setTimeout(() => {
      npEstimateAction(cityRef, items, pay).then((v) => alive && setEst({ key, v })).catch(() => alive && setEst({ key, v: null }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // items/pay входят в key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && est?.key === key ? est.v : null;
}

/** Строка доставки на странице товара: город из прошлого оформления → «Нова Пошта в Київ: ~85 ₴, завтра»; иначе — обычный текст. */
export function NpEstimateLine({ lang, sku, labels, fallback, freeFrom }: { lang: ShopLang; sku: string; labels: NpEstLabels; fallback: React.ReactNode; freeFrom: number }) {
  const [city, setCity] = useState<{ ref: string; name: string } | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- город читается из localStorage только в браузере
  useEffect(() => setCity(savedNpCity()), []);
  const est = useNpEstimate(city?.ref, [{ sku, qty: 1 }]);
  const text = est && city ? npEstText(est, city.name, lang, labels) : null;
  return (
    <>
      {text ? <span data-np-est>{text}</span> : fallback}
      {freeFrom > 0 && <span className="hm-np-free"> {labels.freeFrom.replace("{sum}", formatPrice(freeFrom))}</span>}
    </>
  );
}

/** Полоса «ще N ₴ до безкоштовної доставки» (корзина). */
export function FreeShippingBar({ subtotal, freeFrom, labels }: { subtotal: number; freeFrom: number; labels: Pick<NpEstLabels, "freeLeft" | "freeDone"> }) {
  if (!(freeFrom > 0)) return null;
  const left = Math.max(0, Math.ceil(freeFrom - subtotal));
  const pct = Math.min(100, Math.round((subtotal / freeFrom) * 100));
  return (
    <div className={`hm-freebar${left ? "" : " is-done"}`}>
      <p>{left ? labels.freeLeft.replace("{n}", formatPrice(left).replace(/\s?₴$/, "")) : labels.freeDone}</p>
      <div className="hm-freebar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={left ? labels.freeLeft.replace("{n}", String(left)) : labels.freeDone}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
