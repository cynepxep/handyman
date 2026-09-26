import Link from "next/link";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";
import { receiveAction } from "../actions";
import { ReceiveForm } from "../stock-forms";

export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  await requirePermission("stock.edit");
  const warehouses = await prisma.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { sort: "asc" }], select: { id: true, name: true } });
  return (
    <>
      <p><Link className="adm-link" href="/admin/stock">← Склад</Link></p>
      <h1>Приход</h1>
      <p className="adm-lead">
        Товар привезли на склад: найдите позиции, впишите количество и (если знаете) закупочную цену за штуку. Остаток вырастет сразу, на сайте товар
        станет «Є в Одесі». Закупочная цена сохранится в товаре — по ней считается прибыль в отчётах.
      </p>
      <ReceiveForm action={receiveAction} warehouses={warehouses} />
    </>
  );
}
