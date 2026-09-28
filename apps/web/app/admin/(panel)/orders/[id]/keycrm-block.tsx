// KeyCRM в карточке заказа (шаг 3.5): передан ли заказ (номер, статус в KeyCRM), ошибка и когда повтор, кнопка «Отправить в KeyCRM» /
// «Отправить ещё раз» (тестовый — с галочкой подтверждения); напоминание «статус сменился в KeyCRM — напишите покупателю».
import Link from "next/link";
import { KEYCRM_STATE_RU, ORDER_STATUS_RU } from "@handyman/core/shop";
import type { KeycrmMode } from "@handyman/db/keycrm";
import { SubmitButton } from "../../import/client-bits";
import { dismissPendingAction, sendKeycrmAction } from "../actions";

type KeycrmOrder = {
  id: string; isTest: boolean; keycrmId: string | null; keycrmState: string | null; keycrmAttempts: number; keycrmNextTryAt: Date | null;
  keycrmError: string | null; keycrmSentAt: Date | null; keycrmUuid: string | null; keycrmStub: boolean;
};
type Pending = { id: string; status: string; keycrmStatus: string | null; createdAt: Date };

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const time = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const chip = (s: string | null) => (s === "sent" ? "adm-chip ok" : s === "error" ? "adm-chip bad" : "adm-chip warn");

/** Напоминание сверху заказа: статус сменили в KeyCRM, а авто-сообщения для него нет. */
export function KeycrmPending({ orderId, pending, canEdit }: { orderId: string; pending: Pending[]; canEdit: boolean }) {
  const p = pending[0];
  if (!p) return null;
  return (
    <div className="adm-flash warn" role="status">
      🔄 {when(p.createdAt)} статус сменили в KeyCRM{p.keycrmStatus ? ` на «${p.keycrmStatus}»` : ""} → на сайте «{ORDER_STATUS_RU[p.status] ?? p.status}».
      Авто-сообщения для этого статуса нет: выберите шаблон или напишите свой текст в блоке «Статус и сообщение покупателю» ниже и сохраните.
      {canEdit && (
        <form action={dismissPendingAction} style={{ display: "inline", marginLeft: 8 }}>
          <input type="hidden" name="id" value={orderId} />
          <SubmitButton pendingText="…">Не нужно писать</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function KeycrmBlock({ order: o, mode, enabled, statusName, canEdit, isOwner }: {
  order: KeycrmOrder; mode: KeycrmMode; enabled: boolean; statusName: string | null; canEdit: boolean; isOwner: boolean;
}) {
  const where = isOwner ? <Link className="adm-link" href="/admin/integrations/keycrm">«Интеграции → KeyCRM»</Link> : "«Интеграции → KeyCRM» (владелец)";
  const canSend = canEdit && !o.keycrmId && mode !== "off" && o.keycrmState !== "sending";
  return (
    <section className="adm-card">
      <h2 style={{ marginTop: 0 }}>KeyCRM</h2>
      {mode === "stub" && !o.keycrmId && (
        <p className="adm-muted" style={{ margin: "0 0 8px" }}>🧪 KeyCRM не подключён — отправка даст тестовый номер (в KeyCRM ничего не уходит). На сервере (production) без ключа отправки нет.</p>
      )}
      {o.keycrmId ? (
        <p style={{ margin: "0 0 6px" }}>
          <span className="adm-chip ok">{KEYCRM_STATE_RU.sent}</span> <b>№ {o.keycrmId}</b>
          {o.keycrmStub ? " (тестовый номер — KeyCRM не был подключён)" : ""}
          {o.keycrmUuid && o.keycrmUuid !== "" ? <span className="adm-muted"> · номер в источнике {o.keycrmUuid}</span> : null}
          {o.keycrmSentAt ? <span className="adm-muted"> · {when(o.keycrmSentAt)}</span> : null}
          {statusName ? <> · статус в KeyCRM: <b>{statusName}</b></> : null}
        </p>
      ) : o.keycrmState ? (
        <>
          <p style={{ margin: "0 0 6px" }}>
            <span className={chip(o.keycrmState)}>{KEYCRM_STATE_RU[o.keycrmState] ?? o.keycrmState}</span>
            {o.keycrmAttempts > 0 && <span className="adm-muted"> · попыток: {o.keycrmAttempts}</span>}
          </p>
          {o.keycrmError && (
            <p style={{ margin: "0 0 6px" }}>
              {o.keycrmError}{" "}
              <span className="adm-muted">
                {o.keycrmState === "error" && o.keycrmNextTryAt ? `Сайт повторит сам около ${time(o.keycrmNextTryAt)}.` : o.keycrmState === "error" ? "Сам сайт больше не повторяет — нажмите «Отправить ещё раз»." : ""}
              </span>
            </p>
          )}
        </>
      ) : (
        <p className="adm-muted" style={{ margin: "0 0 6px" }}>
          {o.isTest
            ? "Тестовый заказ — в KeyCRM сам не уходит. Для проверки связи можно отправить его кнопкой: он придёт с пометкой «ТЕСТ — не обрабатывать»."
            : mode === "off"
              ? <>KeyCRM не подключён — заказы не передаются ({where}).</>
              : enabled
                ? "Заказ создан до включения передачи — в KeyCRM не отправлялся."
                : <>Передача заказов в KeyCRM выключена ({where}). Этот заказ можно отправить вручную.</>}
        </p>
      )}
      {canSend && (
        <form action={sendKeycrmAction} className="adm-row" style={{ marginTop: 6 }}>
          <input type="hidden" name="id" value={o.id} />
          {o.isTest && (
            <label className="adm-check"><input type="checkbox" name="confirmTest" required /> Отправить тестовый заказ с пометкой «ТЕСТ»</label>
          )}
          <SubmitButton pendingText="Отправляю…">{o.keycrmState === "error" ? "Отправить ещё раз" : "Отправить в KeyCRM"}</SubmitButton>
        </form>
      )}
    </section>
  );
}
