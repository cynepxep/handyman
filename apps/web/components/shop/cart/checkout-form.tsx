"use client";

// Оформление заказа на одной странице, без регистрации: данные покупателя → доставка → оплата → комментарий → итог.
// Цены, итог и «до сплати зараз» считает сервер (checkoutQuoteAction), он же проверяет форму и создаёт заказ (placeOrderAction).
// Имя, телефон и адрес доставки запоминаются в этом браузере — в следующий раз заполнять заново не нужно.
import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ShopLang } from "@handyman/core/site/routes";
import { checkoutQuoteAction, placeOrderAction, type CheckoutQuote } from "@/app/[lang]/cart-actions";
import { npCitiesAction, npPointsAction } from "@/app/[lang]/np-actions";
import type { PickupPoint } from "@handyman/core/shop/warehouse";
import { formatPrice } from "../format";
import { StockBadge, btn, type StockLabels } from "../ui";
import { Combo } from "./combo";
import { PhoneInput } from "./phone-input";
import { cartStore, useCart } from "./store";

type Pay = "prepay" | "full" | "card";
type Delivery = "np" | "pickup" | "courier";
type NpType = "warehouse" | "postomat" | "address";

export type CheckoutLabels = {
  contacts: string; firstName: string; lastName: string; phone: string;
  delivery: string; np: string; npHint: string; npTypes: Record<NpType, string>; city: string; npPoint: Record<NpType, string>;
  cityPlaceholder: string; pointPlaceholder: string; npSearching: string; npNone: string; npPickCity: string;
  pickup: string; pickupHint: string; pickupChoose: string; courier: string; courierHint: string; courierAddr: string;
  pay: string; payTitles: Record<Pay, string>; payHints: Record<Pay, string>;
  comment: string; noCall: string; noCallOff: string;
  summary: string; subtotal: string; discount: string; shipping: string; shippingTariff: string; shippingFree: string;
  total: string; payNow: string; later: string; payLater: string;
  place: string; sending: string; agree: string; loading: string; empty: string; toCatalog: string; gone: string;
  stock: StockLabels;
};

export type CheckoutOptions = { pay: Pay[]; delivery: Delivery[] };

const SAVED_KEY = "hm.buyer";
type Saved = {
  firstName?: string; lastName?: string; phone?: string; delivery?: Delivery; npType?: NpType; city?: string; npPoint?: string; address?: string;
  cityRef?: string; npPointRef?: string; pickupId?: string;
};

function readSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Saved) : {};
  } catch {
    return {};
  }
}

