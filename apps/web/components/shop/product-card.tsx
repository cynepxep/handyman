// Карточка товара в списке (каталог, поиск, полки на главной). На узком телефоне — строкой: фото слева, текст справа.
import Image from "next/image";
import Link from "next/link";
import type { T } from "@/lib/shop/content";
import { Price, StockBadge, btn } from "./ui";

export type CardData = {
  id: string;
  name: string;
  price: number;
  oldPrice: number | null;
  discountPct: number;
  available: boolean;
  image: string | null;
  specs: Array<{ key: string; text: string }>;
};

/** Размеры фото для браузера: сколько пикселей реально нужно на каждой ширине экрана (грузится ровно столько). */
const GRID_SIZES = "(max-width: 479px) 112px, (max-width: 699px) 50vw, (max-width: 999px) 33vw, 300px";
const RAIL_SIZES = "240px";

export function ProductCard({ card, href, t, rail, priority }: { card: CardData; href: string; t: T; rail?: boolean; priority?: boolean }) {
  return (
    <article className="hm-card" data-product-id={card.id}>
      <div className="hm-card-media">
        {card.image ? (
          <Image src={card.image} alt={card.name} fill sizes={rail ? RAIL_SIZES : GRID_SIZES} priority={priority} />
        ) : (
          <div className="hm-noimg">{t("card.noPhoto")}</div>
        )}
        {card.discountPct > 0 && <span className="hm-badge hm-badge-sale">−{card.discountPct}%</span>}
      </div>
      <div className="hm-card-body">
        <h3 className="hm-card-title"><Link href={href}>{card.name}</Link></h3>
        {card.specs.length > 0 && (
          <ul className="hm-specs" aria-label={t("card.specs.label")}>
            {card.specs.map((s) => <li key={s.key}>{s.text}</li>)}
          </ul>
        )}
        <StockBadge available={card.available} inStock={t("card.inStock")} onOrder={t("card.onOrder")} />
        <Price price={card.price} oldPrice={card.oldPrice} oldLabel={(p) => t("card.oldPrice", { price: p })} />
        {/* Кнопки заработают вместе с корзиной (шаг 2.6). data-* — для аналитики (Этап 6). */}
        <div className="hm-card-actions">
          <button type="button" className={btn("primary", { block: true })} data-action="add-to-cart">{t("card.buy")}</button>
          <button type="button" className={btn("ghost", { block: true })} data-action="buy-one-click">{t("card.buy1click")}</button>
        </div>
      </div>
    </article>
  );
}
