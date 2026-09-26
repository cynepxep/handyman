import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createManualOrderAction } from "../actions";
import { ManualOrderForm } from "./manual-form";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  await requirePermission("orders.edit");
  return (
    <>
      <p><Link className="adm-link" href="/admin/orders">← Все заказы</Link></p>
      <h1>Заказ по звонку</h1>
      <p className="adm-lead">
        Покупатель позвонил или написал — оформите заказ за него. Цены берутся из каталога автоматически (как на сайте). После создания откроется карточка
        заказа: там можно сменить статус, отправить сообщение, распечатать счёт.
      </p>
      <ManualOrderForm action={createManualOrderAction} />
    </>
  );
}
