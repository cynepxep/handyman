import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderDetail, loadSeller } from "@handyman/db/orders";
import { loadContacts } from "@handyman/db/site-content";
import { DELIVERY_RU, NP_TYPE_RU, PAY_MODE_RU, formatPhone } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { ownStockOf } from "@handyman/db/orders";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const uah = (n: number) => `${n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} грн`;
const dayUk = (d: Date) => d.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" });

/** Печатные формы заказа: счёт покупателю (укр.) и комплектовочный лист для склада. Печать — кнопкой или Ctrl+P, меню админки не печатается. */
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  await requirePermission("orders.view");
  const { id } = await params;
  const doc = (await searchParams).doc === "packing" ? "packing" : "invoice";
  const o = await getOrderDetail(id);
  if (!o) notFound();
  const [seller, contacts, own] = await Promise.all([loadSeller(), loadContacts(), ownStockOf(o.items.map((i) => i.productId).filter((x): x is string => Boolean(x)))]);
  const total = o.total.toNumber();
  const due = Math.max(0, total - Math.max(o.dueNow.toNumber(), o.paidAmount.toNumber()));

  return (
    <div className="adm-print">
      <div className="adm-row no-print" style={{ marginBottom: 16 }}>
        <Link className="adm-link" href={`/admin/orders/${o.id}`}>← К заказу</Link>
        <PrintButton />
        <Link className="adm-btn" href={`/admin/orders/${o.id}/print?doc=${doc === "invoice" ? "packing" : "invoice"}`}>{doc === "invoice" ? "Комплектовочный лист" : "Счёт"}</Link>
        {doc === "invoice" && !seller.name && <span className="adm-chip warn">Реквизиты продавца не заполнены — <Link className="adm-link" href="/admin/orders/seller">заполнить</Link></span>}
      </div>

      {doc === "invoice" ? (
        <article>
          <h1 style={{ marginBottom: 2 }}>Рахунок № {o.no}</h1>
          <p style={{ marginTop: 0 }}>від {dayUk(o.createdAt)}</p>
          <table className="adm-print-meta">
            <tbody>
              <tr>
                <th>Постачальник</th>
                <td>
                  <b>{seller.name || "Handyman"}</b>
                  {seller.code && <><br />Код: {seller.code}</>}
                  {seller.iban && <><br />IBAN: {seller.iban}{seller.bank ? `, ${seller.bank}` : ""}</>}
                  {(seller.address || contacts.addressUk) && <><br />{seller.address || contacts.addressUk}</>}
                  {contacts.phones[0] && <><br />Тел.: {contacts.phones[0]}</>}
                </td>
              </tr>
              <tr>
                <th>Покупець</th>
                <td>{[o.recipientName || o.client.name, o.recipientPhone && formatPhone(o.recipientPhone)].filter(Boolean).join(", ") || "—"}</td>
              </tr>
            </tbody>
          </table>
          <table className="adm-print-table">
            <thead><tr><th>№</th><th>Товар</th><th>Артикул</th><th className="num">К-сть</th><th className="num">Ціна</th><th className="num">Сума</th></tr></thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={it.id}>
                  <td>{i + 1}</td><td>{it.name}</td><td>{it.sku}</td><td className="num">{it.qty}</td>
                  <td className="num">{uah(it.unitPrice.toNumber())}</td><td className="num">{uah(it.unitPrice.toNumber() * it.qty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {o.discountPct > 0 && <tr><td colSpan={5} className="num">Знижка</td><td className="num">{o.discountPct}%</td></tr>}
              <tr><td colSpan={5} className="num"><b>Разом до сплати</b></td><td className="num"><b>{uah(total)}</b></td></tr>
              {due > 0.005 && due < total - 0.005 && <tr><td colSpan={5} className="num">Залишок до сплати</td><td className="num">{uah(due)}</td></tr>}
            </tfoot>
          </table>
          <p>Всього найменувань: {o.items.length}, на суму {uah(total)}.</p>
          {seller.note && <p style={{ whiteSpace: "pre-wrap" }}>{seller.note}</p>}
          <p style={{ marginTop: 40 }}>Постачальник ____________________</p>
        </article>
      ) : (
        <article>
          <h1 style={{ marginBottom: 2 }}>Комплектовочный лист {o.no}</h1>
          <p style={{ marginTop: 0 }}>
            {dayUk(o.createdAt)} · {[o.recipientName || o.client.name, o.recipientPhone && formatPhone(o.recipientPhone)].filter(Boolean).join(", ") || "—"}
          </p>
          <p>
            <b>{DELIVERY_RU[o.delivery] ?? o.delivery}</b>
            {o.deliveryType && ` — ${NP_TYPE_RU[o.deliveryType] ?? o.deliveryType}`}
            {o.city && `: ${o.city}`}{o.npWarehouseRef && `, ${o.npWarehouseRef}`}{o.address && `, ${o.address}`}
            {o.ttn && <> · ТТН {o.ttn}</>}
            <br />Оплата: {PAY_MODE_RU[o.payMode] ?? o.payMode}{due > 0.005 && <> · <b>при получении {uah(due)}</b></>}
          </p>
          <table className="adm-print-table">
            <thead><tr><th>✓</th><th>Товар</th><th>Артикул</th><th className="num">Кол-во</th><th>Где взять</th></tr></thead>
            <tbody>
              {o.items.map((it) => {
                const stock = it.productId ? own.get(it.productId) ?? 0 : 0;
                return (
                  <tr key={it.id}>
                    <td className="adm-print-box">☐</td><td>{it.name}</td><td>{it.sku}</td><td className="num"><b>{it.qty}</b></td>
                    <td>{stock > 0 ? `наш склад (ост. ${stock})` : "у поставщика"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {o.comment && <p>Комментарий покупателя: <i>{o.comment}</i></p>}
          <p style={{ marginTop: 32 }}>Собрал ____________________ &nbsp;&nbsp; Проверил ____________________</p>
        </article>
      )}
    </div>
  );
}
