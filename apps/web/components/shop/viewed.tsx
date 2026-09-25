"use client";

// «Ви переглядали»: последние 12 просмотренных товаров. Хранятся только в браузере покупателя (артикулы), карточки — с сервера.
import { useEffect, useState } from "react";
import type { ShopLang } from "@handyman/core/site/routes";
import { viewedCardsAction } from "@/app/[lang]/home-actions";
import { ProductCard, type CardData, type CardLabels } from "./product-card";

const KEY = "hm.viewed";
const MAX = 12;

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Запомнить просмотр товара (ставится на странице товара, ничего не рисует). */
export function RememberView({ sku }: { sku: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([sku, ...read().filter((s) => s !== sku)].slice(0, MAX)));
    } catch {
      /* приватный режим — не запоминаем */
    }
  }, [sku]);
  return null;
}

export function ViewedRail({ lang, title, clear, labels }: { lang: ShopLang; title: string; clear: string; labels: CardLabels }) {
  const [cards, setCards] = useState<CardData[]>([]);
  useEffect(() => {
    const skus = read();
    if (!skus.length) return;
    let alive = true;
    viewedCardsAction(lang, skus).then((c) => alive && setCards(c));
    return () => {
      alive = false;
    };
  }, [lang]);
  if (!cards.length) return null;
  return (
    <section className="hm-section" aria-labelledby="h-viewed">
      <div className="hm-section-head">
        <h2 id="h-viewed" className="hm-h2">{title}</h2>
        <button
          type="button"
          className="hm-linkbtn"
          onClick={() => {
            try {
              localStorage.removeItem(KEY);
            } catch {
              /* ничего */
            }
            setCards([]);
          }}
        >
          {clear}
        </button>
      </div>
      <ul className="hm-rail">
        {cards.map((card) => <li key={card.id}><ProductCard card={card} labels={labels} rail /></li>)}
      </ul>
    </section>
  );
}
