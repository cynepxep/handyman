// «Отчёты → Метрики»: десять главных цифр магазина — воронка, деньги, реклама, повторные покупки. Данные — db/src/metrics.ts.
import type { ReactNode } from "react";
import Link from "next/link";
import { METRIC_CHANNEL_RU, pctChange, type Period } from "@handyman/core/shop";
import { metricsReport } from "@handyman/db/metrics";
import { money } from "@/lib/catalog";
import { Bars } from "./bits";

const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("ru-RU")} %`);
const ruDate = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
const times = (n: number | null) => (n == null ? "—" : `×${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}`);

/** Плитка метрики: значение, название, «что показывает», пояснение и сравнение с прошлым периодом. */
function Metric({ value, title, what, note, cur, prev, invert = false, tone = "" }: {
  value: string | number; title: string; what: string; note?: ReactNode; cur?: number | null; prev?: number | null; invert?: boolean; tone?: string;
}) {
  const d = cur != null && prev != null ? pctChange(cur, prev) : undefined;
  const good = d == null ? null : invert ? d <= 0 : d >= 0;
  return (
    <div className={`adm-stat adm-metric ${tone}`}>
      <small className="adm-metric-title">{title}</small>
      <b>{value}{d != null && d !== 0 && <span className={good ? "adm-ok" : "adm-bad"}> {d > 0 ? "▲" : "▼"} {Math.abs(d)}%</span>}</b>
      <small>{what}</small>
      {note && <small className="adm-metric-note">{note}</small>}
    </div>
  );
}

export async function Metrics({ p, fin }: { p: Period; fin: boolean }) {
  const m = await metricsReport(p);
  const c = m.cur;
  const v = m.prev;
  const funnel: Array<{ label: string; value: number; what: string }> = [
    { label: "Посетители", value: c.visitors, what: "сколько людей пришло" },
    { label: "Добавили в корзину", value: c.cart, what: "интерес" },
    { label: "Начали оформление", value: c.checkout, what: "намерение купить" },
    { label: "Заказали", value: c.online, what: "конверсия" },
    { label: "Выкупили", value: c.doneOnline, what: "реальные деньги" },
  ];
  const top = Math.max(1, ...funnel.map((f) => f.value));
  const since = m.countingSince && m.countingSince > p.fromYmd ? m.countingSince : !m.countingSince ? "" : null;
  const noSpend = c.spend <= 0;
  const spendHint = (
    <>Нужен расход на рекламу: <Link className="adm-link" href="/admin/finance">«Финансы» → расходы</Link>, категория «Реклама».</>
  );

  return (
    <>
      {since !== null && (
        <p className="adm-flash">
          {since ? `Посетителей, корзины и оформления сайт считает с ${ruDate(since)} — до этой даты в отчёте их нет (заказы — за весь период).`
            : "Посетителей, корзины и оформления сайт начнёт считать с первого визита покупателя — пока данных нет (заказы считаются как обычно)."}
        </p>
      )}

      <h2>Воронка</h2>
      <div className="adm-funnel" role="table" aria-label="Воронка: от посетителя до выкупа">
        {funnel.map((f, i) => (
          <div key={f.label} className="adm-funnel-row" role="row">
            <span role="cell" className="adm-funnel-name"><b>{f.label}</b><small className="adm-muted">{f.what}</small></span>
            <span role="cell" className="adm-funnel-bar"><i style={{ width: `${Math.max(f.value ? 1.5 : 0, (f.value / top) * 100)}%` }} /></span>
            <span role="cell" className="num adm-funnel-num">
              <b>{f.value.toLocaleString("ru-RU")}</b>
              {i > 0 && <small className="adm-muted">{pct(c.visitors ? Math.round((f.value / c.visitors) * 1000) / 10 : null)} от посетителей</small>}
            </span>
          </div>
        ))}
      </div>
      <p className="adm-muted" style={{ fontSize: 13 }}>
        «Заказали» — оформленные покупателем на сайте, «в 1 клік» и в Telegram{c.manual ? `; ещё ${c.manual} — по звонку (в воронку не входят)` : ""}.
        «Выкупили» — из заказов этого периода уже «Выполнен»: в работе ещё {c.inWork}, отменено и возвращено {c.lost}.
      </p>

      <div className="adm-grid adm-metrics">
        <Metric title="Посетители" what="сколько людей пришло" value={c.visitors.toLocaleString("ru-RU")} cur={c.visitors} prev={v.visitors} />
        <Metric title="Добавили в корзину" what="интерес" value={c.cart} note={`${pct(c.visitors ? Math.round((c.cart / c.visitors) * 1000) / 10 : null)} посетителей`} cur={c.cart} prev={v.cart} />
        <Metric title="Начали оформление" what="намерение купить" value={c.checkout} note={`${pct(c.cart ? Math.round((c.checkout / c.cart) * 1000) / 10 : null)} от корзин`} cur={c.checkout} prev={v.checkout} />
        <Metric title="Заказали" what="конверсия" value={c.online} note={`${pct(c.conversion)} посетителей сделали заказ`} cur={c.conversion} prev={v.conversion} />
        <Metric title="Выкупили" what="реальные деньги" value={fin ? money(c.doneSum) : c.done} note={`${c.done} из ${c.orders} заказов (${pct(c.buyout)})`} cur={fin ? c.doneSum : c.done} prev={fin ? v.doneSum : v.done} tone="ok" />
        {fin && <Metric title="Средний чек" what="сколько покупают" value={c.avg ? money(c.avg) : "—"} note={`по ${c.sold} заказам без отмен`} cur={c.avg} prev={v.avg} />}
        {fin && (
          <Metric
            title="Валовая прибыль" what="сколько остаётся" value={money(c.gross)} cur={c.gross} prev={v.gross}
            tone={c.gross < 0 ? "bad" : ""}
            note={<>с выкупленных: выручка минус закупка, комиссии и доставка{c.grossRevenue > 0 ? ` (маржа ${pct(Math.round((c.gross / c.grossRevenue) * 1000) / 10)})` : ""}
              {c.grossUnknown > 0 ? `; без закупочной цены строк: ${c.grossUnknown}` : ""}</>}
          />
        )}
        {fin && (
          <Metric
            title="CAC" what="цена привлечения клиента" value={c.cac == null ? "—" : money(c.cac)} cur={c.cac} prev={v.cac} invert
            note={noSpend ? spendHint : `реклама ${money(c.spend)} / новых покупателей ${c.newClients}`}
          />
        )}
        {fin && (
          <Metric
            title="ROAS" what="эффективность рекламы" value={times(c.roas)} cur={c.roas} prev={v.roas}
            tone={c.roas != null && c.roas < 1 ? "bad" : ""}
            note={noSpend ? spendHint : `продажи с рекламы ${money(c.adRevenue)} (${c.adSold} заказ.) / реклама ${money(c.spend)}`}
          />
        )}
        <Metric
          title="Повторные покупки" what="насколько бизнес живой" value={pct(c.repeatShare)} cur={c.repeatShare} prev={v.repeatShare}
          note={`за период: ${c.repeatClients} из ${c.repeatClients + c.newClients} покупателей уже покупали раньше; за всё время 2+ заказа у ${m.allTime.repeaters} из ${m.allTime.buyers} (${pct(m.allTime.share)})`}
        />
      </div>
      <p className="adm-muted" style={{ fontSize: 13 }}>
        Стрелки — сравнение с предыдущими {p.days} дн. Тестовые заказы не считаются.{" "}
        {fin ? "Выручка рекламы — заказы без отмен, пришедшие по рекламной ссылке (метки utm, gclid, fbclid, ttclid; помним 30 дней)." : "Суммы, прибыль, CAC и ROAS видит только владелец (право «Финансы»)."}
      </p>

      {fin && (
        <>
          <h2>По каналам</h2>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Откуда</th><th className="num">Посетители</th><th className="num">В корзину</th><th className="num">Оформляли</th>
                  <th className="num">Заказали</th><th className="num">Конверсия</th><th className="num">Продажи</th>
                  <th className="num">Реклама</th><th className="num">ROAS</th><th className="num">Новых</th><th className="num">CAC</th>
                </tr>
              </thead>
              <tbody>
                {c.channels.map((r) => (
                  <tr key={r.channel}>
                    <td>{METRIC_CHANNEL_RU[r.channel]}</td>
                    <td className="num">{r.visitors}</td><td className="num">{r.cart}</td><td className="num">{r.checkout}</td>
                    <td className="num">{r.orders}</td><td className="num">{pct(r.conversion)}</td><td className="num">{money(r.revenue)}</td>
                    <td className="num">{r.channel === "none" ? "" : r.spend ? money(r.spend) : "—"}</td>
                    <td className="num">{times(r.roas)}</td><td className="num">{r.newClients}</td><td className="num">{r.cac == null ? "—" : money(r.cac)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="adm-muted" style={{ fontSize: 13 }}>
            Канал расхода определяется по названию строки в «Финансы → Расходы» (категория «Реклама»): «Google Ads», «Instagram», «Facebook», «TikTok»,
            остальное — «Другие метки». Месячная сумма делится поровну на дни месяца. «Без рекламы» — поиск Google, закладки, мессенджеры, звонки.
          </p>
        </>
      )}

      {p.days > 1 && (
        <div className="adm-grid2">
          <Bars title="Посетители по дням" tableLabel="День" data={m.days.map((d) => ({ label: `${d.day.slice(8, 10)}.${d.day.slice(5, 7)}`, value: d.visitors, hint: `${d.day.slice(8, 10)}.${d.day.slice(5, 7)} · заказов ${d.orders}` }))} />
          <Bars title="Заказали по дням (сайт, 1 клік, Telegram)" tableLabel="День" data={m.days.map((d) => ({ label: `${d.day.slice(8, 10)}.${d.day.slice(5, 7)}`, value: d.orders }))} />
        </div>
      )}

      <details className="adm-card">
        <summary><b>Как считается</b></summary>
        <ul>
          <li><b>Посетители</b> — сайт считает сам, без cookies и без Google: один человек (адрес + браузер) — один раз в день. Роботы, поисковики и сотрудники с входом в админку не считаются. За несколько дней — сумма по дням.</li>
          <li><b>Добавили в корзину</b>, <b>Начали оформление</b> — сколько посетителей хотя бы раз за день нажали «У кошик» / открыли оформление или «Купити в 1 клік».</li>
          <li><b>Заказали</b> — заказы этого периода, оформленные покупателем; конверсия = заказали / посетители.</li>
          <li><b>Выкупили</b> — заказы этого периода в статусе «Выполнен». Свежие заказы ещё в пути, поэтому за последние дни цифра растёт позже.</li>
          <li><b>Средний чек</b> — сумма заказов без отмен и возвратов / их число (как в «Продажах»).</li>
          <li><b>Валовая прибыль</b> — по выкупленным заказам: цена минус закупка, комиссия оплаты и доставка за счёт магазина (как в «Финансах», без аренды и зарплат).</li>
          <li><b>CAC</b> — расход на рекламу / новые покупатели (первый заказ за всё время — в этом периоде).</li>
          <li><b>ROAS</b> — продажи по рекламным ссылкам / расход на рекламу. ×1 — реклама окупила себя только по выручке; прибыль смотрите вместе с маржой.</li>
          <li><b>Повторные покупки</b> — доля покупателей периода, у которых уже были заказы раньше.</li>
        </ul>
      </details>
    </>
  );
}
