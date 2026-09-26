import Link from "next/link";
import { prisma } from "@handyman/db";
import type { TaskRow } from "@handyman/db/service";
import { formatPhone } from "@handyman/core/shop";
import { createTaskAction, deleteTaskAction, toggleTaskAction } from "./actions";

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const BUCKET_CHIP: Record<string, string> = { overdue: "adm-chip bad", today: "adm-chip warn", later: "adm-chip", none: "adm-chip" };

/** Строки задач с кнопками «Готово»/«Вернуть»/«✕». `showLinks` — показывать заказ и клиента (в общем списке). */
export function TaskList({ rows, back, canEdit, showLinks = false }: { rows: TaskRow[]; back: string; canEdit: boolean; showLinks?: boolean }) {
  if (!rows.length) return <p className="adm-muted" style={{ margin: 0 }}>Задач нет.</p>;
  return (
    <ul className="adm-msgs">
      {rows.map((t) => (
        <li key={t.id} className="adm-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 260px" }}>
            <span style={t.done ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{t.title}</span>
            <div className="adm-muted" style={{ fontSize: 13 }}>
              {t.dueAt && <span className={t.done ? "adm-chip" : BUCKET_CHIP[t.bucket]}>{t.bucket === "overdue" && !t.done ? "просрочено · " : ""}{when(t.dueAt)}</span>}{" "}
              {t.assignee ? `для ${t.assignee}` : "для всех"} · поставил {t.who}
              {t.done && t.doneBy && <> · выполнил {t.doneBy}</>}
              {showLinks && t.orderId && t.orderNo && <> · <Link className="adm-link" href={`/admin/orders/${t.orderId}`}>заказ {t.orderNo}</Link></>}
              {showLinks && t.client && <> · <Link className="adm-link" href={`/admin/clients/${t.client.id}`}>{t.client.name || (t.client.phone ? formatPhone(t.client.phone) : "клиент")}</Link></>}
            </div>
          </div>
          {canEdit && (
            <div className="adm-row" style={{ gap: 6 }}>
              <form action={toggleTaskAction}>
                <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="done" value={t.done ? "0" : "1"} />
                <button type="submit" className={t.done ? "adm-btn" : "adm-btn primary"} style={{ minHeight: 34 }}>{t.done ? "Вернуть" : "✓ Готово"}</button>
              </form>
              <form action={deleteTaskAction}>
                <input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} />
                <button type="submit" className="adm-btn" style={{ minHeight: 34 }} aria-label={`Удалить задачу ${t.title}`}>✕</button>
              </form>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Форма «новая задача» (к заказу/клиенту или сама по себе). */
export async function TaskForm({ back, orderId, clientId }: { back: string; orderId?: string; clientId?: string }) {
  const staff = await prisma.staff.findMany({ where: { active: true, username: { not: "claude-test" } }, select: { username: true, name: true }, orderBy: { name: "asc" } });
  return (
    <form action={createTaskAction} className="adm-row" style={{ marginTop: 10 }}>
      <input type="hidden" name="back" value={back} />
      {orderId && <input type="hidden" name="orderId" value={orderId} />}
      {clientId && <input type="hidden" name="clientId" value={clientId} />}
      <input name="title" className="adm-input" style={{ flex: "1 1 240px" }} placeholder="Что сделать: «перезвонить, уточнить отделение»" maxLength={200} aria-label="Задача" required />
      <input name="dueAt" type="datetime-local" className="adm-input" aria-label="Когда напомнить" />
      {staff.length > 1 && (
        <select name="assignee" className="adm-select" aria-label="Кому">
          <option value="">Всем</option>
          {staff.map((s) => <option key={s.username} value={s.username}>{s.name}</option>)}
        </select>
      )}
      <button type="submit" className="adm-btn primary">Добавить</button>
    </form>
  );
}
