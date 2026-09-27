// Блок «Кассовые чеки» в карточке заказа (шаг 3.3): чеки Checkbox (продажа после оплаты картой, возврат, ручные) со статусом,
// фискальным номером и ссылкой; «Отправить покупателю», «Повторить» для «не создан», «Пробить чек вручную» (наличные/картой при самовывозе).
import Link from "next/link";
import { RECEIPT_KIND_RU, RECEIPT_PAY_RU, RECEIPT_STATUS_RU, type ReceiptKind, type ReceiptPayType, type ReceiptStatus } from "@handyman/core/shop";
import type { ReceiptMode } from "@handyman/db/receipts";
import { money } from "@/lib/catalog";
import { SubmitButton } from "../../import/client-bits";
import { manualReceiptAction, retryReceiptAction, sendReceiptAction } from "../actions";
import { CopyButton } from "./status-form";

type Receipt = {
  id: string; kind: string; payType: string; amount: { toNumber(): number }; status: string; stub: boolean; fiscalCode: string | null; url: string | null;
  error: string | null; attempts: number; sentToClientAt: Date | null; createdBy: string; createdAt: Date;
};

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const chip = (s: string) => (s === "done" ? "adm-chip ok" : s === "error" ? "adm-chip bad" : "adm-chip warn");

export function ReceiptsBlock({ orderId, receipts, mode, receiptable, canEdit, isOwner }: {
  orderId: string; receipts: Receipt[]; mode: ReceiptMode; receiptable: number; canEdit: boolean; isOwner: boolean;
}) {
  const where = isOwner ? <Link className="adm-link" href="/admin/integrations">«Интеграциях»</Link> : "«Интеграциях» (владелец)";
  if (mode === "off" && !receipts.length) {
    return (
      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Кассовые чеки</h2>
        <p className="adm-muted" style={{ margin: 0 }}>Checkbox не подключён — чеки не создаются. Впишите ключ кассы, логин и пароль кассира в {where}.</p>
      </section>
    );
  }
  return (
    <section className="adm-card">
      <h2 style={{ marginTop: 0 }}>Кассовые чеки</h2>
      {mode === "stub" && (
        <p className="adm-muted" style={{ margin: "0 0 8px" }}>
          🧪 Checkbox не подключён — чеки тестовые (в налоговую не уходят, ссылки покупателю нет). На сервере (production) их не будет.
        </p>
      )}
      {mode === "off" && <p className="adm-muted" style={{ margin: "0 0 8px" }}>Checkbox отключён — новые чеки не создаются ({where}).</p>}
      {receipts.length === 0 ? (
        <p className="adm-muted" style={{ margin: "0 0 8px" }}>Чеков пока нет. Чек создаётся сам после оплаты картой на сайте.</p>
      ) : (
        <ul className="adm-msgs">
          {receipts.map((r) => (
            <li key={r.id}>
              <div className="adm-row" style={{ alignItems: "baseline" }}>
                <b>{r.kind === "return" ? "−" : ""}{money(r.amount)}</b>
                <span className={chip(r.status)}>{RECEIPT_STATUS_RU[r.status as ReceiptStatus] ?? r.status}</span>
                <span className="adm-muted" style={{ fontSize: 13 }}>
                  {RECEIPT_KIND_RU[r.kind as ReceiptKind] ?? r.kind}, {RECEIPT_PAY_RU[r.payType as ReceiptPayType] ?? r.payType} · {when(r.createdAt)} · {r.createdBy}
                  {r.stub ? " · тестовый" : ""}{r.fiscalCode ? ` · № ${r.fiscalCode}` : ""}
                </span>
              </div>
              {r.error && r.status !== "done" && (
                <p className="adm-muted" style={{ margin: "4px 0 0" }}>
                  {r.status === "queued" ? `Попытка ${r.attempts} не удалась, сайт повторит сам: ` : ""}{r.error}
                </p>
              )}
              <div className="adm-row" style={{ marginTop: 6 }}>
                {r.url && <a className="adm-link" href={r.url} target="_blank" rel="noopener">Открыть чек</a>}
                {r.url && <CopyButton text={r.url} />}
                {r.url && r.sentToClientAt && <span className="adm-muted" style={{ fontSize: 13 }}>покупателю отправлено {when(r.sentToClientAt)}</span>}
                {canEdit && r.url && (
                  <form action={sendReceiptAction}>
                    <input type="hidden" name="id" value={orderId} />
                    <input type="hidden" name="receipt" value={r.id} />
                    <SubmitButton pendingText="…">{r.sentToClientAt ? "Отправить ещё раз" : "Отправить покупателю"}</SubmitButton>
                  </form>
                )}
                {canEdit && r.status === "error" && mode !== "off" && (
                  <form action={retryReceiptAction}>
                    <input type="hidden" name="id" value={orderId} />
                    <input type="hidden" name="receipt" value={r.id} />
                    <SubmitButton pendingText="Отправляю…">Повторить</SubmitButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && mode !== "off" && receiptable >= 0.01 && (
        <details style={{ marginTop: 8 }}>
          <summary className="adm-link">Пробить чек вручную…</summary>
          <form action={manualReceiptAction} className="adm-row" style={{ marginTop: 6 }}>
            <input type="hidden" name="id" value={orderId} />
            <label htmlFor="rc-amount">Сумма, ₴</label>
            <input id="rc-amount" name="amount" className="adm-input" style={{ width: 110 }} inputMode="decimal" defaultValue={String(receiptable)} required />
            <label htmlFor="rc-pay">Оплата</label>
            <select id="rc-pay" name="payType" className="adm-input" defaultValue="CASH">
              <option value="CASH">наличными</option>
              <option value="CASHLESS">картой (терминал)</option>
            </select>
            <SubmitButton pendingText="Пробиваю…">Пробить чек</SubmitButton>
          </form>
          <p className="adm-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Для оплаты при самовывозе или по звонку. Оплату картой на сайте пробивать не нужно — чек создаётся сам. Вся сумма заказа — чек по товарам, часть — одной строкой «Оплата замовлення».
          </p>
        </details>
      )}
    </section>
  );
}
