// Поставщики: у каждого свой фид, наценка, бренд по умолчанию и список брендов. Каталог загружается в «Импорте» для выбранного поставщика.
import Link from "next/link";
import { listSuppliers } from "@handyman/db/suppliers";
import { requirePermission } from "@/lib/auth";
import { SupplierTabs } from "./tabs";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("suppliers.edit");
  const { ok, error } = await searchParams;
  const rows = await listSuppliers();

  return (
    <>
      <h1>Поставщики и бренды</h1>
      <SupplierTabs />
      <p className="adm-lead">
        Поставщик — у кого вы берёте товар (у каждого свой XML-фид). Бренд — производитель товара. У поставщика может быть несколько брендов,
        а один бренд можно возить от нескольких поставщиков. Каталог поставщика загружается в разделе <Link className="adm-link" href="/admin/import">Импорт</Link>:
        там выбираете поставщика и отмечаете, какие бренды из его файла загружать.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      <p><Link href="/admin/suppliers/new" className="adm-btn primary">+ Добавить поставщика</Link></p>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Поставщик</th>
              <th>Бренды</th>
              <th className="num">Товаров</th>
              <th className="adm-hide-sm">Последняя загрузка</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link className="adm-link" href={`/admin/suppliers/${s.id}`}><b>{s.name}</b></Link>
                  {!s.active && <> <span className="adm-chip">выключен</span></>}
                  <div className="adm-muted">наценка: {s.markupPct == null ? "нет" : `${s.markupPct}%`}</div>
                  <Link className="adm-btn" style={{ marginTop: 6 }} href={`/admin/import?supplier=${s.id}`}>Загрузить каталог</Link>
                </td>
                <td>
                  <div className="adm-row" style={{ gap: 4 }}>
                    {s.brands.length ? s.brands.map((b) => (
                      <Link key={b.id} href={`/admin/suppliers/brands/${b.id}`} className="adm-chip">{b.name}</Link>
                    )) : <span className="adm-muted">—</span>}
                  </div>
                </td>
                <td className="num"><Link className="adm-link" href={`/admin/products?supplier=${s.id}`}>{s.products}</Link></td>
                <td className="adm-muted adm-hide-sm">{s.lastImport ? <Link className="adm-link" href={`/admin/import?run=${s.lastImport.id}`}>{when(s.lastImport.startedAt)}</Link> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
