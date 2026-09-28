// Шаг 3.4: доставка Новой Почтой на витрине — полоса «ще N ₴ до безкоштовної доставки» (корзина) и подписи условий
// наложенного платежа. Стоимость и срок доставки не считаем (решение владельца 2026-09-28): за них отвечает перевозчик.
// Подписи — «Сайт → Тексты → Доставка».
import { formatPrice } from "./format";

export type NpDeliveryLabels = {
  /** «Ще {n} ₴ до безкоштовної доставки» */ freeLeft: string;
  freeDone: string;
  /** «Безкоштовна доставка Новою Поштою від {sum}» */ freeFrom: string;
  /** «Накладений платіж» + условия */ codTitle: string; codTerms: string;
};

/** Полоса «ще N ₴ до безкоштовної доставки» (корзина). Без порога — ничего. */
export function FreeShippingBar({ subtotal, freeFrom, labels }: { subtotal: number; freeFrom: number; labels: Pick<NpDeliveryLabels, "freeLeft" | "freeDone"> }) {
  if (!(freeFrom > 0)) return null;
  const left = Math.max(0, Math.ceil(freeFrom - subtotal));
  const pct = Math.min(100, Math.round((subtotal / freeFrom) * 100));
  const text = left ? labels.freeLeft.replace("{n}", formatPrice(left).replace(/\s?₴$/, "")) : labels.freeDone;
  return (
    <div className={`hm-freebar${left ? "" : " is-done"}`}>
      <p>{text}</p>
      <div className="hm-freebar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={text}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
