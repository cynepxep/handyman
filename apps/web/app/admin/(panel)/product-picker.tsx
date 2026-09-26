"use client";

import { useEffect, useRef, useState } from "react";

export type PickedProduct = { sku: string; nameUk: string; price: number; available?: boolean };

const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;

/** Поиск товара для форм админки (тот же поиск, что на сайте: опечатки, раскладка, артикул). Выбор — onPick. */
export function ProductPicker({ onPick, label = "Найти товар: название или артикул", id = "pp-search" }: { onPick: (p: PickedProduct) => void; label?: string; id?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickedProduct[]>([]);
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Поиск с паузой 250 мс после последней буквы. */
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
        setErr("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Поиск не отвечает");
      }
    }, 250);
  };

  return (
    <div className="adm-field" style={{ position: "relative" }}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="adm-input wide" value={q} onChange={(e) => search(e.target.value)} placeholder="например, круг 125 або 000196033" autoComplete="off" />
      {err && <small className="adm-muted">{err}</small>}
      {hits.length > 0 && (
        <ul className="adm-suggest" role="listbox" aria-label="Найденные товары">
          {hits.map((h) => (
            <li key={h.sku}>
              <button type="button" onClick={() => { onPick(h); search(""); }}>
                <span>{h.nameUk}<br /><small className="adm-muted">{h.sku}{h.available === false ? " · под заказ" : ""}</small></span>
                <b>{money(h.price)}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
