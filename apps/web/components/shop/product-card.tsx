// Карточка товара в списке (разделы, поиск, полки на главной). На узком телефоне — строкой: фото слева, текст справа.
// Подписи приходят готовыми строками (cardLabels), поэтому карточку можно рисовать и на сервере, и в браузере («Показати ще»).
import Image from "next/image";
import Link from "next/link";
import type { T } from "@/lib/shop/content";
import { Price, StockBadge, btn } from "./ui";

export type CardData = {
  id: string;
  sku: string;
  name: string;
  href: string;
  price: number;
  oldPrice: number | null;
  discountPct: number;
  available: boolean;
  image: string | null;
  specs: Array<{ key: string; text: string }>;
};

export type CardLabels = {
  noPhoto: string; specs: string; inStock: string; onOrder: string; buy: string; buy1click: string;
  /** «Стара ціна {price}» — {price} подставляет карточка */
  oldPrice: string;
};

export const cardLabels = (t: T): CardLabels => ({
  noPhoto: t("card.noPhoto"), specs: t("card.specs.label"), inStock: t("card.inStock"), onOrder: t("card.onOrder"),
  buy: t("card.buy"), buy1click: t("card.buy1click"), oldPrice: t("card.oldPrice"),
});

/** Размеры фото для браузера: сколько пикселей реально нужно на каждой ширине экрана (грузится ровно столько). */
const GRID_SIZES = "(max-width: 479px) 112px, (max-width: 699px) 50vw, (max-width: 999px) 33vw, 300px";
const RAIL_SIZES = "240px";

export function ProductCard({ card, labels, rail, priority }: { card: CardData; labels: CardLabels; rail?: boolean; priority?: boolean }) {
  return (
    <article className="hm-card" data-product-id={card.id}>
      <div className="hm-card-media">
        {card.image ? (
          <Image src={card.image} alt={card.name} fill sizes={rail ? RAIL_SIZES : GRID_SIZES} priority={priority} />
        ) : (
          <div className="hm-noimg">{labels.noPhoto}</div>
        )}
        {card.discountPct > 0 && <span className="hm-badge hm-badge-sale">−{card.discountPct}%</span>}
      </div>
      <div className="hm-card-body">
        <h3 className="hm-card-title"><Link href={card.href}>{card.name}</Link></h3>
        {card.specs.length > 0 && (
          <ul className="hm-specs" aria-label={labels.specs}>
            {card.specs.map((s) => <li key={s.key}>{s.text}</li>)}
          </ul>
        )}
        <StockBadge available={card.available} inStock={labels.inStock} onOrder={labels.onOrder} />
        <Price price={card.price} oldPrice={card.oldPrice} oldLabel={(p) => labels.oldPrice.replace("{price}", p)} />
        {/* Кнопки заработают вместе с корзиной (шаг 2.6). data-* — для аналитики (Этап 6). */}
        <div className="hm-card-actions">
          <button type="button" className={btn("primary", { block: true })} data-action="add-to-cart" data-sku={card.sku}>{labels.buy}</button>
          <button type="button" className={btn("ghost", { block: true })} data-action="buy-one-click" data-sku={card.sku}>{labels.buy1click}</button>
        </div>
      </div>
    </article>
  );
}
