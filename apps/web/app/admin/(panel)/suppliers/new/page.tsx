import Link from "next/link";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";
import { SupplierTabs } from "../tabs";
import { SupplierForm } from "../supplier-form";
import { createSupplierAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewSupplierPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission("suppliers.edit");
  const { error } = await searchParams;
  const brands = await prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <h1>Новый поставщик</h1>
      <SupplierTabs />
      <p><Link className="adm-link" href="/admin/suppliers">← Все поставщики</Link></p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      <SupplierForm brands={brands} action={createSupplierAction} />
    </>
  );
}
