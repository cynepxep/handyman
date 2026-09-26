import Link from "next/link";
import { ORDER_STATUSES, listOrders } from "@handyman/db/orders";
import { DELIVERY_RU, ORDER_SOURCE_RU, ORDER_STATUS_RU, PAY_MODE_RU, formatPhone, parseOrderFilters, type OrderFilters } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { statusChip } from "./status-chip";

export const dynamic = "force-dynamic";

const PAYS = Object.keys(PAY_MODE_RU);
const DELIVERIES = Object.keys(DELIVERY_RU);

function href(f: OrderFilters, over: Partial<Record<keyof OrderFilters, string>>): string {
  const qs = new URLSearchParams();
  const merged = { ...f, page: f.page > 1 ? String(f.page) : "", test: f.test === "all" ? "" : f.test, ...over };
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, String(v));
  const s = qs.toString();
  return `/admin/orders${s ? `?${s}` : ""}`;
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePermission("orders.view");
  const canEdit = session.permissions.includes("orders.edit");
  const f = parseOrderFilters(await searchParams, { statuses: ORDER_STATUSES, pays: PAYS, deliveries: DELIVERIES });
  const { total, page, pages, rows, sum, actionCount } = await listOrders(f);
  const filtered = Boolean(f.q || f.status || f.source || f.pay || f.delivery || f.from || f.to || f.test !== "all");
  const quick = [
    { label: `Требуют действия${actionCount ? ` (${actionCount})` : ""}`, to: href({ ...f, page: 1 }, { status: "action" }), on: f.status === "action" },
    { label: "Сегодня", to: href({ ...f, page: 1 }, { from: today(), to: today() }), on: f.from === today() && f.to === today() },
    { label: "7 дней", to: href({ ...f, page: 1 }, { from: daysAgo(6), to: today() }), on: f.from === daysAgo(6) && f.to === today() },
    { label: "Без тестовых", to: href({ ...f, page: 1 }, { test: "hide" }), on: f.test === "hide" },
  ];

  return (
    <>
      <div className="adm-row" style={{ justifyContent: "space-between" }}>
        <h1>Заказы</h1>
        <div className="adm-row">
          {canEdit && <Link href="/admin/orders/new" className="adm-btn primary">+ Заказ по звонку</Link>}
          {session.permissions.includes("settings.edit") && <Link href="/admin/orders/seller" className="adm-btn">Реквизиты для счёта</Link>}
        </div>
      </div>
      <p className="adm-lead">
        Все заказы: с сайта, «Купить в 1 клик» и принятые по телефону. Новые сверху. Нажмите на номер, чтобы открыть заказ: товары, покупатель, доставка,
        статус, сообщения покупателю, печать. «Тест» — заказы сотрудников, в статистике не считаются.
      </p>
      <nav className="adm-tabs" aria-label="Быстрые фильтры">
        {quick.map((q) => <Link key={q.label} href={q.to} aria-current={q.on ? "page" : undefined}>{q.label}</Link>)}
      </nav>
      <form method="get" className="adm-card">
        <div className="adm-row">
          <input name="q" defaultValue={f.q} className="adm-input" style={{ flex: "1 1 220px" }} placeholder="Номер, телефон или фамилия" aria-label="Поиск заказа" />
          <select name="status" defaultValue={f.status} className="adm-select" aria-label="Статус">
            <option value="">Все статусы</option>
            <option value="action">Требуют действия</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_RU[s]}</option>)}
          </select>
          <select name="source" defaultValue={f.source} className="adm-select" aria-label="Откуда">
            <option value="">Откуда: все</option>
            {Object.entries(ORDER_SOURCE_RU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <details style={{ marginTop: 8 }} open={Boolean(f.pay || f.delivery || f.from || f.to || f.test !== "all")}>
          <summary className="adm-muted">Ещё фильтры: оплата, доставка, даты, тестовые</summary>
          <div className="adm-row" style={{ marginTop: 8 }}>
            <select name="pay" defaultValue={f.pay} className="adm-select" aria-label="Оплата">
              <option value="">Оплата: любая</option>
              {PAYS.map((k) => <option key={k} value={k}>{PAY_MODE_RU[k]}</option>)}
            </select>
            <select name="delivery" defaultValue={f.delivery} className="adm-select" aria-label="Доставка">
              <option value="">Доставка: любая</option>
              {DELIVERIES.map((k) => <option key={k} value={k}>{DELIVERY_RU[k]}</option>)}
            </select>
            <label className="adm-row" style={{ gap: 6 }}>с <input type="date" name="from" defaultValue={f.from} className="adm-input" /></label>
            <label className="adm-row" style={{ gap: 6 }}>по <input type="date" name="to" defaultValue={f.to} className="adm-input" /></label>
            <select name="test" defaultValue={f.test} className="adm-select" aria-label="Тестовые заказы">
              <option value="all">Тестовые: показывать</option>
              <option value="hide">Тестовые: скрыть</option>
              <option value="only">Только тестовые</option>
            </select>
          </div>
        </details>
        <div className="adm-row" style={{ marginTop: 8 }}>
          <button type="submit" className="adm-btn primary">Найти</button>
          {filtered && <Link href="/admin/orders" className="adm-btn">Сбросить</Link>}
        </div>
      </form>
      <p className="adm-muted">Найдено: {total}{sum > 0 && <> · на сумму {money(sum)} (без отмен и тестовых)</>}</p>

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
                  {o.source === "manual" && <span className="adm-chip">по звонку</span>}
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
              <tr><td colSpan={5} className="adm-muted">{filtered ? "По этим условиям заказов нет." : "Заказов пока нет."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="adm-pager">
          {page > 1 && <Link className="adm-btn" href={href(f, { page: String(page - 1) })}>← Назад</Link>}
          <span className="adm-muted">Страница {page} из {pages}</span>
          {page < pages && <Link className="adm-btn" href={href(f, { page: String(page + 1) })}>Дальше →</Link>}
        </div>
      )}
    </>
  );
}
