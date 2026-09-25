// Карточка товара в списке (разделы, поиск, полки на главной). На узком телефоне — строкой: фото слева, текст справа.
// Подписи приходят готовыми строками (cardLabels), поэтому карточку можно рисовать и на сервере, и в браузере («Показати ще»).
import Image from "next/image";
import { optimizable } from "@/lib/image-hosts";
import Link from "next/link";
import type { T } from "@/lib/shop/content";
import { AddToCartButton, OneClickButton } from "./cart/cart-buttons";
import { Price, StockBadge, type StockLabels } from "./ui";

export type CardData = {
  id: string;
  sku: string;
  name: string;
  href: string;
  price: number;
  oldPrice: number | null;
  discountPct: number;
  available: boolean;
  stock: "local" | "supplier" | "order";
  /** отметки владельца */
  hit?: boolean;
  isNew?: boolean;
  image: string | null;
  specs: Array<{ key: string; text: string }>;
};

export type CardLabels = {
  noPhoto: string; specs: string; buy: string; buy1click: string; stock: StockLabels; hit: string; isNew: string;
  /** «Стара ціна {price}» — {price} подставляет карточка */
  oldPrice: string;
};

export const stockLabels = (t: T): StockLabels => ({ local: t("stock.local"), supplier: t("stock.supplier"), order: t("stock.order") });

export const cardLabels = (t: T): CardLabels => ({
  noPhoto: t("card.noPhoto"), specs: t("card.specs.label"), buy: t("card.buy"), buy1click: t("card.buy1click"), oldPrice: t("card.oldPrice"),
  stock: stockLabels(t), hit: t("badge.hit"), isNew: t("badge.new"),
});

/** Размеры фото для браузера: сколько пикселей реально нужно на каждой ширине экрана (грузится ровно столько). */
const GRID_SIZES = "(max-width: 479px) 136px, (max-width: 699px) 50vw, (max-width: 999px) 33vw, 300px";
const RAIL_SIZES = "240px";

export function ProductCard({ card, labels, rail, priority }: { card: CardData; labels: CardLabels; rail?: boolean; priority?: boolean }) {
  return (
    <article className="hm-card" data-product-id={card.id}>
      <div className="hm-card-media">
        {card.image ? (
          <Image src={card.image} alt={card.name} fill sizes={rail ? RAIL_SIZES : GRID_SIZES} priority={priority} unoptimized={!optimizable(card.image)} />
        ) : (
          <div className="hm-noimg">{labels.noPhoto}</div>
        )}
        {(card.discountPct > 0 || card.hit || card.isNew) && (
          <span className="hm-badges">
            {card.discountPct > 0 && <span className="hm-badge hm-badge-sale">−{card.discountPct}%</span>}
            {card.hit && <span className="hm-badge hm-badge-hit">{labels.hit}</span>}
            {card.isNew && <span className="hm-badge hm-badge-new">{labels.isNew}</span>}
          </span>
        )}
      </div>
      <div className="hm-card-body">
        <h3 className="hm-card-title"><Link href={card.href}>{card.name}</Link></h3>
        {card.specs.length > 0 && (
          <ul className="hm-specs" aria-label={labels.specs}>
            {card.specs.map((s) => <li key={s.key}>{s.text}</li>)}
          </ul>
        )}
        <StockBadge level={card.stock} labels={labels.stock} />
        <Price price={card.price} oldPrice={card.oldPrice} oldLabel={(p) => labels.oldPrice.replace("{price}", p)} />
        <div className="hm-card-actions">
          <AddToCartButton sku={card.sku} label={labels.buy} block />
          <OneClickButton sku={card.sku} name={card.name} label={labels.buy1click} block />
        </div>
      </div>
    </article>
  );
}