export function CheckoutForm({ lang, labels, options, catalogHref, pickups }: {
  lang: ShopLang; labels: CheckoutLabels; options: CheckoutOptions; catalogHref: string;
  /** точки самовывоза (магазины); если их несколько — покупатель выбирает */
  pickups: PickupPoint[];
}) {
  const router = useRouter();
  const lines = useCart();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [delivery, setDelivery] = useState<Delivery>(options.delivery[0]);
  const [npType, setNpType] = useState<NpType>("warehouse");
  const [city, setCity] = useState("");
  const [npPoint, setNpPoint] = useState("");
  // выбрано из справочника Новой Почты (пусто — написано вручную)
  const [cityRef, setCityRef] = useState("");
  const [npPointRef, setNpPointRef] = useState("");
  const [pickupId, setPickupId] = useState(pickups[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [pay, setPay] = useState<Pay>(options.pay[0]);
  const [comment, setComment] = useState("");
  const [noCall, setNoCall] = useState(false);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // подставить данные прошлого заказа (сохранены только в этом браузере)
  useEffect(() => {
    const s = readSaved();
    /* eslint-disable react-hooks/set-state-in-effect -- однократное чтение из localStorage после загрузки страницы */
    if (s.firstName) setFirstName(s.firstName);
    if (s.lastName) setLastName(s.lastName);
    if (s.phone) setPhone(s.phone);
    if (s.delivery && options.delivery.includes(s.delivery)) setDelivery(s.delivery);
    if (s.npType) setNpType(s.npType);
    if (s.city) setCity(s.city);
    if (s.npPoint) setNpPoint(s.npPoint);
    if (s.address) setAddress(s.address);
    if (s.cityRef) setCityRef(s.cityRef);
    if (s.npPointRef) setNpPointRef(s.npPointRef);
    if (s.pickupId && pickups.some((p) => p.id === s.pickupId)) setPickupId(s.pickupId);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [options.delivery, pickups]);

  // итог с сервера при каждом изменении корзины или способа оплаты
  const key = JSON.stringify(lines);
  useEffect(() => {
    if (done) return;
    let alive = true;
    checkoutQuoteAction(lang, JSON.parse(key), pay).then((q) => {
      if (!alive) return;
      if (q.missing.length) {
        cartStore.removeMany(q.missing);
        setGone(true);
      }
      setQuote(q);
    });
    return () => {
      alive = false;
    };
  }, [key, lang, pay, done]);

  const canSkipCall = quote?.canSkipCall ?? true;

  if (!lines.length && !done) {
    return (
      <div className="hm-empty">
        {gone && <p className="hm-alert">{labels.gone}</p>}
        <p>{labels.empty}</p>
        <Link className={btn("primary")} href={catalogHref}>{labels.toCatalog}</Link>
      </div>
    );
  }

  const err = (k: string) => (errors[k] ? { "aria-invalid": true as const, "aria-describedby": `e-${k}` } : {});
  const errText = (k: string) => (errors[k] ? <span id={`e-${k}`} className="hm-field-error">{errors[k]}</span> : null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    const form = {
      firstName, lastName, phone, delivery, npType, city, npPoint, address, pay, comment, npCityRef: cityRef, npPointRef, pickupId,
      noCallback: canSkipCall && noCall, items: lines, website: trap,
    };
    start(async () => {
      const r = await placeOrderAction(lang, form);
      if (r.ok) {
        try {
          localStorage.setItem(SAVED_KEY, JSON.stringify({ firstName, lastName, phone, delivery, npType, city, npPoint, address, cityRef, npPointRef, pickupId } satisfies Saved));
        } catch {
          /* приватный режим — просто не запоминаем */
        }
        setDone(true);
        cartStore.clear();
        router.push(r.url);
        return;
      }
      setErrors(r.errors);
      setMessage(r.message ?? (r.errors.items ?? ""));
      // фокус на первое поле с ошибкой — удобно и для экранного диктора
      setTimeout(() => {
        const first = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
        (first ?? formRef.current?.querySelector<HTMLElement>(".hm-alert-error"))?.focus();
      });
    });
  };

  const t = quote?.totals;
  const byS = new Map(quote?.lines.map((l) => [l.sku, l]));

  return (
    <form ref={formRef} className="hm-checkout" onSubmit={submit} noValidate>
      <div className="hm-section">
        <section className="hm-panel" aria-labelledby="co-contacts">
          <h2 id="co-contacts">{labels.contacts}</h2>
          <div className="hm-fields2">
            <div className="hm-field">
              <label htmlFor="co-first">{labels.firstName}</label>
              <input id="co-first" className="hm-input" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} required {...err("firstName")} />
              {errText("firstName")}
            </div>
            <div className="hm-field">
              <label htmlFor="co-last">{labels.lastName}</label>
              <input id="co-last" className="hm-input" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} required {...err("lastName")} />
              {errText("lastName")}
            </div>
            <div className="hm-field">
              <label htmlFor="co-phone">{labels.phone}</label>
              <PhoneInput id="co-phone" value={phone} onChange={setPhone} invalid={!!errors.phone} describedBy={errors.phone ? "e-phone" : undefined} />
              {errText("phone")}
            </div>
          </div>
        </section>

        <section className="hm-panel">
          <fieldset>
            <legend>{labels.delivery}</legend>
            {options.delivery.includes("np") && (
              <>
                <label className="hm-choice">
                  <input type="radio" name="delivery" value="np" checked={delivery === "np"} onChange={() => setDelivery("np")} />
                  <b>{labels.np}</b>
                  <small>{labels.npHint}</small>
                </label>
                {delivery === "np" && (
                  <div className="hm-section" style={{ gap: 12, paddingLeft: 4 }}>
                    <div className="hm-choice-sub" role="radiogroup" aria-label={labels.np}>
                      {(["warehouse", "postomat", "address"] as const).map((k) => (
                        <label key={k} className="hm-chip">
                          <input type="radio" name="npType" value={k} checked={npType === k} onChange={() => { setNpType(k); setNpPoint(""); setNpPointRef(""); }} />
                          {labels.npTypes[k]}
                        </label>
                      ))}
                    </div>
                    <div className="hm-fields2">
                      <div className="hm-field">
                        <label htmlFor="co-city">{labels.city}</label>
                        <Combo
                          id="co-city" value={city} maxLength={80} autoComplete="address-level2" placeholder={labels.cityPlaceholder} picked={!!cityRef} autoPickOnBlur
                          labels={{ searching: labels.npSearching, none: labels.npNone }}
                          invalid={!!errors.city} describedBy={errors.city ? "e-city" : undefined}
                          onText={(v) => { setCity(v); setCityRef(""); setNpPointRef(""); }}
                          onPick={(o) => {
                            setCity(o.label); setCityRef(o.ref); setNpPoint(""); setNpPointRef("");
                            // сразу к отделению: поле откроет список отделений этого города
                            if (npType !== "address") setTimeout(() => document.getElementById("co-point")?.focus(), 80);
                          }}
                          load={async (q) => (await npCitiesAction(q))?.map((c) => ({ ref: c.ref, label: c.name })) ?? null}
                        />
                        {errText("city")}
                      </div>
                      <div className="hm-field">
                        <label htmlFor="co-point">{labels.npPoint[npType]}</label>
                        {npType !== "address" && cityRef ? (
                          <Combo
                            key={cityRef + npType}
                            id="co-point" value={npPoint} minChars={0} placeholder={labels.pointPlaceholder} picked={!!npPointRef} inputMode="search"
                            labels={{ searching: labels.npSearching, none: labels.npNone }}
                            invalid={!!errors.npPoint} describedBy={errors.npPoint ? "e-npPoint" : undefined}
                            onText={(v) => { setNpPoint(v); setNpPointRef(""); }}
                            onPick={(o) => { setNpPoint(o.hint ? `${o.label}: ${o.hint}` : o.label); setNpPointRef(o.ref); }}
                            load={(q) => npPointsAction(cityRef, npType, q, lang)}
                          />
                        ) : (
                          <input
                            id="co-point" className="hm-input" value={npPoint} onChange={(e) => setNpPoint(e.target.value)} maxLength={160}
                            inputMode={npType === "address" ? "text" : "numeric"} autoComplete={npType === "address" ? "street-address" : "off"} {...err("npPoint")}
                          />
                        )}
                        {npType !== "address" && city.trim().length >= 2 && !cityRef && <span className="hm-small">{labels.npPickCity}</span>}
                        {errText("npPoint")}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {options.delivery.includes("pickup") && (
              <label className="hm-choice">
                <input type="radio" name="delivery" value="pickup" checked={delivery === "pickup"} onChange={() => setDelivery("pickup")} />
                <b>{labels.pickup}</b>
                <small>{labels.pickupHint}</small>
              </label>
            )}
            {options.delivery.includes("pickup") && delivery === "pickup" && pickups.length > 1 && (
              <div className="hm-pickups" role="radiogroup" aria-label={labels.pickupChoose}>
                <b>{labels.pickupChoose}</b>
                {pickups.map((p) => (
                  <label key={p.id} className="hm-choice">
                    <input type="radio" name="pickupId" value={p.id} checked={pickupId === p.id} onChange={() => setPickupId(p.id)} />
                    <b>{p.city}, {p.address}</b>
                    {p.hours && <small>{p.hours}</small>}
                  </label>
                ))}
                {errText("pickup")}
              </div>
            )}
            {options.delivery.includes("courier") && (
              <>
                <label className="hm-choice">
                  <input type="radio" name="delivery" value="courier" checked={delivery === "courier"} onChange={() => setDelivery("courier")} />
                  <b>{labels.courier}</b>
                  <small>{labels.courierHint}</small>
                </label>
                {delivery === "courier" && (
                  <div className="hm-field">
                    <label htmlFor="co-addr">{labels.courierAddr}</label>
                    <input id="co-addr" className="hm-input" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={160} {...err("address")} />
                    {errText("address")}
                  </div>
                )}
              </>
            )}
            {errText("delivery")}
          </fieldset>
        </section>

        <section className="hm-panel">
          <fieldset>
            <legend>{labels.pay}</legend>
            {options.pay.map((k) => (
              <label key={k} className="hm-choice">
                <input type="radio" name="pay" value={k} checked={pay === k} onChange={() => setPay(k)} />
                <b>{labels.payTitles[k]}</b>
                <small>{labels.payHints[k]}</small>
              </label>
            ))}
            {errText("pay")}
          </fieldset>
        </section>

        <section className="hm-panel">
          <div className="hm-field">
            <label htmlFor="co-comment">{labels.comment}</label>
            <textarea id="co-comment" className="hm-input hm-textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
          </div>
          {canSkipCall ? (
            <label className="hm-check">
              <input type="checkbox" checked={noCall} onChange={(e) => setNoCall(e.target.checked)} />
              <span>{labels.noCall}</span>
            </label>
          ) : (
            <p className="hm-small">{labels.noCallOff}</p>
          )}
          <input className="hm-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </section>
      </div>

      <aside className="hm-panel hm-checkout-side" aria-labelledby="co-summary">
        <h2 id="co-summary">{labels.summary}</h2>
        {gone && <p className="hm-alert">{labels.gone}</p>}
        <ul className="hm-sum-items">
          {lines.map((l) => {
            const v = byS.get(l.sku);
            return (
              <li key={l.sku}>
                <span className="hm-cart-img">{v?.image ? <Image src={v.image} alt="" fill sizes="48px" /> : null}</span>
                <span>
                  {v?.name ?? "…"} {l.qty > 1 && <b>× {l.qty}</b>}
                  {v && <StockBadge level={v.stock} labels={labels.stock} />}
                </span>
                <b>{v ? formatPrice(v.price * l.qty) : ""}</b>
              </li>
            );
          })}
        </ul>
        <div className="hm-sum" aria-live="polite">
          <div><span>{labels.subtotal}</span><span>{t ? formatPrice(t.subtotal) : labels.loading}</span></div>
          {t && t.discountPct > 0 && <div><span>{labels.discount} {t.discountPct}%</span><span>−{formatPrice(t.subtotal - t.total)}</span></div>}
          <div><span>{labels.shipping}</span><span>{delivery === "pickup" ? labels.shippingFree : labels.shippingTariff}</span></div>
          <div className="is-total"><span>{labels.total}</span><span>{t ? formatPrice(t.total) : "…"}</span></div>
          {t && (t.dueNow > 0 ? (
            <>
              <div className="is-now"><span>{labels.payNow}</span><span>{formatPrice(t.dueNow)}</span></div>
              {t.later > 0 && <div><span>{labels.later}</span><span>{formatPrice(t.later)}</span></div>}
            </>
          ) : (
            <div className="is-now"><span>{labels.payLater}</span><span>{formatPrice(t.total)}</span></div>
          ))}
        </div>
        {message && <p className="hm-alert hm-alert-error" role="alert" tabIndex={-1}>{message}</p>}
        <button type="submit" className={btn("primary", { block: true })} disabled={pending || done} aria-busy={pending}>
          {pending || done ? <><span className="hm-spinner" aria-hidden="true" />{labels.sending}</> : labels.place}
        </button>
        <p className="hm-small">{labels.agree}</p>
      </aside>
    </form>
  );
}
