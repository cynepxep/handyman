import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { SupplierTabs } from "../tabs";
import { SupplierForm } from "../supplier-form";
import { deleteSupplierAction, saveSupplierAction } from "../actions";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("suppliers.edit");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const [supplier, brands, runs, byBrand] = await Promise.all([
    prisma.supplier.findUnique({ where: { id }, include: { brands: { select: { brandId: true } }, _count: { select: { products: true } } } }),
    prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.importRun.findMany({ where: { supplierId: id, status: "DONE" }, orderBy: { startedAt: "desc" }, take: 5, select: { id: true, startedAt: true, summary: true, undoneAt: true } }),
    prisma.product.groupBy({ by: ["brandId"], where: { supplierId: id }, _count: { _all: true } }),
  ]);
  if (!supplier) notFound();
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  return (
    <>
      <h1>{supplier.name}</h1>
      <SupplierTabs />
      <p><Link className="adm-link" href="/admin/suppliers">← Все поставщики</Link></p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      <div className="adm-row" style={{ marginBottom: 12 }}>
        <Link className="adm-btn primary" href={`/admin/import?supplier=${supplier.id}`}>Загрузить каталог</Link>
        <Link className="adm-btn" href={`/admin/products?supplier=${supplier.id}`}>Товары поставщика ({supplier._count.products})</Link>
      </div>
      {byBrand.length > 0 && (
        <p className="adm-muted">
          Товары по брендам:{" "}
          {byBrand.map((b, i) => (
            <span key={b.brandId ?? "none"}>
              {i > 0 && ", "}
              <Link className="adm-link" href={`/admin/products?supplier=${supplier.id}&brand=${b.brandId ?? "none"}`}>
                {b.brandId ? brandName.get(b.brandId) ?? "?" : "без бренда"}
              </Link>{" "}— {b._count._all}
            </span>
          ))}
        </p>
      )}

      <SupplierForm
        supplier={{ ...supplier, brands: supplier.brands.map((b) => ({ id: b.brandId })) }}
        brands={brands}
        action={saveSupplierAction}
      />

      <h2>Последние загрузки</h2>
      {runs.length ? (
        <ul>
          {runs.map((r) => {
            const s = r.summary as { created?: number; updated?: number } | null;
            return (
              <li key={r.id}>
                <Link className="adm-link" href={`/admin/import?run=${r.id}`}>{when(r.startedAt)}</Link>: добавлено {s?.created ?? 0}, обновлено {s?.updated ?? 0}
                {r.undoneAt ? " — отменена" : ""}
              </li>
            );
          })}
        </ul>
      ) : <p className="adm-muted">Каталог этого поставщика ещё не загружали.</p>}

      <details className="adm-card">
        <summary><b>Удалить поставщика</b></summary>
        <p className="adm-muted">Удалить можно только поставщика без товаров (сначала отмените его загрузки в «Импорте»). Если просто больше не работаете — снимите галочку «Работаем с ним».</p>
        <form action={deleteSupplierAction}>
          <input type="hidden" name="id" value={supplier.id} />
          <SubmitButton pendingText="Удаляю…">Удалить «{supplier.name}»</SubmitButton>
        </form>
      </details>
    </>
  );
}
