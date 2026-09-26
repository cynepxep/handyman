"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "../../import/client-bits";
import type { ManualOrderState } from "../actions";

type Hit = { sku: string; nameUk: string; price: number; stock?: string; available?: boolean };
type Line = Hit & { qty: number };

const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;

/** Форма «Заказ по звонку»: поиск товара (тот же, что на сайте), количество, доставка, оплата. Цены на экране — подсказка; в заказ их ставит сервер. */
export function ManualOrderForm({ action }: { action: (prev: ManualOrderState, fd: FormData) => Promise<ManualOrderState> }) {
  const [state, formAction] = useActionState(action, {});
  const v = state.values ?? {};
  const error = state.error;
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [delivery, setDelivery] = useState("to_confirm");
  const [searchErr, setSearchErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Поиск с паузой 250 мс после последней буквы (тот же поиск, что на сайте). */
  const search = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/catalog/suggest?q=${encodeURIComponent(text.trim())}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? "Поиск не отвечает");
        setHits(data.items ?? []);
        setSearchErr("");
      } catch (e) {
        setSearchErr(e instanceof Error ? e.message : "Поиск не отвечает");
      }
    }, 250);
  };

  const add = (h: Hit) => {
    setLines((ls) => (ls.some((l) => l.sku === h.sku) ? ls.map((l) => (l.sku === h.sku ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { ...h, qty: 1 }]));
    search("");
  };
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);

  return (
    <form action={formAction}>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Покупатель</h2>
        <div className="adm-grid2">
          <div className="adm-field"><label htmlFor="m-phone">Телефон *</label><input id="m-phone" name="phone" className="adm-input wide" inputMode="tel" placeholder="093 123 45 67" required defaultValue={v.phone} /></div>
          <div className="adm-field"><label htmlFor="m-name">Имя (Прізвище Ім&apos;я)</label><input id="m-name" name="name" className="adm-input wide" maxLength={80} defaultValue={v.name} /></div>
        </div>
        <p className="adm-muted" style={{ margin: 0 }}>Если покупатель с этим телефоном уже есть — заказ попадёт в его карточку.</p>
      </section>

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Товары</h2>
        <div className="adm-field" style={{ position: "relative" }}>
          <label htmlFor="m-search">Найти товар: название или артикул</label>
          <input id="m-search" className="adm-input wide" value={q} onChange={(e) => search(e.target.value)} placeholder="например, круг 125 або 50117" autoComplete="off" />
          {searchErr && <small className="adm-muted">{searchErr}</small>}
          {hits.length > 0 && (
            <ul className="adm-suggest" role="listbox" aria-label="Найденные товары">
              {hits.map((h) => (
                <li key={h.sku}>
                  <button type="button" onClick={() => add(h)}>
                    <span>{h.nameUk}<br /><small className="adm-muted">{h.sku}{h.available === false ? " · под заказ" : ""}</small></span>
                    <b>{money(h.price)}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Товар</th><th className="num">Цена</th><th className="num">Кол-во</th><th></th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.sku}>
                    <td>{l.nameUk}<div className="adm-muted">{l.sku}</div></td>
                    <td className="num">{money(l.price)}</td>
                    <td className="num">
                      <input type="number" min={1} max={999} value={l.qty} aria-label={`Количество: ${l.nameUk}`} className="adm-input" style={{ width: 80 }}
                        onChange={(e) => setLines((ls) => ls.map((x) => (x.sku === l.sku ? { ...x, qty: Math.max(1, Math.min(999, Number(e.target.value) || 1)) } : x)))} />
                    </td>
                    <td><button type="button" className="adm-btn" onClick={() => setLines((ls) => ls.filter((x) => x.sku !== l.sku))} aria-label={`Убрать ${l.nameUk}`}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="adm-muted">Товаров пока нет — найдите их поиском выше.</p>}
        {lines.length > 0 && <p>Предварительно: <b>{money(total)}</b> <span className="adm-muted">(точную сумму посчитает сервер по текущим ценам)</span></p>}
        <input type="hidden" name="items" value={JSON.stringify(lines.map((l) => ({ sku: l.sku, qty: l.qty })))} />
      </section>

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Доставка и оплата</h2>
        <div className="adm-grid2">
          <div className="adm-field">
            <label htmlFor="m-del">Доставка</label>
            <select id="m-del" name="delivery" className="adm-select" value={delivery} onChange={(e) => setDelivery(e.target.value)}>
              <option value="to_confirm">Уточнить позже</option>
              <option value="np">Нова Пошта</option>
              <option value="pickup">Самовывоз из магазина</option>
              <option value="courier">Курьер по Одессе</option>
            </select>
          </div>
          <div className="adm-field">
            <label htmlFor="m-pay">Оплата</label>
            <select id="m-pay" name="pay" className="adm-select" defaultValue={v.pay ?? "later"} key={v.pay ?? "later"}>
              <option value="later">Уточнить позже</option>
              <option value="prepay">Предоплата</option>
              <option value="full">Полная оплата</option>
              <option value="card">По реквизитам</option>
            </select>
          </div>
        </div>
        {delivery === "np" && (
          <div className="adm-grid2">
            <div className="adm-field"><label htmlFor="m-city">Город</label><input id="m-city" name="city" className="adm-input wide" defaultValue={v.city} /></div>
            <div className="adm-field"><label htmlFor="m-np">Отделение или почтомат</label><input id="m-np" name="npPoint" className="adm-input wide" placeholder="№12 или адрес" defaultValue={v.npPoint} /></div>
          </div>
        )}
        {delivery === "courier" && (
          <div className="adm-field"><label htmlFor="m-addr">Адрес в Одессе</label><input id="m-addr" name="address" className="adm-input wide" defaultValue={v.address} /></div>
        )}
        <div className="adm-field"><label htmlFor="m-comment">Комментарий</label><textarea id="m-comment" name="comment" className="adm-textarea" rows={2} maxLength={500} defaultValue={v.comment} /></div>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 40 }}>
          <input type="checkbox" name="isTest" defaultChecked={v.isTest === "on"} /> Тестовый заказ (не считается в статистике)
        </label>
      </section>
      <SubmitButton primary pendingText="Создаю заказ…">Создать заказ</SubmitButton>
    </form>
  );
}
