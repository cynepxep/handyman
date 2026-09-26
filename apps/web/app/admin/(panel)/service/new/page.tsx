import Link from "next/link";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { createServiceAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewServicePage({ searchParams }: { searchParams: Promise<{ order?: string; error?: string }> }) {
  await requirePermission("orders.edit");
  const sp = await searchParams;
  const orderNo = (sp.order ?? "").trim().toUpperCase();
  const order = orderNo ? await prisma.order.findUnique({ where: { no: orderNo }, select: { no: true, recipientName: true, recipientPhone: true, items: { select: { sku: true, name: true } } } }) : null;
  return (
    <>
      <p><Link className="adm-link" href="/admin/service">← Гарантия</Link></p>
      <h1>Новое гарантийное обращение</h1>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      <form action={createServiceAction} className="adm-card">
        <div className="adm-grid2">
          <div className="adm-field">
            <label htmlFor="s-order">Номер заказа (если покупали у нас)</label>
            <input id="s-order" name="orderNo" className="adm-input wide" defaultValue={order?.no ?? orderNo} placeholder="HM-1024" />
            {orderNo && !order && <small className="adm-bad">Заказ не найден — проверьте номер или оставьте поле пустым.</small>}
          </div>
          {order && order.items.length > 0 ? (
            <div className="adm-field">
              <label htmlFor="s-sku">Товар из заказа</label>
              <select id="s-sku" name="sku" className="adm-select">{order.items.map((i) => <option key={i.sku} value={i.sku}>{i.name}</option>)}</select>
              <input type="hidden" name="productName" value={order.items[0].name} />
              <small className="adm-muted">Название возьмётся из выбранного товара.</small>
            </div>
          ) : (
            <div className="adm-field">
              <label htmlFor="s-name-p">Товар *</label>
              <input id="s-name-p" name="productName" className="adm-input wide" placeholder="например, Шуруповерт Vitals Master…" required maxLength={200} />
            </div>
          )}
        </div>
        <div className="adm-grid2">
          <div className="adm-field"><label htmlFor="s-cn">Имя покупателя</label><input id="s-cn" name="name" className="adm-input wide" defaultValue={order?.recipientName ?? ""} maxLength={80} /></div>
          <div className="adm-field"><label htmlFor="s-ph">Телефон</label><input id="s-ph" name="phone" className="adm-input wide" inputMode="tel" defaultValue={order?.recipientPhone ?? ""} /></div>
        </div>
        <div className="adm-field"><label htmlFor="s-sn">Серийный номер (если есть)</label><input id="s-sn" name="serial" className="adm-input" maxLength={80} /></div>
        <div className="adm-field"><label htmlFor="s-pr">Неисправность со слов покупателя *</label><textarea id="s-pr" name="problem" className="adm-textarea" rows={3} required maxLength={2000} /></div>
        <SubmitButton primary pendingText="Принимаю…">Принять обращение</SubmitButton>
      </form>
      {!order && <p className="adm-muted">Чтобы подтянуть покупателя и товары, откройте заказ и нажмите «🛠 Гарантийное обращение».</p>}
    </>
  );
}
