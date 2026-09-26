import Link from "next/link";
import { loadFinance, monthReport } from "@handyman/db/finance";
import { EXPENSE_CATEGORIES, ORDER_SOURCE_RU, PAY_MODE_RU, monthRu, normalizeMonth, shiftMonth } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { SubmitButton } from "../import/client-bits";
import { addExpenseAction, copyExpensesAction, deleteExpenseAction, saveFinanceSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return null;
  const d = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return <span className={d >= 0 ? "adm-ok" : "adm-bad"} style={{ fontSize: 13 }}> {d >= 0 ? "▲" : "▼"} {Math.abs(d)}% к прошлому</span>;
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ m?: string; ok?: string; error?: string }> }) {
  await requirePermission("finance.view");
  const sp = await searchParams;
  const month = normalizeMonth(sp.m);
  const [r, s] = await Promise.all([monthReport(month), loadFinance()]);
  const t = r.totals;

  return (
    <>
      <h1>Финансы</h1>
      <p className="adm-lead">
        Чистая прибыль, а не выручка: из каждого выполненного заказа вычитаются закупка, комиссия за оплату и доставка за счёт магазина, затем —
        постоянные расходы месяца. Считаются заказы, ставшие «Выполнен» в этом месяце; тестовые не считаются. Раздел видит только владелец
        (право «Финансы»).
      </p>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}
      <nav className="adm-row" aria-label="Месяц">
        <Link className="adm-btn" href={`/admin/finance?m=${shiftMonth(month, -1)}`}>← {monthRu(shiftMonth(month, -1))}</Link>
        <b style={{ fontSize: 18, padding: "0 8px" }}>{monthRu(month)}</b>
        <Link className="adm-btn" href={`/admin/finance?m=${shiftMonth(month, 1)}`}>{monthRu(shiftMonth(month, 1))} →</Link>
      </nav>

      <div className="adm-grid">
        <div className="adm-stat"><b>{money(t.revenue)}</b><small>выручка ({t.count} заказ.)<Delta cur={t.revenue} prev={r.prev.revenue} /></small></div>
        <div className="adm-stat"><b>{money(t.cost)}</b><small>закупка товара</small></div>
        <div className="adm-stat"><b>{money(t.commission + t.delivery)}</b><small>комиссии {money(t.commission)} + доставка {money(t.delivery)}</small></div>
        <div className="adm-stat ok"><b>{money(t.gross)}</b><small>прибыль с заказов · маржа {t.marginPct}%</small></div>
        <div className="adm-stat"><b>{money(t.expenses)}</b><small>постоянные расходы</small></div>
        <div className={`adm-stat ${t.net >= 0 ? "ok" : "bad"}`}><b>{money(t.net)}</b><small>чистая прибыль<Delta cur={t.net} prev={r.prev.net} /></small></div>
        <div className="adm-stat"><b>{t.avg ? money(t.avg) : "—"}</b><small>средний чек</small></div>
        <div className="adm-stat"><b>{money(r.inTransit.amount)}</b><small>деньги в пути: {r.inTransit.count} отправл. с оплатой при получении</small></div>
        <div className="adm-stat"><b>{money(r.inWork.amount)}</b><small>в работе: {r.inWork.count} заказ. ещё не выполнены</small></div>
      </div>
      {(t.unknown > 0 || t.estimated > 0) && (
        <p className="adm-flash err" role="status">
          {t.unknown > 0 && <>Позиций без закупочной цены: {t.unknown} — их закупка посчитана как 0, прибыль завышена. </>}
          {t.estimated > 0 && <>Позиций с закупкой «по оценке» (цена − дилерская скидка {s.dealerDiscountPct}%): {t.estimated}. </>}
          Впишите закупку в <Link className="adm-link" href="/admin/stock">«Склад»</Link> (или приходом) — точнее станет всё.
        </p>
      )}

      <h2>Заказы месяца</h2>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Заказ</th><th className="num">Выручка</th><th className="num">Закупка</th><th className="num adm-hide-sm">Комиссия + доставка</th><th className="num">Прибыль</th></tr></thead>
          <tbody>
            {r.orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link className="adm-link" href={`/admin/orders/${o.id}`}><b>{o.no}</b></Link> <span className="adm-muted">{o.name ?? ""}</span>
                  <div className="adm-muted">{o.doneAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv" })} · {ORDER_SOURCE_RU[o.source ?? "site"] ?? o.source}</div>
                  {o.profit.unknown > 0 && <span className="adm-chip warn">без закупки: {o.profit.unknown}</span>} {o.lowMargin && <span className="adm-chip bad">маржа ниже {s.minMarginPct}%</span>}
                </td>
                <td className="num">{money(o.profit.revenue)}</td>
                <td className="num">{money(o.profit.cost)}{o.profit.estimated > 0 && <div className="adm-muted">оценка</div>}</td>
                <td className="num adm-hide-sm">{money(o.profit.commission + o.profit.delivery)}</td>
                <td className="num"><b className={o.profit.profit >= 0 ? "" : "adm-bad"}>{money(o.profit.profit)}</b><div className="adm-muted">{o.profit.marginPct}%</div></td>
              </tr>
            ))}
            {!r.orders.length && <tr><td colSpan={5} className="adm-muted">В этом месяце выполненных заказов нет.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Постоянные расходы — {monthRu(month)}</h2>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Расход</th><th className="num">Сумма</th><th></th></tr></thead>
          <tbody>
            {r.expenses.map((e) => (
              <tr key={e.id}>
                <td>{e.title}<div className="adm-muted">{e.category} · внёс {e.who}</div></td>
                <td className="num">{money(e.amount)}</td>
                <td>
                  <form action={deleteExpenseAction}>
                    <input type="hidden" name="id" value={e.id} /><input type="hidden" name="month" value={month} />
                    <button type="submit" className="adm-btn" aria-label={`Удалить расход ${e.title}`}>✕</button>
                  </form>
                </td>
              </tr>
            ))}
            {!r.expenses.length && <tr><td colSpan={3} className="adm-muted">Расходов за месяц не внесено.</td></tr>}
          </tbody>
        </table>
      </div>
      <form action={addExpenseAction} className="adm-card">
        <input type="hidden" name="month" value={month} />
        <div className="adm-row">
          <select name="category" className="adm-select" aria-label="Категория">{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input name="title" className="adm-input" style={{ flex: "1 1 200px" }} placeholder="Что именно (например, аренда склада)" maxLength={120} aria-label="Название расхода" />
          <input name="amount" className="adm-input" style={{ width: 130 }} inputMode="decimal" placeholder="Сумма, ₴" aria-label="Сумма" required />
          <SubmitButton primary pendingText="…">Добавить</SubmitButton>
        </div>
      </form>
      {!r.expenses.length && (
        <form action={copyExpensesAction}><input type="hidden" name="month" value={month} /><SubmitButton pendingText="…">Скопировать расходы из прошлого месяца</SubmitButton></form>
      )}

      <details className="adm-group" style={{ marginTop: 20 }}>
        <summary>Настройки расчёта: комиссии, оценка закупки, минимальная маржа</summary>
        <div className="adm-group-body">
          <form action={saveFinanceSettingsAction}>
            <input type="hidden" name="month" value={month} />
            <p className="adm-muted">Комиссия за приём оплаты — % от суммы заказа по способу оплаты (узнайте тариф в mono / банке; пока 0 — не учитывается).</p>
            <div className="adm-row">
              {(["PREPAY", "FULL", "CARD", "LATER"] as const).map((k) => (
                <label key={k} className="adm-field" style={{ margin: 0 }}>
                  <span style={{ fontSize: 13 }}>{PAY_MODE_RU[k]}</span>
                  <input name={`c_${k}`} className="adm-input" style={{ width: 90 }} inputMode="decimal" defaultValue={s.commissionPct[k]} />
                </label>
              ))}
            </div>
            <div className="adm-grid2">
              <div className="adm-field">
                <label htmlFor="f-dd">Дилерская скидка для оценки закупки, %</label>
                <input id="f-dd" name="dealerDiscountPct" className="adm-input" style={{ width: 110 }} inputMode="decimal" defaultValue={s.dealerDiscountPct} />
                <small className="adm-muted">Если у товара нет закупочной цены: закупка ≈ цена продажи минус этот %. 0 — не оценивать.</small>
              </div>
              <div className="adm-field">
                <label htmlFor="f-mm">Минимальная маржа, %</label>
                <input id="f-mm" name="minMarginPct" className="adm-input" style={{ width: 110 }} inputMode="decimal" defaultValue={s.minMarginPct} />
                <small className="adm-muted">Заказы с маржой ниже будут отмечены. 0 — не следить.</small>
              </div>
            </div>
            <SubmitButton primary pendingText="Сохраняю…">Сохранить настройки</SubmitButton>
          </form>
        </div>
      </details>
    </>
  );
}
