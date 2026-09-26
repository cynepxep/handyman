"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "../import/client-bits";
import { ProductPicker, type PickedProduct } from "../product-picker";
import type { StockFormState } from "./actions";

type Warehouse = { id: string; name: string };
type Action = (prev: StockFormState, fd: FormData) => Promise<StockFormState>;

function WarehouseSelect({ warehouses }: { warehouses: Warehouse[] }) {
  if (warehouses.length < 2) return <input type="hidden" name="warehouseId" value={warehouses[0]?.id ?? ""} />;
  return (
    <div className="adm-field">
      <label htmlFor="sf-w">Склад / магазин</label>
      <select id="sf-w" name="warehouseId" className="adm-select">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
    </div>
  );
}

/** «Приход»: какие товары пришли, сколько, почём (закупка необязательна, но нужна для отчёта о прибыли). */
export function ReceiveForm({ action, warehouses }: { action: Action; warehouses: Warehouse[] }) {
  const [state, formAction] = useActionState(action, {});
  const [lines, setLines] = useState<Array<PickedProduct & { qty: string; unitCost: string }>>([]);
  const add = (p: PickedProduct) => setLines((ls) => (ls.some((l) => l.sku === p.sku) ? ls : [...ls, { ...p, qty: "1", unitCost: "" }]));
  const upd = (sku: string, k: "qty" | "unitCost", v: string) => setLines((ls) => ls.map((l) => (l.sku === sku ? { ...l, [k]: v } : l)));
  return (
    <form action={formAction}>
      {state.error && <p className="adm-flash err" role="alert">{state.error}</p>}
      <section className="adm-card">
        <div className="adm-grid2">
          <WarehouseSelect warehouses={warehouses} />
          <div className="adm-field"><label htmlFor="sf-sup">От кого (поставщик)</label><input id="sf-sup" name="supplier" className="adm-input wide" placeholder="например, Vitals" maxLength={120} /></div>
        </div>
        <ProductPicker onPick={add} id="sf-search" />
        {lines.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Товар</th><th className="num">Пришло, шт.</th><th className="num">Закупка за шт., ₴</th><th></th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.sku}>
                    <td>{l.nameUk}<div className="adm-muted">{l.sku} · продажа {l.price} ₴</div></td>
                    <td className="num"><input className="adm-input" style={{ width: 90 }} inputMode="numeric" value={l.qty} onChange={(e) => upd(l.sku, "qty", e.target.value)} aria-label={`Количество: ${l.nameUk}`} /></td>
                    <td className="num"><input className="adm-input" style={{ width: 110 }} inputMode="decimal" value={l.unitCost} onChange={(e) => upd(l.sku, "unitCost", e.target.value)} placeholder="не знаю" aria-label={`Закупочная цена: ${l.nameUk}`} /></td>
                    <td><button type="button" className="adm-btn" onClick={() => setLines((ls) => ls.filter((x) => x.sku !== l.sku))} aria-label={`Убрать ${l.nameUk}`}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="adm-muted">Найдите товары поиском выше и впишите, сколько пришло.</p>}
        <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => ({ sku: l.sku, qty: l.qty, unitCost: l.unitCost })))} />
        <div className="adm-field"><label htmlFor="sf-note">Примечание</label><input id="sf-note" name="note" className="adm-input wide" placeholder="номер накладной, дата…" maxLength={500} /></div>
        <SubmitButton primary pendingText="Провожу…">Провести приход</SubmitButton>
      </section>
    </form>
  );
}

/** «Инвентаризация»: пересчитали полку — вписали факт. Пустое поле — товар не трогаем. */
export function InventoryForm({ action, warehouses, current }: { action: Action; warehouses: Warehouse[]; current: Array<{ sku: string; name: string; onHand: number }> }) {
  const [state, formAction] = useActionState(action, {});
  const [rows, setRows] = useState(current.map((c) => ({ ...c, counted: "" })));
  const add = (p: PickedProduct) => setRows((rs) => (rs.some((r) => r.sku === p.sku) ? rs : [...rs, { sku: p.sku, name: p.nameUk, onHand: 0, counted: "" }]));
  const filled = rows.filter((r) => r.counted.trim() !== "");
  const diffs = filled.filter((r) => Number(r.counted) !== r.onHand).length;
  return (
    <form action={formAction}>
      {state.error && <p className="adm-flash err" role="alert">{state.error}</p>}
      <section className="adm-card">
        <WarehouseSelect warehouses={warehouses} />
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Товар</th><th className="num">По учёту</th><th className="num">Факт</th><th className="num">Разница</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = r.counted.trim() === "" ? null : Number(r.counted) - r.onHand;
                return (
                  <tr key={r.sku}>
                    <td>{r.name}<div className="adm-muted">{r.sku}</div></td>
                    <td className="num">{r.onHand}</td>
                    <td className="num">
                      <input className="adm-input" style={{ width: 90 }} inputMode="numeric" value={r.counted} placeholder="—" aria-label={`Факт: ${r.name}`}
                        onChange={(e) => setRows((rs) => rs.map((x) => (x.sku === r.sku ? { ...x, counted: e.target.value } : x)))} />
                    </td>
                    <td className="num">{d === null || Number.isNaN(d) ? "" : d === 0 ? "✓" : <b className={d < 0 ? "adm-bad" : "adm-ok"}>{d > 0 ? `+${d}` : d}</b>}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={4} className="adm-muted">На складе по учёту пусто — добавьте товары поиском ниже.</td></tr>}
            </tbody>
          </table>
        </div>
        <ProductPicker onPick={add} id="inv-search" label="Добавить товар, которого нет в списке" />
        <input type="hidden" name="lines" value={JSON.stringify(filled.map((r) => ({ sku: r.sku, counted: r.counted.trim() })))} />
        <div className="adm-field"><label htmlFor="inv-note">Примечание</label><input id="inv-note" name="note" className="adm-input wide" maxLength={500} /></div>
        <div className="adm-row">
          <SubmitButton primary pendingText="Провожу…">Провести инвентаризацию</SubmitButton>
          <span className="adm-muted">Заполнено {filled.length}, расхождений {diffs}. Товары с пустым «Факт» не меняются.</span>
        </div>
      </section>
    </form>
  );
}
