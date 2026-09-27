"use client";

// «Витрина+» (шаг 5.6), интерактивные части: форма отзыва/вопроса с фото, «Повідомити про зниження ціни / надходження»,
// «Порівняти» и страница сравнения (список — в браузере, «hm.compare»), «Передзвоніть мені». Подписи приходят готовыми строками.
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import type { ShopLang } from "@handyman/core/site/routes";
import { callbackAction, compareAction, reviewAction, watchAction, type CompareData } from "@/app/[lang]/plus-actions";
import { optimizable } from "@/lib/image-hosts";
import { formatPrice } from "./format";
import { Icon } from "./icons";
import { PhoneInput } from "./cart/phone-input";
import { AddToCartButton } from "./cart/cart-buttons";
import { StockBadge, btn, type StockLabels } from "./ui";

// ---------- отзыв / вопрос ----------

export type ReviewFormLabels = {
  name: string; rating: string; star: string; text: string; photos: string; send: string; sending: string; photoErr: string;
};

export function ReviewForm({ lang, productId, kind, labels, maxPhotos }: {
  lang: ShopLang; productId: string; kind: "review" | "question"; labels: ReviewFormLabels; maxPhotos: number;
}) {
  const [rating, setRating] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const id = `${kind}-${productId}`;
  if (result?.ok) return <p className="hm-alert hm-alert-ok" role="status">{result.message}</p>;
  return (
    <form
      className="hm-review-form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
        if (files.length > maxPhotos || files.some((f) => f.size > 8 * 1024 * 1024)) {
          setResult({ ok: false, message: labels.photoErr });
          return;
        }
        start(async () => setResult(await reviewAction(lang, fd)));
      }}
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="kind" value={kind} />
      {kind === "review" && (
        <fieldset className="hm-stars-input">
          <legend>{labels.rating}</legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={n <= rating ? "is-on" : ""}>
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} />
              <Icon name="star" size={30} />
              <span className="hm-vh">{labels.star.replace("{n}", String(n))}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="hm-field">
        <label htmlFor={`${id}-name`}>{labels.name}</label>
        <input id={`${id}-name`} name="name" className="hm-input" autoComplete="given-name" maxLength={60} required />
      </div>
      <div className="hm-field">
        <label htmlFor={`${id}-text`}>{labels.text}</label>
        <textarea id={`${id}-text`} name="text" className="hm-input hm-textarea" rows={4} maxLength={2000} required />
      </div>
      {kind === "review" && (
        <div className="hm-field">
          <label htmlFor={`${id}-photos`}>{labels.photos}</label>
          <input id={`${id}-photos`} name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="hm-file" />
        </div>
      )}
      <input className="hm-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" defaultValue="" />
      {result && !result.ok && <p className="hm-field-error" role="alert">{result.message}</p>}
      <div>
        <button type="submit" className={btn("primary")} aria-busy={pending} disabled={pending}>
          {pending ? <><span className="hm-spinner" aria-hidden="true" />{labels.sending}</> : labels.send}
        </button>
      </div>
    </form>
  );
}

// ---------- «повідомити» ----------

export type WatchLabels = { btn: string; on: string; off: string; viaBot: string };

/**
 * Вошёл через Telegram (`direct`) — подписка одной кнопкой, можно отменить. Иначе — ссылка на бота (он подпишет по /start wp_<товар>).
 */
export function WatchButton({ productId, kind, initialOn, direct, bot, labels }: {
  productId: string; kind: "PRICE" | "STOCK"; initialOn: boolean; direct: boolean; bot: string | null; labels: WatchLabels;
}) {
  const [on, setOn] = useState(initialOn);
  const [pending, start] = useTransition();
  const [hint, setHint] = useState(false);
  if (!direct) {
    if (!bot) return null;
    return (
      <div className="hm-watch">
        <a className={btn("ghost", { small: true })} href={`https://t.me/${bot}?start=${kind === "PRICE" ? "wp" : "ws"}_${productId}`} target="_blank" rel="noopener" onClick={() => setHint(true)} data-action="watch">
          <Icon name="bell" size={18} />{labels.btn}
        </a>
        {hint && <p className="hm-muted hm-watch-note" role="status">{labels.viaBot}</p>}
      </div>
    );
  }
  return (
    <div className="hm-watch">
      {on ? (
        <p className="hm-watch-on" role="status">
          <Icon name="check" size={18} />{labels.on}
          <button type="button" className="hm-linkbtn" disabled={pending} onClick={() => start(async () => setOn((await watchAction(productId, kind, false)).on))}>{labels.off}</button>
        </p>
      ) : (
        <button type="button" className={btn("ghost", { small: true })} disabled={pending} aria-busy={pending} data-action="watch"
          onClick={() => start(async () => setOn((await watchAction(productId, kind, true)).on))}>
          <Icon name="bell" size={18} />{labels.btn}
        </button>
      )}
    </div>
  );
}

