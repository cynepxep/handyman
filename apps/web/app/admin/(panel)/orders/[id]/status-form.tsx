"use client";

import { useState } from "react";
import { SubmitButton } from "../../import/client-bits";

type Tpl = { id: string; status: string; title: string; autoSend: boolean; text: string };

/**
 * Смена статуса + сообщения покупателю: при выборе статуса показываются его шаблоны (готовый текст на языке покупателя).
 * Шаблоны с «автоматически» отмечены заранее; менеджер сам решает, что отправить, и может дописать свой текст.
 */
export function StatusForm({
  action, orderId, current, statuses, labels, templates, hasTelegram, lang, reasons, currentReason,
}: {
  action: (fd: FormData) => Promise<void>;
  orderId: string;
  current: string;
  statuses: string[];
  labels: Record<string, string>;
  templates: Tpl[];
  hasTelegram: boolean;
  lang: "uk" | "ru";
  reasons: Array<{ key: string; ru: string }>;
  currentReason: string | null;
}) {
  const [status, setStatus] = useState(current);
  const list = templates.filter((t) => t.status === status);
  const needReason = status === "CANCELLED" || status === "RETURNED";
  return (
    <form action={action} className="adm-card">
      <h2 style={{ marginTop: 0 }}>Статус и сообщение покупателю</h2>
      <input type="hidden" name="id" value={orderId} />
      <div className="adm-row">
        <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="adm-select" aria-label="Статус заказа">
          {statuses.map((s) => <option key={s} value={s}>{labels[s] ?? s}</option>)}
        </select>
        {needReason && (
          <select name="cancelReason" defaultValue={currentReason ?? ""} className="adm-select" aria-label="Причина" required>
            <option value="" disabled>Причина…</option>
            {reasons.map((r) => <option key={r.key} value={r.key}>{r.ru}</option>)}
          </select>
        )}
        <input name="note" className="adm-input" style={{ flex: "1 1 260px" }} placeholder="Заметка для сотрудников (необязательно): «перезвонить в 15:00»" maxLength={300} aria-label="Заметка" />
      </div>
      <div style={{ marginTop: 10 }}>
        {list.length ? (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="adm-muted" style={{ fontSize: 14, marginBottom: 4 }}>
              Отправить покупателю ({lang === "ru" ? "по-русски" : "українською"} — язык, на котором оформлен заказ):
            </legend>
            {list.map((t) => (
              <label key={`${status}-${t.id}`} className="adm-msg-pick">
                <input type="checkbox" name="tpl" value={t.id} defaultChecked={t.autoSend && status !== current} />
                <span><b>{t.title}</b>{t.autoSend && <span className="adm-chip ok" style={{ marginLeft: 6 }}>авто</span>}<br /><span className="adm-muted">{t.text}</span></span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="adm-muted" style={{ margin: 0 }}>Для этого статуса шаблонов нет — можно написать свой текст ниже или добавить шаблон в разделе «Шаблоны».</p>
        )}
        <textarea name="custom" className="adm-textarea" rows={2} maxLength={2000} placeholder="Свой текст покупателю (необязательно)" aria-label="Свой текст покупателю" style={{ marginTop: 8 }} />
      </div>
      <div className="adm-row" style={{ marginTop: 8 }}>
        <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
        <span className="adm-muted" style={{ fontSize: 13 }}>
          {hasTelegram ? "Покупатель подключил бота — сообщение придёт в Telegram." : "Покупатель ещё не подключил бота: сообщение сохранится в заказе, его можно скопировать в Viber или SMS."}
        </span>
      </div>
      <p className="adm-muted" style={{ marginTop: 6, marginBottom: 0 }}>Склад: товар с нашего склада отложен под заказ; «Отправлен» или «Выполнен» списывает его, «Отменён» снимает резерв, «Возврат» после отправки возвращает на полку.</p>
    </form>
  );
}

/** Кнопка «Скопировать» для текста сообщения. */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="adm-btn"
      style={{ minHeight: 32, padding: "4px 10px", fontSize: 13 }}
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => {})}
    >
      {done ? "Скопировано ✓" : "Скопировать"}
    </button>
  );
}
