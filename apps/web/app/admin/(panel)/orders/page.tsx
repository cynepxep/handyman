import Link from "next/link";
import { ORDER_STATUSES, listOrders } from "@handyman/db/orders";
import { DELIVERY_RU, ORDER_STATUS_RU, PAY_MODE_RU, formatPhone } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { statusChip } from "./status-chip";

export const dynamic = "force-dynamic";

type Params = { q?: string; status?: string; page?: string };

function href(p: Params, over: Partial<Params>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...over })) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/admin/orders${s ? `?${s}` : ""}`;
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermission("orders.view");
  const p = await searchParams;
  const { total, page, pages, rows } = await listOrders({ status: p.status, q: p.q, page: Number(p.page) || 1 });

  return (
    <>
      <h1>Заказы</h1>
      <p className="adm-lead">
        Все заказы с сайта и «Купить в 1 клик». Новые сверху. Нажмите на номер, чтобы открыть заказ: товары, покупатель, доставка, смена статуса и ТТН.
        Заказы с пометкой «тест» оформили сотрудники (вошедшие в админку) — они не считаются в статистике.
      </p>
      <form method="get" className="adm-card">
        <div className="adm-row">
          <input name="q" defaultValue={p.q ?? ""} className="adm-input" style={{ flex: "1 1 240px" }} placeholder="Номер, телефон или фамилия" aria-label="Поиск заказа" />
          <select name="status" defaultValue={p.status ?? ""} className="adm-select" aria-label="Статус">
            <option value="">Все статусы</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_RU[s]}</option>)}
          </select>
          <button type="submit" className="adm-btn primary">Найти</button>
          <Link href="/admin/orders" className="adm-btn">Сбросить</Link>
        </div>
      </form>
      <p className="adm-muted">Найдено: {total}</p>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Покупатель</th>
              <th className="adm-hide-sm">Доставка / оплата</th>
              <th className="num">Сумма</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link className="adm-link" href={`/admin/orders/${o.id}`}><b>{o.no}</b></Link>
                  <div className="adm-muted">{o.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" })}</div>
                  {o.isTest && <span className="adm-chip">тест</span>} {o.source === "one_click" && <span className="adm-chip warn">1 клик</span>}
                </td>
                <td>
                  {o.recipientName || "—"}
                  <div className="adm-muted">{o.recipientPhone ? formatPhone(o.recipientPhone) : ""}</div>
                </td>
                <td className="adm-hide-sm">
                  {DELIVERY_RU[o.delivery] ?? o.delivery}{o.city ? `, ${o.city}` : ""}
                  <div className="adm-muted">{PAY_MODE_RU[o.payMode] ?? o.payMode}</div>
                </td>
                <td className="num">
                  {money(o.total)}
                  <div className="adm-muted">{o._count.items} поз.</div>
                </td>
                <td><span className={statusChip(o.status)}>{ORDER_STATUS_RU[o.status] ?? o.status}</span></td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="adm-muted">Заказов пока нет.</td></tr>
            )}
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
