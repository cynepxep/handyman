// Блок «Оплата картой» в карточке заказа (шаг 3.2): сколько оплачено, счета monobank со статусами и ссылками,
// «Выставить счёт» (с отправкой ссылки покупателю), «Проверить оплату», «Отменить ссылку», «Вернуть деньги» (право payments.refund).
import Link from "next/link";
import { INVOICE_KIND_RU, MONO_PENDING, PAY_STATUS_RU, unpaidOf, type InvoiceKind, type MonoStatus } from "@handyman/core/shop";
import type { MonoMode } from "@handyman/db/payments";
import { money } from "@/lib/catalog";
import { SubmitButton } from "../../import/client-bits";
import { cancelInvoiceAction, createInvoiceAction, refreshPaymentsAction, refundAction } from "../actions";
import { CopyButton } from "./status-form";

type Invoice = {
  id: string; kind: string; amount: { toNumber(): number }; paid: { toNumber(): number }; refunded: { toNumber(): number }; status: string;
  pageUrl: string; stub: boolean; failureReason: string | null; checkUntil: Date | null; createdBy: string; createdAt: Date;
};
type Order = { id: string; payMode: string; status: string; total: { toNumber(): number }; dueNow: { toNumber(): number }; paidAmount: { toNumber(): number } };

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const chip = (s: string) => (s === "success" ? "adm-chip ok" : s === "failure" ? "adm-chip bad" : (MONO_PENDING as string[]).includes(s) ? "adm-chip warn" : "adm-chip");

export function PaymentsBlock({ order, invoices, mode, canEdit, canRefund, isOwner }: {
  order: Order; invoices: Invoice[]; mode: MonoMode; canEdit: boolean; canRefund: boolean; isOwner: boolean;
}) {
  const total = order.total.toNumber();
  const paid = order.paidAmount.toNumber();
  const unpaid = unpaidOf({ payMode: order.payMode, status: order.status, total, dueNow: order.dueNow.toNumber(), paidAmount: paid });
  const waiting = invoices.some((i) => !i.stub && ((MONO_PENDING as string[]).includes(i.status) || i.checkUntil));
  if (mode === "off" && !invoices.length) {
    return (
      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Оплата картой</h2>
        <p className="adm-muted" style={{ margin: 0 }}>
          Онлайн-оплата не подключена: впишите токен monobank в {isOwner ? <Link className="adm-link" href="/admin/integrations">«Интеграциях»</Link> : "«Интеграциях» (владелец)"}.
          Пока оплату по реквизитам отмечайте статусом «Оплачен».
        </p>
      </section>
    );
  }
  return (
    <section className="adm-card">
      <h2 style={{ marginTop: 0 }}>Оплата картой</h2>
      <p style={{ margin: "0 0 8px" }}>
        Оплачено картой: <b className={paid > 0 ? "adm-ok" : undefined}>{money(paid)}</b> из {money(total)}
        {unpaid > 0.005 && <> · не оплачено {money(unpaid)}</>}
      </p>
      {mode === "stub" && (
        <p className="adm-muted" style={{ margin: "0 0 8px" }}>
          🧪 monobank не подключён — счета тестовые: «оплатить» можно кнопкой «Тест: імітувати оплату» на странице заказа покупателя. На сервере (production) их не будет.
        </p>
      )}
      {invoices.length > 0 && (
        <ul className="adm-msgs">
          {invoices.map((i) => {
            const pending = (MONO_PENDING as string[]).includes(i.status);
            const ipaid = i.paid.toNumber();
            return (
              <li key={i.id}>
                <div className="adm-row" style={{ alignItems: "baseline" }}>
                  <b>{money(i.amount)}</b>
                  <span className={chip(i.status)}>{PAY_STATUS_RU[i.status as MonoStatus] ?? i.status}</span>
                  <span className="adm-muted" style={{ fontSize: 13 }}>
                    {INVOICE_KIND_RU[i.kind as InvoiceKind] ?? i.kind} · {when(i.createdAt)} · {i.createdBy}{i.stub ? " · тестовый" : ""} · счёт …{i.id.slice(-6)}
                  </span>
                </div>
                {(ipaid > 0 || i.refunded.toNumber() > 0) && (
                  <p style={{ margin: "4px 0 0" }}>
                    Зачтено {money(ipaid)}{i.refunded.toNumber() > 0 && <> · возвращено {money(i.refunded)}</>}
                  </p>
                )}
                {i.failureReason && !pending && <p className="adm-muted" style={{ margin: "4px 0 0" }}>{i.failureReason}</p>}
                {pending && (
                  <div className="adm-row" style={{ marginTop: 6 }}>
                    {!i.stub && <a className="adm-link" href={i.pageUrl} target="_blank" rel="noopener">Ссылка на оплату</a>}
                    {!i.stub && <CopyButton text={i.pageUrl} />}
                    {canEdit && (
                      <form action={cancelInvoiceAction}>
                        <input type="hidden" name="id" value={order.id} />
                        <input type="hidden" name="invoice" value={i.id} />
                        <SubmitButton pendingText="…">Отменить ссылку</SubmitButton>
                      </form>
                    )}
                  </div>
                )}
                {canRefund && ipaid > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary className="adm-link">Вернуть деньги…</summary>
                    <form action={refundAction} className="adm-row" style={{ marginTop: 6 }}>
                      <input type="hidden" name="id" value={order.id} />
                      <input type="hidden" name="invoice" value={i.id} />
                      <label htmlFor={`rf-${i.id}`}>Сумма, ₴</label>
                      <input id={`rf-${i.id}`} name="amount" className="adm-input" style={{ width: 110 }} inputMode="decimal" defaultValue={String(ipaid)} required />
                      <label className="adm-check"><input type="checkbox" name="confirm" required /> Подтверждаю возврат</label>
                      <SubmitButton pendingText="Возвращаю…">Вернуть</SubmitButton>
                    </form>
                    <p className="adm-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                      Деньги вернутся на карту покупателя (обычно за несколько дней — зависит от его банка). Статус заказа поменяйте сами («Отменён» / «Возврат»).
                    </p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="adm-row" style={{ marginTop: 8, alignItems: "flex-end" }}>
        {canEdit && mode !== "off" && unpaid >= 1 && !["CANCELLED", "RETURNED"].includes(order.status) && (
          <form action={createInvoiceAction} className="adm-row">
            <input type="hidden" name="id" value={order.id} />
            <label htmlFor="inv-amount">Выставить счёт на, ₴</label>
            <input id="inv-amount" name="amount" className="adm-input" style={{ width: 110 }} inputMode="decimal" defaultValue={String(Math.round(unpaid * 100) / 100)} required />
            <label className="adm-check"><input type="checkbox" name="send" defaultChecked /> отправить ссылку покупателю</label>
            <SubmitButton pendingText="Создаю…">Создать ссылку</SubmitButton>
          </form>
        )}
        {waiting && mode === "live" && (
          <form action={refreshPaymentsAction}>
            <input type="hidden" name="id" value={order.id} />
            <SubmitButton pendingText="Проверяю…">Проверить оплату</SubmitButton>
          </form>
        )}
      </div>
      {mode === "live" && waiting && (
        <p className="adm-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>Сайт сам спрашивает monobank раз в минуту; оплата отмечается автоматически.</p>
      )}
    </section>
  );
}
