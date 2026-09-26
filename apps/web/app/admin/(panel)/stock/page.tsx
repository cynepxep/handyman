import Link from "next/link";
import { prisma } from "@handyman/db";
import { listStock } from "@handyman/db/stock";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { stockSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

type Params = { q?: string; w?: string; low?: string; page?: string; ok?: string; error?: string };

function href(p: Params, over: Partial<Params>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ok: "", error: "", ...over })) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/admin/stock${s ? `?${s}` : ""}`;
}

export default async function StockPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermission("stock.edit");
  const p = await searchParams;
  const warehouses = await prisma.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { sort: "asc" }], select: { id: true, name: true } });
  const { total, page, pages, rows, totals } = await listStock({ q: p.q, warehouseId: p.w || undefined, low: p.low === "1", page: Number(p.page) || 1 });
  const back = href(p, {});

  return (
    <>
      <div className="adm-row" style={{ justifyContent: "space-between" }}>
        <h1>Склад</h1>
        <div className="adm-row">
          <Link className="adm-btn primary" href="/admin/stock/receive">+ Приход</Link>
          <Link className="adm-btn" href="/admin/stock/inventory">Инвентаризация</Link>
          <Link className="adm-btn" href="/admin/stock/moves">Журнал движений</Link>
        </div>
      </div>
      <p className="adm-lead">
        Наш собственный склад (не остаток поставщика). <b>На складе</b> — сколько лежит физически, <b>в резерве</b> — отложено под заказы
        (списывается, когда заказ «Отправлен»), <b>доступно</b> — сколько видят покупатели как «Є в Одесі». Минимальный остаток: когда доступно
        станет не больше него, менеджеру придёт сообщение, а товар попадёт в «Заканчиваются».
      </p>
      {p.error && <p className="adm-flash err" role="alert">{p.error}</p>}
      {p.ok && <p className="adm-flash ok">{p.ok}</p>}

      <div className="adm-grid">
        <div className="adm-stat"><b>{totals.products}</b><small>товаров на складе</small></div>
        <div className="adm-stat"><b>{totals.pieces}</b><small>штук (в резерве {totals.reserved})</small></div>
        <div className="adm-stat ok"><b>{money(totals.value)}</b><small>в закупочных ценах</small></div>
        <div className="adm-stat"><b>{money(totals.retail)}</b><small>в ценах продажи</small></div>
        <Link className={`adm-stat link${totals.low ? " warn" : ""}`} href={href(p, { low: "1", page: "" })}><b>{totals.low}</b><small>заканчиваются</small></Link>
        {totals.noCost > 0 && <div className="adm-stat warn"><b>{totals.noCost}</b><small>без закупочной цены</small></div>}
      </div>

      <form method="get" className="adm-card">
        <div className="adm-row">
          <input name="q" defaultValue={p.q ?? ""} className="adm-input" style={{ flex: "1 1 220px" }} placeholder="Название или артикул" aria-label="Поиск товара" />
          {warehouses.length > 1 && (
            <select name="w" defaultValue={p.w ?? ""} className="adm-select" aria-label="Склад">
              <option value="">Все склады</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="low" value="1" defaultChecked={p.low === "1"} /> только заканчиваются</label>
          <button type="submit" className="adm-btn primary">Найти</button>
          {(p.q || p.w || p.low) && <Link href="/admin/stock" className="adm-btn">Сбросить</Link>}
        </div>
      </form>
      <p className="adm-muted">Найдено: {total}. Товаров на своём складе пока может не быть — добавьте их документом «Приход».</p>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="num">На складе</th>
              <th className="num">В резерве</th>
              <th className="num">Доступно</th>
              <th>Минимум / закупка, ₴</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <td>
                  <Link className="adm-link" href={`/admin/products/${r.productId}`}>{r.name}</Link>
                  <div className="adm-muted">{r.sku} · <Link className="adm-link" href={`/admin/stock/moves?product=${r.productId}`}>движения</Link></div>
                  {r.low && <span className="adm-chip warn">заканчивается</span>}
                </td>
                <td className="num">{r.onHand}</td>
                <td className="num">{r.reserved || "—"}</td>
                <td className="num"><b>{r.available}</b></td>
                <td>
                  <form action={stockSettingsAction} className="adm-row" style={{ gap: 6 }}>
                    <input type="hidden" name="productId" value={r.productId} />
                    <input type="hidden" name="back" value={back} />
                    <input name="minStock" className="adm-input" style={{ width: 70 }} inputMode="numeric" defaultValue={r.minStock || ""} placeholder="0" aria-label={`Минимальный остаток: ${r.name}`} />
                    <input name="purchasePrice" className="adm-input" style={{ width: 90 }} inputMode="decimal" defaultValue={r.purchasePrice ?? ""} placeholder="закупка" aria-label={`Закупочная цена: ${r.name}`} />
                    <button type="submit" className="adm-btn" style={{ minHeight: 36 }}>OK</button>
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="adm-muted">{p.q || p.low ? "Ничего не найдено." : "На нашем складе пока пусто."}</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="adm-pager">
          {page > 1 && <Link className="adm-btn" href={href(p, { page: String(page - 1) })}>← Назад</Link>}
          <span className="adm-muted">Страница {page} из {pages}</span>
          {page < pages && <Link className="adm-btn" href={href(p, { page: String(page + 1) })}>Дальше →</Link>}
        </div>
      )}
    </>
  );
}
