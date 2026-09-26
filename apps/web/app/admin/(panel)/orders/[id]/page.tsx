import Link from "next/link";
import { notFound } from "next/navigation";
import { ORDER_STATUSES, getOrderDetail } from "@handyman/db/orders";
import { clientMessagesOf, templatesForOrder } from "@handyman/db/messages";
import { CANCEL_REASONS, CANCEL_REASON_RU, DELIVERY_RU, NP_TYPE_RU, ORDER_SOURCE_RU, ORDER_STATUS_RU, PAY_MODE_RU, formatPhone } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { SubmitButton } from "../../import/client-bits";
import { retryMessageAction, setStatusAction, setTtnAction } from "../actions";
import { statusChip } from "../status-chip";
import { CopyButton, StatusForm } from "./status-form";

export const dynamic = "force-dynamic";

const OUTBOX_RU: Record<string, string> = {
  PENDING: "ждёт отправки",
  SENT: "отправлено в Telegram",
  DEV: "не отправлено: в .env не задан BOT_TOKEN / ADMIN_CHAT_ID",
  FAILED: "ошибка отправки",
  NO_CHANNEL: "покупатель ещё не подключил бота — скопируйте текст в Viber или SMS",
};

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requirePermission("orders.view");
  const canEdit = session.permissions.includes("orders.edit");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const o = await getOrderDetail(id);
  if (!o) notFound();
  const later = o.total.toNumber() - o.dueNow.toNumber();
  const canHistory = session.permissions.includes("orders.history");
  const [tpl, clientMsgs] = await Promise.all([canEdit ? templatesForOrder(o.id) : null, clientMessagesOf(o.id)]);

  return (
    <>
      <p><Link className="adm-link" href="/admin/orders">← Все заказы</Link></p>
      <h1>
        Заказ {o.no} <span className={statusChip(o.status)} style={{ fontSize: 14, verticalAlign: "middle" }}>{ORDER_STATUS_RU[o.status] ?? o.status}</span>
      </h1>
      <p className="adm-muted">
        {when(o.createdAt)} · {ORDER_SOURCE_RU[o.source ?? "site"] ?? o.source}{o.createdBy ? ` (оформил ${o.createdBy})` : ""} · язык: {o.lang === "RU" ? "русский" : "украинский"}
        {o.isTest && <> · <span className="adm-chip">тестовый заказ</span></>}
        {o.cancelReason && <> · <span className="adm-chip bad">причина: {CANCEL_REASON_RU[o.cancelReason] ?? o.cancelReason}</span></>}
      </p>
      <div className="adm-row" style={{ marginBottom: 8 }}>
        <Link className="adm-btn" href={`/admin/orders/${o.id}/print?doc=invoice`} target="_blank">🖨 Счёт</Link>
        <Link className="adm-btn" href={`/admin/orders/${o.id}/print?doc=packing`} target="_blank">🖨 Комплектовочный лист</Link>
      </div>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <div className="adm-grid2">
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>Покупатель</h2>
          <p><b>{o.recipientName || o.client.name || "—"}</b></p>
          {o.recipientPhone && <p><a className="adm-link" href={`tel:${o.recipientPhone}`}>{formatPhone(o.recipientPhone)}</a></p>}
          {session.permissions.includes("clients.view") && (
            <p><Link className="adm-link" href={`/admin/clients/${o.client.id}`}>Карточка клиента →</Link>{o.client.note ? <span className="adm-muted"> · 📝 {o.client.note}</span> : null}</p>
          )}
          {o.noCallback ? <p><span className="adm-chip warn">просит не звонить для уточнения</span></p> : <p className="adm-muted">Можно звонить для уточнения.</p>}
          {o.comment && <p>Комментарий: <i>{o.comment}</i></p>}
        </section>
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>Доставка и оплата</h2>
          <p>
            <b>{DELIVERY_RU[o.delivery] ?? o.delivery}</b>
            {o.deliveryType && <> — {NP_TYPE_RU[o.deliveryType] ?? o.deliveryType}</>}
          </p>
          {o.city && <p>Город: {o.city}</p>}
          {o.npWarehouseRef && (
            <p>
              {o.deliveryType === "address" ? "Адрес" : o.npPointRef ? "Выбрано из списка НП" : "Номер (написал сам)"}: {o.npWarehouseRef}
            </p>
          )}
          {o.pickupWarehouse && <p>Магазин: {o.pickupWarehouse.name}</p>}
          {o.address && <p>Адрес: {o.address}</p>}
          <p>Оплата: <b>{PAY_MODE_RU[o.payMode] ?? o.payMode}</b></p>
          <p>
            Итого <b>{money(o.total)}</b>
            {o.discountPct > 0 && <> (скидка {o.discountPct}%)</>}
            {o.dueNow.toNumber() > 0 && later > 0.005 && <> · сейчас {money(o.dueNow)}, при получении {money(later)}</>}
          </p>
          <form action={setTtnAction} className="adm-row" style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={o.id} />
            <label htmlFor="ttn">ТТН</label>
            <input id="ttn" name="ttn" className="adm-input" defaultValue={o.ttn ?? ""} inputMode="numeric" placeholder="20450000000000" disabled={!canEdit} />
            {canEdit && <SubmitButton pendingText="…">Сохранить</SubmitButton>}
          </form>
        </section>
      </div>

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Товары</h2>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><th>Товар</th><th className="num">Цена</th><th className="num">Кол-во</th><th className="num">Сумма</th></tr>
            </thead>
            <tbody>
              {o.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    {it.product ? <Link className="adm-link" href={`/admin/products/${it.product.id}`}>{it.name}</Link> : it.name}
                    <div className="adm-muted">{it.sku}{it.product && !it.product.supplierAvailable ? " · сейчас под заказ у поставщика" : ""}</div>
                  </td>
                  <td className="num">{money(it.unitPrice)}</td>
                  <td className="num">{it.qty}</td>
                  <td className="num">{money(it.unitPrice.toNumber() * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canEdit && tpl && (
        <StatusForm
          action={setStatusAction} orderId={o.id} current={o.status} statuses={ORDER_STATUSES} labels={ORDER_STATUS_RU}
          templates={tpl.items} hasTelegram={tpl.hasTelegram} lang={tpl.lang} reasons={CANCEL_REASONS} currentReason={o.cancelReason}
        />
      )}

      {clientMsgs.length > 0 && (
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>Сообщения покупателю</h2>
          <ul className="adm-msgs">
            {clientMsgs.map((m) => (
              <li key={m.id}>
                <div className="adm-muted" style={{ fontSize: 13 }}>
                  {when(m.createdAt)}{m.who ? ` · ${m.who}` : ""} · <span className={m.state === "SENT" ? "adm-chip ok" : m.state === "FAILED" ? "adm-chip bad" : "adm-chip warn"}>{OUTBOX_RU[m.state] ?? m.state}</span>
                  {m.state === "FAILED" && m.error ? ` ${m.error}` : ""}
                </div>
                {canHistory ? (
                  <div className="adm-row" style={{ alignItems: "flex-start", marginTop: 4 }}>
                    <p style={{ margin: 0, flex: "1 1 260px", whiteSpace: "pre-wrap" }}>{m.text}</p>
                    {m.state !== "SENT" && <CopyButton text={m.text} />}
                    {m.state === "FAILED" && canEdit && (
                      <form action={retryMessageAction}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="msg" value={m.id} />
                        <SubmitButton pendingText="…">Повторить</SubmitButton>
                      </form>
                    )}
                  </div>
                ) : <p className="adm-muted" style={{ margin: "4px 0 0" }}>Текст виден сотрудникам с правом «Заказы: подробная история и переписка».</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>История</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {o.history.map((h) => <li key={h.id}><span className="adm-muted">{when(h.ts)}</span> — {h.text}</li>)}
        </ul>
        {o.outboxEntries.length > 0 && (
          <>
            <h3>Уведомление менеджеру</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {o.outboxEntries.map((m) => (
                <li key={m.id}>
                  <span className="adm-muted">{when(m.createdAt)}</span> — {OUTBOX_RU[m.state] ?? m.state}
                  {m.state === "FAILED" && m.error ? `: ${m.error}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
