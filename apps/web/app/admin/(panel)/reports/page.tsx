import Link from "next/link";
import { catalogStats, ordersReport, productsReport, salesReport } from "@handyman/db/reports";
import { DELIVERY_RU, ORDER_SOURCE_RU, PAY_MODE_RU, WEEKDAYS_RU, humanMinutes, periodRange } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { Bars, CountTable, PeriodPicker, Stat } from "./bits";

export const dynamic = "force-dynamic";

type SP = { tab?: string; period?: string; from?: string; to?: string };
const TABS: Array<[string, string]> = [["sales", "Продажи"], ["products", "Товары"], ["orders", "Заказы"], ["catalog", "Каталог"]];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePermission("orders.view");
  const fin = session.permissions.includes("finance.view");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "sales";
  const p = periodRange(sp);
  const periodQs = new URLSearchParams({ period: p.kind, ...(p.kind === "custom" ? { from: p.fromYmd, to: p.toYmd } : {}) });
  const exportHref = `/admin/reports/export?${new URLSearchParams({ tab, ...Object.fromEntries(periodQs) })}`;

  return (
    <>
      <div className="adm-row" style={{ justifyContent: "space-between" }}>
        <h1>Отчёты</h1>
        {tab !== "catalog" && <a className="adm-btn" href={exportHref} download>⬇ Выгрузить в Excel</a>}
      </div>
      <p className="adm-lead">
        Цифры из своей базы (не из Google Analytics): тестовые заказы не считаются. «Продажи» — оформленные заказы без отмен и возвратов;
        прибыль — в разделе «Финансы». {fin ? "" : "Суммы в гривнах видит только владелец (право «Финансы»)."}
      </p>
      <nav className="adm-tabs" aria-label="Отчёт">
        {TABS.map(([k, l]) => <Link key={k} href={`/admin/reports?${new URLSearchParams({ tab: k, ...Object.fromEntries(periodQs) })}`} aria-current={tab === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      {tab !== "catalog" && <PeriodPicker base="/admin/reports" p={p} extra={{ tab }} />}
      {tab === "sales" && <Sales p={p} fin={fin} />}
      {tab === "products" && <Products p={p} fin={fin} />}
      {tab === "orders" && <Orders p={p} />}
      {tab === "catalog" && <Catalog />}
    </>
  );
}

async function Sales({ p, fin }: { p: ReturnType<typeof periodRange>; fin: boolean }) {
  const s = await salesReport(p);
  const c = s.cur;
  const v = s.prev;
  return (
    <>
      <div className="adm-grid">
        {fin && <Stat value={money(c.revenue)} label="продажи" cur={c.revenue} prev={v.revenue} tone="ok" />}
        <Stat value={c.sold} label="заказов (без отмен)" cur={c.sold} prev={v.sold} />
        {fin && <Stat value={c.avg ? money(c.avg) : "—"} label="средний чек" cur={c.avg} prev={v.avg} />}
        <Stat value={c.newClients} label="новых покупателей" cur={c.newClients} prev={v.newClients} />
        <Stat value={c.repeatClients} label="повторных покупателей" cur={c.repeatClients} prev={v.repeatClients} />
        <Stat value={c.lost} label={`отмен и возвратов${fin && c.lostSum ? ` на ${money(c.lostSum)}` : ""}`} cur={c.lost} prev={v.lost} invert tone={c.lost ? "warn" : ""} />
        {fin && c.discounts > 0 && <Stat value={money(c.discounts)} label="скидок дали" cur={c.discounts} prev={v.discounts} invert />}
      </div>
      <p className="adm-muted">Сравнение — с предыдущими {p.days} дн. Конверсия (посетители → покупка) появится с аналитикой сайта на Этапе 6.</p>
      {p.days > 1 && (
        <Bars
          title={fin ? "Продажи по дням, ₴" : "Заказы по дням"} tableLabel="День"
          data={s.days.map((d) => ({ label: `${d.day.slice(8, 10)}.${d.day.slice(5, 7)}`, value: fin ? d.revenue : d.orders, hint: `${d.day.slice(8, 10)}.${d.day.slice(5, 7)} · заказов ${d.orders}` }))}
          format={fin ? (n) => money(n) : String}
        />
      )}
      <div className="adm-grid2">
        <div><h2>Откуда заказы</h2><CountTable rows={s.bySource} title="Источник" labels={ORDER_SOURCE_RU} money={money} showMoney={fin} /></div>
        <div><h2>Оплата</h2><CountTable rows={s.byPay} title="Способ" labels={PAY_MODE_RU} money={money} showMoney={fin} /></div>
        <div><h2>Доставка</h2><CountTable rows={s.byDelivery} title="Способ" labels={DELIVERY_RU} money={money} showMoney={fin} /></div>
        <div><h2>Отмены и возвраты — причины</h2><CountTable rows={s.lostByReason} title="Причина" money={money} showMoney={fin} /></div>
      </div>
      <div className="adm-grid2">
        <Bars title="По дням недели (заказов)" tableLabel="День" data={s.byWeekday.map((n, i) => ({ label: WEEKDAYS_RU[i], value: n }))} />
        <Bars title="По часам (заказов, время Киева)" tableLabel="Час" data={s.byHour.map((n, h) => ({ label: `${h}:00`, value: n }))} />
      </div>
    </>
  );
}

async function Products({ p, fin }: { p: ReturnType<typeof periodRange>; fin: boolean }) {
  const r = await productsReport(p);
  const list = (rows: typeof r.byQty) => (
    <div className="adm-table-wrap">
      <table className="adm-table" style={{ minWidth: 0 }}>
        <thead><tr><th>Товар</th><th className="num">Шт.</th><th className="num">Заказов</th>{fin && <th className="num">Выручка</th>}</tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.sku}>
              <td>{x.productId ? <Link className="adm-link" href={`/admin/products/${x.productId}`}>{x.name}</Link> : x.name}<div className="adm-muted">{x.sku}</div></td>
              <td className="num">{x.qty}</td><td className="num">{x.orders}</td>{fin && <td className="num">{money(x.revenue)}</td>}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={fin ? 4 : 3} className="adm-muted">Продаж за период нет.</td></tr>}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <p className="adm-muted">Продавалось разных товаров: {r.soldProducts}.</p>
      <div className="adm-grid2">
        <div><h2>Топ по количеству</h2>{list(r.byQty)}</div>
        {fin && <div><h2>Топ по выручке</h2>{list(r.byRevenue)}</div>}
      </div>
      <h2>На нашем складе без продаж</h2>
      <div className="adm-grid">
        <Stat value={r.staleCounts.d30} label="не продавались 30+ дней" tone={r.staleCounts.d30 ? "warn" : ""} />
        <Stat value={r.staleCounts.d60} label="60+ дней" />
        <Stat value={r.staleCounts.d90} label="90+ дней" tone={r.staleCounts.d90 ? "bad" : ""} />
      </div>
      {r.stale.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Товар</th><th className="num">На складе</th><th>Последняя продажа</th>{fin && <th className="num">Лежит на сумму</th>}</tr></thead>
            <tbody>
              {r.stale.map((x) => (
                <tr key={x.productId}>
                  <td><Link className="adm-link" href={`/admin/products/${x.productId}`}>{x.name}</Link><div className="adm-muted">{x.sku}</div></td>
                  <td className="num">{x.onHand}</td>
                  <td>{x.lastSale ? x.lastSale.toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv" }) : "не продавался"}</td>
                  {fin && <td className="num">{x.purchasePrice != null ? money(x.purchasePrice * x.onHand) : "нет закупки"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="adm-grid2">
        <div>
          <h2>Что ищут на сайте</h2>
          <ul>{r.queries.map((q) => <li key={q.query}>{q.query} <span className="adm-muted">— {q.count} раз</span></li>)}{!r.queries.length && <li className="adm-muted">Нет данных.</li>}</ul>
        </div>
        <div>
          <h2>Искали, но не нашли</h2>
          <ul>{r.notFound.map((q) => <li key={q.query}>{q.query} <span className="adm-muted">— {q.count} раз</span></li>)}{!r.notFound.length && <li className="adm-muted">Нет — всё находится.</li>}</ul>
          <p className="adm-muted" style={{ fontSize: 13 }}>Чего не хватает в каталоге или каких синонимов. Подробнее — «Сайт → Главная → Подсказки поиска».</p>
        </div>
      </div>
    </>
  );
}

async function Orders({ p }: { p: ReturnType<typeof periodRange> }) {
  const r = await ordersReport(p);
  return (
    <>
      <div className="adm-grid">
        <Stat value={r.total} label="заказов за период" />
        <Stat value={humanMinutes(r.firstTouchMedian)} label="обычно до первого действия менеджера (медиана)" />
        <Stat value={humanMinutes(r.shipMedian)} label="обычно от заказа до отправки" />
        <Stat value={r.untouched} label="новых, к которым ещё не прикасались" tone={r.untouched ? "warn" : ""} href="/admin/orders?status=NEW" />
        <Stat value={r.noAnswer} label="«Не дозвонились»" tone={r.noAnswer ? "warn" : ""} href="/admin/orders?status=NO_ANSWER" />
        <Stat value={r.manual} label="принято по звонку" />
      </div>
      <p className="adm-muted">«Первое действие» — первая смена статуса или заметка после оформления. Медиана — «обычно»: половина заказов быстрее, половина медленнее.</p>
      <div className="adm-grid2">
        <div>
          <h2>Кто обрабатывал</h2>
          <div className="adm-table-wrap"><table className="adm-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Сотрудник</th><th className="num">Заказов</th><th className="num">Действий</th></tr></thead>
            <tbody>
              {r.byWho.map((w) => <tr key={w.who}><td>{w.who}</td><td className="num">{w.orders}</td><td className="num">{w.changes}</td></tr>)}
              {!r.byWho.length && <tr><td colSpan={3} className="adm-muted">Нет данных.</td></tr>}
            </tbody>
          </table></div>
        </div>
        <div>
          <h2>Кто принимал заказы по звонку</h2>
          <div className="adm-table-wrap"><table className="adm-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Сотрудник</th><th className="num">Заказов</th></tr></thead>
            <tbody>
              {r.byCreator.map((w) => <tr key={w.key}><td>{w.key}</td><td className="num">{w.count}</td></tr>)}
              {!r.byCreator.length && <tr><td colSpan={2} className="adm-muted">Нет.</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}

async function Catalog() {
  const c = await catalogStats();
  return (
    <>
      <p className="adm-muted">Состояние каталога сейчас (без периода). Нажмите на плитку — откроется список этих товаров.</p>
      <div className="adm-grid">
        <Stat value={c.total} label="товаров всего" href="/admin/products" />
        <Stat value={c.visible} label="видно покупателям" />
        <Stat value={c.supplier} label="есть у поставщика" tone="ok" href="/admin/products?avail=yes" />
        <Stat value={c.own} label="есть на нашем складе" tone="ok" href="/admin/stock" />
        <Stat value={c.noPhoto} label="без фото" tone={c.noPhoto ? "warn" : ""} />
        <Stat value={c.noDesc} label="без описания" tone={c.noDesc ? "warn" : ""} />
        <Stat value={c.noCost} label="на складе без закупочной цены" tone={c.noCost ? "warn" : ""} href="/admin/stock" />
        <Stat value={c.conflicts} label="расхождений цен" tone={c.conflicts ? "warn" : ""} href="/admin/products?flag=conflict" />
        <Stat value={c.unsorted} label="не разложены по категориям" tone={c.unsorted ? "warn" : ""} />
      </div>
    </>
  );
}
