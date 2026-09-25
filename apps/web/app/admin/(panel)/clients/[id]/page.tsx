import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientDetail } from "@handyman/db/clients";
import { DELIVERY_RU, ORDER_STATUS_RU, TIER_RU, formatPhone, type TierKey } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { SubmitButton } from "../../import/client-bits";
import { statusChip } from "../../orders/status-chip";
import { saveClientAction } from "../actions";
import { tierChip } from "../tier-chip";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const day = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv" });

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requirePermission("clients.view");
  const canEdit = session.permissions.includes("clients.edit");
  const canHistory = session.permissions.includes("orders.history");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const d = await getClientDetail(id);
  if (!d) notFound();
  const { client: c, stats, discount, progress, loyalty } = d;
  const tier = c.tier as TierKey;

  return (
    <>
      <p><Link className="adm-link" href="/admin/clients">← Все клиенты</Link></p>
      <h1>
        {c.name || "Без имени"} <span className={tierChip(tier)} style={{ fontSize: 14, verticalAlign: "middle" }}>{TIER_RU[tier] ?? tier}</span>
      </h1>
      <p className="adm-muted">
        {c.phone ? <a className="adm-link" href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a> : "телефон не указан"}
        {c.email && <> · {c.email}</>}
        {c.tgId != null && <> · Telegram{c.username ? ` @${c.username}` : ""}</>}
        {" "}· клиент с {day(c.createdAt)} · язык: {c.lang === "RU" ? "русский" : "украинский"}
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <div className="adm-grid">
        <div className="adm-stat"><b>{stats.orders}</b><small>заказов (без тестовых)</small></div>
        <div className="adm-stat ok"><b>{money(stats.spent)}</b><small>сумма покупок (выполненные)</small></div>
        <div className="adm-stat"><b>{stats.avg ? money(stats.avg) : "—"}</b><small>средний чек</small></div>
        <div className={stats.cancelled ? "adm-stat warn" : "adm-stat"}><b>{stats.cancelled}</b><small>отмен и возвратов</small></div>
        <div className="adm-stat"><b>{discount.pct ? `${discount.pct} %` : "нет"}</b><small>скидка сейчас{discount.source === "manual" ? " (личная)" : discount.source === "tier" ? " (по уровню)" : ""}</small></div>
      </div>
      {progress && loyalty.enabled && (
        <div className="adm-card">
          <p style={{ margin: "0 0 6px" }}>До уровня «{TIER_RU[progress.next]}» осталось <b>{money(progress.left)}</b></p>
          <div className="adm-progress" role="progressbar" aria-valuenow={progress.pctDone} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress.pctDone}%` }} /></div>
        </div>
      )}
      {!loyalty.enabled && (
        <p className="adm-muted">Уровни скидок сейчас выключены — действует только личная скидка. {session.permissions.includes("settings.edit") && <Link className="adm-link" href="/admin/clients/levels">Настроить уровни</Link>}</p>
      )}

      <form action={saveClientAction} className="adm-card">
        <h2 style={{ marginTop: 0 }}>Данные клиента</h2>
        <input type="hidden" name="id" value={c.id} />
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="adm-grid2">
            <div className="adm-field"><label htmlFor="c-name">Имя</label><input id="c-name" name="name" className="adm-input wide" defaultValue={c.name ?? ""} maxLength={120} /></div>
            <div className="adm-field"><label htmlFor="c-phone">Телефон</label><input id="c-phone" name="phone" className="adm-input wide" defaultValue={c.phone ? formatPhone(c.phone) : ""} inputMode="tel" /></div>
            <div className="adm-field"><label htmlFor="c-email">Почта</label><input id="c-email" name="email" type="email" className="adm-input wide" defaultValue={c.email ?? ""} /></div>
            <div className="adm-field">
              <label htmlFor="c-lang">Язык сообщений</label>
              <select id="c-lang" name="lang" className="adm-select" defaultValue={c.lang}>
                <option value="UK">украинский</option>
                <option value="RU">русский</option>
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="c-disc">Личная скидка, %</label>
              <input id="c-disc" name="manualDiscountPct" className="adm-input" style={{ width: 120 }} inputMode="decimal" defaultValue={c.manualDiscountPct ?? ""} placeholder="нет" />
              <small className="adm-muted">Работает всегда, даже если уровни выключены; вместо скидки по уровню, не вместе с ней.</small>
            </div>
            <div className="adm-field">
              <label>Оптовый покупатель</label>
              <label className="adm-check" style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 40 }}>
                <input type="checkbox" name="wholesale" defaultChecked={tier === "WHOLESALE"} /> уровень «Опт» (бригады){loyalty.wholesalePct ? ` — ${loyalty.wholesalePct} %` : ""}
              </label>
            </div>
          </div>
          <div className="adm-field">
            <label htmlFor="c-note">Заметка (видят только сотрудники)</label>
            <textarea id="c-note" name="note" className="adm-textarea" rows={3} defaultValue={c.note ?? ""} maxLength={2000} placeholder="Например: бригада, берёт круги пачками; звонить после 17:00" />
          </div>
        </fieldset>
        {canEdit ? <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton> : <p className="adm-muted">Менять данные клиента может сотрудник с правом «Клиенты: контакты, личная скидка».</p>}
      </form>

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Заказы</h2>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Заказ</th><th className="adm-hide-sm">Доставка</th><th className="num">Сумма</th><th>Статус</th></tr></thead>
            <tbody>
              {c.orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    {session.permissions.includes("orders.view") ? <Link className="adm-link" href={`/admin/orders/${o.id}`}><b>{o.no}</b></Link> : <b>{o.no}</b>}
                    <div className="adm-muted">{when(o.createdAt)}</div>
                    {o.isTest && <span className="adm-chip">тест</span>} {o.source === "one_click" && <span className="adm-chip warn">1 клик</span>}
                  </td>
                  <td className="adm-hide-sm">{DELIVERY_RU[o.delivery] ?? o.delivery}</td>
                  <td className="num">{money(o.total)}<div className="adm-muted">{o._count.items} поз.</div></td>
                  <td><span className={statusChip(o.status)}>{ORDER_STATUS_RU[o.status] ?? o.status}</span></td>
                </tr>
              ))}
              {!c.orders.length && <tr><td colSpan={4} className="adm-muted">Заказов нет.</td></tr>}
            </tbody>
          </table>
        </div>
        {stats.first && <p className="adm-muted">Первый заказ {day(stats.first)}{stats.last && stats.last !== stats.first ? `, последний ${day(stats.last)}` : ""}.</p>}
      </section>

      {canHistory && (
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>История изменений</h2>
          {c.auditEntries.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {c.auditEntries.map((a) => (
                <li key={a.id}>
                  <span className="adm-muted">{when(a.ts)}</span> — {a.who}: {a.field} «{a.oldValue ?? "—"}» → «{a.newValue ?? "—"}»
                </li>
              ))}
            </ul>
          ) : <p className="adm-muted" style={{ margin: 0 }}>Данные клиента ещё никто не менял.</p>}
        </section>
      )}
    </>
  );
}
