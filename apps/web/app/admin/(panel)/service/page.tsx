import Link from "next/link";
import { listServiceCases } from "@handyman/db/service";
import { SERVICE_RESOLUTIONS, SERVICE_STATUS_RU, SERVICE_STATUSES, formatPhone, serviceNo, type ServiceStatus } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ServicePage({ searchParams }: { searchParams: Promise<{ status?: string; all?: string; q?: string }> }) {
  const session = await requirePermission("orders.view");
  const sp = await searchParams;
  const status = sp.status && (SERVICE_STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined;
  const rows = await listServiceCases({ status, open: !status && sp.all !== "1", q: sp.q });
  return (
    <>
      <div className="adm-row" style={{ justifyContent: "space-between" }}>
        <h1>Гарантия и обмен</h1>
        {session.permissions.includes("orders.edit") && <Link className="adm-btn primary" href="/admin/service/new">+ Новое обращение</Link>}
      </div>
      <p className="adm-lead">
        Гарантийные обращения: приняли товар → отправили в сервис (Vitals) → ремонт → готово → выдали. На каждом шаге можно написать покупателю.
        Итог: ремонт, обмен на новый, возврат денег или отказ. Возврат денег за заказ оформляйте статусом заказа «Возврат» с причиной.
      </p>
      <nav className="adm-tabs" aria-label="Статус">
        <Link href="/admin/service" aria-current={!status && sp.all !== "1" ? "page" : undefined}>Открытые</Link>
        {SERVICE_STATUSES.map((s) => <Link key={s} href={`/admin/service?status=${s}`} aria-current={status === s ? "page" : undefined}>{SERVICE_STATUS_RU[s]}</Link>)}
        <Link href="/admin/service?all=1" aria-current={sp.all === "1" ? "page" : undefined}>Все</Link>
      </nav>
      <form method="get" className="adm-row" style={{ marginBottom: 10 }}>
        <input name="q" defaultValue={sp.q ?? ""} className="adm-input" style={{ flex: "1 1 240px" }} placeholder="Товар, имя, телефон или серийный номер" aria-label="Поиск обращения" />
        <input type="hidden" name="all" value="1" />
        <button type="submit" className="adm-btn">Найти</button>
      </form>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Обращение</th><th>Покупатель</th><th>Статус</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link className="adm-link" href={`/admin/service/${c.id}`}><b>{serviceNo(c.seq)}</b> {c.productName}</Link>
                  <div className="adm-muted">{c.createdAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv" })}{c.serial ? ` · S/N ${c.serial}` : ""}</div>
                </td>
                <td>{c.name ?? "—"}<div className="adm-muted">{c.phone ? formatPhone(c.phone) : ""}</div></td>
                <td>
                  <span className={c.status === "READY" ? "adm-chip ok" : c.status === "REJECTED" ? "adm-chip bad" : c.status === "CLOSED" ? "adm-chip" : "adm-chip warn"}>{SERVICE_STATUS_RU[c.status as ServiceStatus] ?? c.status}</span>
                  {c.resolution && <div className="adm-muted">{SERVICE_RESOLUTIONS[c.resolution]}</div>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={3} className="adm-muted">Обращений нет.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
