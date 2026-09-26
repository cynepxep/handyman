"use client";

import { useState } from "react";
import { SubmitButton } from "../../import/client-bits";

/** Статус обращения + черновик сообщения покупателю, который подставляется по выбранному статусу (можно исправить перед отправкой). */
export function ServiceStatusForm({
  action, id, current, resolution, statuses, resolutions, drafts,
}: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  current: string;
  resolution: string | null;
  statuses: Array<{ key: string; ru: string }>;
  resolutions: Record<string, string>;
  drafts: Record<string, string>;
}) {
  const [status, setStatus] = useState(current);
  const [message, setMessage] = useState(drafts[current] ?? "");
  const [send, setSend] = useState(false);
  return (
    <form action={action} className="adm-card">
      <h2 style={{ marginTop: 0 }}>Статус</h2>
      <input type="hidden" name="id" value={id} />
      <div className="adm-row">
        <select name="status" value={status} onChange={(e) => { setStatus(e.target.value); setMessage(drafts[e.target.value] ?? ""); }} className="adm-select" aria-label="Статус обращения">
          {statuses.map((s) => <option key={s.key} value={s.key}>{s.ru}</option>)}
        </select>
        <select name="resolution" defaultValue={resolution ?? ""} className="adm-select" aria-label="Итог">
          <option value="">Итог: пока нет</option>
          {Object.entries(resolutions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input name="note" className="adm-input" style={{ flex: "1 1 220px" }} placeholder="Заметка (ТТН в сервис, что сказал мастер…)" maxLength={500} aria-label="Заметка" />
      </div>
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 40, marginTop: 8 }}>
        <input type="checkbox" name="send" checked={send} onChange={(e) => setSend(e.target.checked)} /> Написать покупателю
      </label>
      {send && <textarea name="message" className="adm-textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500} aria-label="Сообщение покупателю" />}
      <div style={{ marginTop: 8 }}><SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton></div>
    </form>
  );
}
