"use client";

// Страница «Обране» (шаг 5.5): артикулы — из браузера/кабинета (fav-store.tsx), карточки и цены — с сервера.
import { useEffect, useState } from "react";
import type { ShopLang } from "@handyman/core/site/routes";
import { favCardsAction } from "@/app/[lang]/cabinet-actions";
import { useFavorites } from "./fav-store";
import { ProductCard, type CardData, type CardLabels } from "./product-card";

/** Страница «Обране»: карточки со свежими ценами. */
export function FavoritesView({ lang, labels, empty, guest }: { lang: ShopLang; labels: CardLabels; empty: string; guest?: React.ReactNode }) {
  const skus = useFavorites();
  const [loaded, setLoaded] = useState<{ key: string; cards: CardData[] } | null>(null);
  const key = skus.join("|");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    favCardsAction(lang, key.split("|")).then((c) => alive && setLoaded({ key, cards: c }), () => alive && setLoaded({ key, cards: [] }));
    return () => {
      alive = false;
    };
  }, [lang, key]);
  // пока грузятся новые карточки, показываем прежние; убранное сердечком исчезает сразу, не дожидаясь сервера
  const shown = !key ? [] : loaded ? loaded.cards.filter((c) => skus.includes(c.sku)) : null;
  return (
    <>
      {guest}
      {shown == null ? (
        <p className="hm-muted" aria-busy="true"><span className="hm-spinner" aria-hidden="true" /></p>
      ) : shown.length ? (
        <ul className="hm-grid">
          {shown.map((card) => <li key={card.id}><ProductCard card={card} labels={labels} /></li>)}
        </ul>
      ) : (
        <p className="hm-muted hm-fav-empty">{empty}</p>
      )}
    </>
  );
}
