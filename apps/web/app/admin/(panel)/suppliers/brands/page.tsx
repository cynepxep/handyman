// Бренды: сколько товаров, у каких поставщиков. Добавить, переименовать, объединить дубли («MILWAUKEE» и «Milwaukee»), удалить пустой.
import Link from "next/link";
import { prisma } from "@handyman/db";
import { listBrands } from "@handyman/db/suppliers";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { SupplierTabs } from "../tabs";
import { createBrandAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("suppliers.edit");
  const { ok, error } = await searchParams;
  const [rows, suppliers] = await Promise.all([
    listBrands(),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <h1>Поставщики и бренды</h1>
      <SupplierTabs />
      <p className="adm-lead">
        Бренд показывается покупателю в карточке товара и в фильтре «Бренд». Новые бренды появляются сами при загрузке каталога (из файла поставщика) —
        здесь их можно переименовать, объединить дубли и отметить, какие поставщики их возят.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <details className="adm-card">
        <summary><b>+ Добавить бренд</b></summary>
        <form action={createBrandAction} style={{ marginTop: 10 }}>
          <div className="adm-field">
            <label htmlFor="b-name">Название</label>
            <input id="b-name" name="name" className="adm-input" placeholder="Milwaukee" required />
          </div>
          <fieldset className="adm-field" style={{ border: 0, padding: 0 }}>
            <legend>Поставщики этого бренда</legend>
            <div className="adm-row" style={{ gap: 12, marginTop: 6 }}>
              {suppliers.map((s) => (
                <label key={s.id}><input type="checkbox" name="supplierIds" value={s.id} /> {s.name}</label>
              ))}
            </div>
          </fieldset>
          <SubmitButton primary pendingText="Добавляю…">Добавить</SubmitButton>
        </form>
      </details>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Бренд</th>
              <th>Поставщики</th>
              <th className="num">Товаров</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><Link className="adm-link" href={`/admin/suppliers/brands/${b.id}`}><b>{b.name}</b></Link></td>
                <td>
                  <div className="adm-row" style={{ gap: 4 }}>
                    {b.suppliers.length ? b.suppliers.map((s) => (
                      <Link key={s.id} href={`/admin/suppliers/${s.id}`} className="adm-chip">{s.name}</Link>
                    )) : <span className="adm-muted">—</span>}
                  </div>
                </td>
                <td className="num"><Link className="adm-link" href={`/admin/products?brand=${b.id}`}>{b.products}</Link></td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={3} className="adm-muted">Брендов пока нет.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
