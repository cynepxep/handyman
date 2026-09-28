import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../../import/client-bits";
import { SupplierTabs } from "../../tabs";
import { deleteBrandAction, mergeBrandAction, saveBrandAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function BrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("suppliers.edit");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const [brand, suppliers, others, bySupplier] = await Promise.all([
    prisma.brand.findUnique({ where: { id }, include: { suppliers: { select: { supplierId: true } }, _count: { select: { products: true } } } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.brand.findMany({ where: { id: { not: id } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.groupBy({ by: ["supplierId"], where: { brandId: id }, _count: { _all: true } }),
  ]);
  if (!brand) notFound();
  const mine = new Set(brand.suppliers.map((s) => s.supplierId));
  const supName = new Map(suppliers.map((s) => [s.id, s.name]));

  return (
    <>
      <h1>Бренд «{brand.name}»</h1>
      <SupplierTabs />
      <p><Link className="adm-link" href="/admin/suppliers/brands">← Все бренды</Link></p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      <p>
        <Link className="adm-btn" href={`/admin/products?brand=${brand.id}`}>Товары бренда ({brand._count.products})</Link>
      </p>
      {bySupplier.length > 0 && (
        <p className="adm-muted">
          Товары по поставщикам:{" "}
          {bySupplier.map((s, i) => (
            <span key={s.supplierId ?? "none"}>
              {i > 0 && ", "}
              {s.supplierId ? supName.get(s.supplierId) ?? "?" : "без поставщика"} — {s._count._all}
            </span>
          ))}
        </p>
      )}

      <form action={saveBrandAction} className="adm-card">
        <input type="hidden" name="id" value={brand.id} />
        <div className="adm-field">
          <label htmlFor="b-name">Название (так видит покупатель)</label>
          <input id="b-name" name="name" className="adm-input" defaultValue={brand.name} required />
        </div>
        <fieldset className="adm-field" style={{ border: 0, padding: 0 }}>
          <legend><b>Поставщики этого бренда</b></legend>
          <div className="adm-row" style={{ gap: 12, marginTop: 6 }}>
            {suppliers.map((s) => (
              <label key={s.id}><input type="checkbox" name="supplierIds" value={s.id} defaultChecked={mine.has(s.id)} /> {s.name}</label>
            ))}
          </div>
        </fieldset>
        <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
      </form>

      {others.length > 0 && (
        <details className="adm-card">
          <summary><b>Объединить с другим брендом</b> <span className="adm-muted">— если это дубль (например, «MILWAUKEE» и «Milwaukee»)</span></summary>
          <form action={mergeBrandAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={brand.id} />
            <p className="adm-muted">Все товары «{brand.name}» перейдут в выбранный бренд, поставщики и выбор при загрузке — тоже, а «{brand.name}» исчезнет.</p>
            <div className="adm-row">
              <select name="into" className="adm-select" defaultValue="" aria-label="В какой бренд перенести">
                <option value="" disabled>Перенести в бренд…</option>
                {others.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <SubmitButton pendingText="Объединяю…">Объединить</SubmitButton>
            </div>
          </form>
        </details>
      )}

      <details className="adm-card">
        <summary><b>Удалить бренд</b></summary>
        <p className="adm-muted">Удалить можно только бренд без товаров. Бренд с товарами — объедините с другим.</p>
        <form action={deleteBrandAction}>
          <input type="hidden" name="id" value={brand.id} />
          <SubmitButton pendingText="Удаляю…">Удалить «{brand.name}»</SubmitButton>
        </form>
      </details>
    </>
  );
}
