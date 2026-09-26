import Link from "next/link";
import { pctChange, type Period } from "@handyman/core/shop";

/** Выбор периода: сегодня / 7 / 30 дней / месяц / свой «с — по». Параметры остальных фильтров сохраняются. */
export function PeriodPicker({ base, p, extra = {} }: { base: string; p: Period; extra?: Record<string, string> }) {
  const href = (q: Record<string, string>) => `${base}?${new URLSearchParams({ ...extra, ...q }).toString()}`;
  const opts: Array<[string, string]> = [["today", "Сегодня"], ["7d", "7 дней"], ["30d", "30 дней"], ["month", "Этот месяц"]];
  return (
    <div className="adm-row" style={{ marginBottom: 12 }}>
      <nav className="adm-tabs" aria-label="Период" style={{ margin: 0 }}>
        {opts.map(([k, l]) => <Link key={k} href={href({ period: k })} aria-current={p.kind === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      <form method="get" action={base} className="adm-row" style={{ gap: 6 }}>
        {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="period" value="custom" />
        <input type="date" name="from" defaultValue={p.fromYmd} className="adm-input" aria-label="С" />
        <input type="date" name="to" defaultValue={p.toYmd} className="adm-input" aria-label="По" />
        <button type="submit" className={p.kind === "custom" ? "adm-btn primary" : "adm-btn"}>Показать</button>
      </form>
    </div>
  );
}

/** Плитка с числом и сравнением с прошлым периодом (▲/▼ %, для «меньше — лучше» — invert). */
export function Stat({ value, label, cur, prev, invert = false, tone = "", href }: { value: string | number; label: string; cur?: number; prev?: number; invert?: boolean; tone?: string; href?: string }) {
  const d = cur !== undefined && prev !== undefined ? pctChange(cur, prev) : undefined;
  const good = d == null ? null : invert ? d <= 0 : d >= 0;
  const inner = (
    <>
      <b>{value}</b>
      <small>
        {label}
        {d != null && d !== 0 && <span className={good ? "adm-ok" : "adm-bad"}> {d > 0 ? "▲" : "▼"} {Math.abs(d)}%</span>}
        {d === null && cur ? <span className="adm-muted"> (раньше не было)</span> : null}
      </small>
    </>
  );
  return href ? <Link href={href} className={`adm-stat link ${tone}`}>{inner}</Link> : <div className={`adm-stat ${tone}`}>{inner}</div>;
}

/**
 * Столбики одной серии (одна краска — легенда не нужна, подпись в заголовке). Наведение — подсказка с точным значением;
 * под графиком — те же числа таблицей (для чтения с экрана и копирования).
 */
export function Bars({ title, data, format = (n) => String(n), tableLabel }: { title: string; data: Array<{ label: string; value: number; hint?: string }>; format?: (n: number) => string; tableLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((a, d) => (d.value > a.value ? d : a), data[0] ?? { label: "", value: 0 });
  return (
    <figure className="adm-chart">
      <figcaption><b>{title}</b>{peak && peak.value > 0 && <span className="adm-muted"> · максимум {format(peak.value)} ({peak.label})</span>}</figcaption>
      <div className="adm-bars" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} — ${format(d.value)}`).join(", ")}`}>
        {data.map((d) => (
          <div key={d.label} className="adm-bar" tabIndex={0}>
            <i style={{ height: `${Math.max(d.value ? 3 : 0, (d.value / max) * 100)}%` }} />
            <span className="adm-bar-tip">{d.hint ?? d.label}: <b>{format(d.value)}</b></span>
          </div>
        ))}
      </div>
      <div className="adm-bars-axis"><span>{data[0]?.label}</span><span>{data.at(-1)?.label}</span></div>
      <details>
        <summary className="adm-muted" style={{ fontSize: 13 }}>Таблицей</summary>
        <table className="adm-table" style={{ minWidth: 0 }}>
          <thead><tr><th>{tableLabel}</th><th className="num">Значение</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.label}><td>{d.hint ?? d.label}</td><td className="num">{format(d.value)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** Простая таблица «ключ — количество — сумма» (каналы, оплаты, причины отмен). Суммы — только с правом «Финансы». */
export function CountTable({ rows, title, labels = {}, money, showMoney }: { rows: Array<{ key: string; count: number; sum: number }>; title: string; labels?: Record<string, string>; money: (n: number) => string; showMoney: boolean }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="adm-table-wrap" style={{ marginBottom: 12 }}>
      <table className="adm-table" style={{ minWidth: 0 }}>
        <thead><tr><th>{title}</th><th className="num">Заказов</th><th className="num">Доля</th>{showMoney && <th className="num">Сумма</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{labels[r.key] ?? r.key}</td><td className="num">{r.count}</td><td className="num">{total ? Math.round((r.count / total) * 100) : 0}%</td>
              {showMoney && <td className="num">{money(r.sum)}</td>}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={showMoney ? 4 : 3} className="adm-muted">Нет данных за период.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
