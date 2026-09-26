import Link from "next/link";
import { prisma } from "@handyman/db";
import { listStock } from "@handyman/db/stock";
import { requirePermission } from "@/lib/auth";
import { inventoryAction } from "../actions";
import { InventoryForm } from "../stock-forms";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  await requirePermission("stock.edit");
  const warehouses = await prisma.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { sort: "asc" }], select: { id: true, name: true } });
  // список «по учёту» — основной склад; при нескольких складах пересчитывайте каждый отдельно
  const { rows } = await listStock({ warehouseId: warehouses[0]?.id, perPage: 1000 });
  const current = rows.filter((r) => r.onHand > 0).map((r) => ({ sku: r.sku, name: r.name, onHand: r.onHand }));
  return (
    <>
      <p><Link className="adm-link" href="/admin/stock">← Склад</Link></p>
      <h1>Инвентаризация</h1>
      <p className="adm-lead">
        Пересчитайте товар на полке и впишите «Факт». После проведения учёт станет равен факту, а каждая разница запишется в журнал движений
        (кто, когда, сколько). Товары с пустым полем не меняются — можно пересчитывать частями. Резервы под заказы не трогаются.
      </p>
      <InventoryForm action={inventoryAction} warehouses={warehouses} current={current} />
    </>
  );
}