// ---------- сравнение ----------

const CMP_KEY = "hm.compare";
const CMP_MAX = 4;
const EMPTY: string[] = [];
let cmpCache: { raw: string | null; list: string[] } = { raw: null, list: EMPTY };
const cmpListeners = new Set<() => void>();

function cmpRead(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CMP_KEY);
  } catch {
    return cmpCache.list;
  }
  if (raw === cmpCache.raw) return cmpCache.list;
  let list: string[] = EMPTY;
  try {
    const v = JSON.parse(raw ?? "[]");
    list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, CMP_MAX) : EMPTY;
  } catch {
    list = EMPTY;
  }
  cmpCache = { raw, list };
  return list;
}

function cmpWrite(list: string[]) {
  const raw = JSON.stringify(list.slice(0, CMP_MAX));
  try {
    localStorage.setItem(CMP_KEY, raw);
  } catch {
    /* приватный режим — живёт до перезагрузки */
  }
  cmpCache = { raw, list: list.slice(0, CMP_MAX) };
  cmpListeners.forEach((l) => l());
}

function cmpSubscribe(l: () => void) {
  cmpListeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === CMP_KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    cmpListeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

const useCompare = () => useSyncExternalStore(cmpSubscribe, cmpRead, () => EMPTY);

export type CompareButtonLabels = { add: string; added: string; go: string; full: string };

/** «Порівняти» на странице товара; когда товар добавлен — ссылка «Порівняння (N)». */
export function CompareButton({ sku, href, labels }: { sku: string; href: string; labels: CompareButtonLabels }) {
  const list = useCompare();
  const [full, setFull] = useState(false);
  const on = list.includes(sku);
  return (
    <div className="hm-compare-btn">
      <button
        type="button"
        className={btn("ghost", { small: true })}
        aria-pressed={on}
        data-action="compare"
        onClick={() => {
          if (on) return cmpWrite(list.filter((s) => s !== sku));
          if (list.length >= CMP_MAX) return setFull(true);
          cmpWrite([...list, sku]);
        }}
      >
        <Icon name={on ? "check" : "compare"} size={18} />{on ? labels.added : labels.add}
      </button>
      {list.length > 0 && <Link className="hm-link" href={href}>{labels.go.replace("{n}", String(list.length))}</Link>}
      {full && !on && <p className="hm-muted" role="status">{labels.full}</p>}
    </div>
  );
}

export type CompareViewLabels = {
  empty: string; diff: string; remove: string; clear: string; price: string; stock: StockLabels; stockRow: string; brand: string; buy: string; noPhoto: string;
  catalog: string; loading: string;
};

/** Страница сравнения: таблица «характеристика × товар», «Лише відмінності», убрать товар, «У кошик». */
export function CompareView({ lang, labels, catalogHref }: { lang: ShopLang; labels: CompareViewLabels; catalogHref: string }) {
  const list = useCompare();
  const key = list.join("|");
  const [data, setData] = useState<{ key: string; d: CompareData } | null>(null);
  const [diff, setDiff] = useState(false);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    compareAction(lang, key.split("|")).then((d) => {
      if (!alive) return;
      if (d.missing.length) cmpWrite(key.split("|").filter((s) => !d.missing.includes(s)));
      setData({ key, d });
    });
    return () => {
      alive = false;
    };
  }, [key, lang]);

  if (!list.length) {
    return (
      <div className="hm-empty">
        <p>{labels.empty}</p>
        <div><Link className={btn("primary")} href={catalogHref}>{labels.catalog}</Link></div>
      </div>
    );
  }
  const d = data?.d;
  if (!d) return <p className="hm-muted" role="status">{labels.loading}</p>;
  const rows = diff ? d.rows.filter((r) => !r.same) : d.rows;
  return (
    <div className="hm-compare">
      <div className="hm-row">
        <label className="hm-check"><input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> {labels.diff}</label>
        <button type="button" className="hm-linkbtn" onClick={() => cmpWrite([])}>{labels.clear}</button>
      </div>
      <div className="hm-compare-scroll">
        <table className="hm-compare-table" style={{ ["--cols" as string]: d.items.length }}>
          <thead>
            <tr>
              <th scope="col"><span className="hm-vh">{labels.price}</span></th>
              {d.items.map((it) => (
                <th key={it.sku} scope="col">
                  <div className="hm-compare-head">
                    <button type="button" className="hm-iconbtn hm-compare-x" aria-label={labels.remove.replace("{name}", it.name)} onClick={() => cmpWrite(list.filter((s) => s !== it.sku))}>✕</button>
                    <span className="hm-compare-img">
                      {it.image ? <Image src={it.image} alt="" fill sizes="160px" unoptimized={!optimizable(it.image)} /> : <span className="hm-noimg">{labels.noPhoto}</span>}
                    </span>
                    <Link href={it.href} className="hm-compare-name">{it.name}</Link>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{labels.price}</th>
              {d.items.map((it) => (
                <td key={it.sku}>
                  <b className="hm-price">{formatPrice(it.price)}</b>
                  {it.oldPrice && <s className="hm-muted"> {formatPrice(it.oldPrice)}</s>}
                  <div className="hm-compare-buy"><AddToCartButton sku={it.sku} label={labels.buy} variant="primary" /></div>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">{labels.stockRow}</th>
              {d.items.map((it) => <td key={it.sku}><StockBadge level={it.stock} labels={labels.stock} /></td>)}
            </tr>
            {(!diff || new Set(d.items.map((i) => i.brand ?? "")).size > 1) && (
              <tr>
                <th scope="row">{labels.brand}</th>
                {d.items.map((it) => <td key={it.sku}>{it.brand ?? "—"}</td>)}
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.name} className={r.same ? "" : "is-diff"}>
                <th scope="row">{r.name}</th>
                {r.values.map((v, i) => <td key={d.items[i]?.sku ?? i}>{v ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- «Передзвоніть мені» ----------

export type CallbackLabels = { btn: string; title: string; lead: string; phone: string; name: string; send: string; sending: string; close: string };

export function CallbackButton({ lang, productId, labels, variant = "pill" }: { lang: ShopLang; productId?: string; labels: CallbackLabels; variant?: "pill" | "link" }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(0);
  return (
    <>
      <button
        type="button"
        className={variant === "pill" ? "hm-pill" : "hm-linkbtn"}
        data-action="callback"
        onClick={() => {
          setOpen((n) => n + 1);
          dlg.current?.showModal();
        }}
      >
        {variant === "pill" && <Icon name="phone" size={18} />}{labels.btn}
      </button>
      <dialog ref={dlg} className="hm-modal" aria-label={labels.title} onClick={(e) => e.target === dlg.current && dlg.current?.close()}>
        {open > 0 && <CallbackForm key={open} lang={lang} productId={productId} labels={labels} onClose={() => dlg.current?.close()} />}
      </dialog>
    </>
  );
}

function CallbackForm({ lang, productId, labels, onClose }: { lang: ShopLang; productId?: string; labels: CallbackLabels; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [trap, setTrap] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="hm-modal-body"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await callbackAction(lang, { phone, name, productId, website: trap })));
      }}
    >
      <div className="hm-drawer-head">
        <b>{labels.title}</b>
        <button type="button" className="hm-iconbtn" onClick={onClose} aria-label={labels.close}>✕</button>
      </div>
      {result?.ok ? (
        <p className="hm-alert hm-alert-ok" role="status">{result.message}</p>
      ) : (
        <>
          <p>{labels.lead}</p>
          <div className="hm-field">
            <label htmlFor="cb-phone">{labels.phone}</label>
            <PhoneInput id="cb-phone" value={phone} onChange={setPhone} invalid={result ? !result.ok : false} describedBy={result && !result.ok ? "cb-err" : undefined} autoFocus />
          </div>
          <div className="hm-field">
            <label htmlFor="cb-name">{labels.name}</label>
            <input id="cb-name" className="hm-input" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <input className="hm-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} />
          {result && !result.ok && <p id="cb-err" className="hm-field-error" role="alert">{result.message}</p>}
          <button type="submit" className={btn("primary", { block: true })} aria-busy={pending} disabled={pending}>
            {pending ? <><span className="hm-spinner" aria-hidden="true" />{labels.sending}</> : labels.send}
          </button>
        </>
      )}
    </form>
  );
}

/** Кабинет: «Скасувати» подписку «повідомити». */
export function UnwatchButton({ productId, kind, label }: { productId: string; kind: "PRICE" | "STOCK"; label: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) return null;
  return (
    <button type="button" className="hm-linkbtn" disabled={pending} onClick={() => start(async () => setDone(!(await watchAction(productId, kind, false)).on))}>
      {label}
    </button>
  );
}
