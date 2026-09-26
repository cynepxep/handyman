import Link from "next/link";
import { listAudit } from "@handyman/db/staff";
import { requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Понятные названия действий журнала (остальные показываются как есть). */
const ACTION_RU: Record<string, string> = {
  "login.ok": "Вход", "login.ok.recovery": "Вход по коду восстановления", "login.fail": "Неверный пароль", "login.locked": "Вход закрыт (подбор пароля)", "login.code.fail": "Неверные коды из приложения",
  "security.2fa.on": "Включил код из приложения", "security.2fa.off": "Выключил код из приложения", "security.recovery.new": "Новые коды восстановления", "security.password": "Сменил пароль",
  "security.sessions.kill": "Выход со всех устройств", "security.settings": "Правила входа",
  "staff.create": "Добавил сотрудника", "staff.update": "Изменил сотрудника", "staff.password.reset": "Сбросил пароль сотруднику", "staff.2fa.reset": "Сбросил код сотруднику",
  "order.status": "Статус заказа", "order.manual": "Заказ по звонку", "client.edit": "Правка клиента", "stock.set": "Остаток товара", "stock.receive": "Приход на склад", "stock.inventory": "Инвентаризация",
  "stock.settings": "Минимум/закупка товара", "template.edit": "Правка шаблона", "template.create": "Новый шаблон", "template.delete": "Удалил шаблон", "shop.checkout.edit": "Настройки оформления",
  "shop.loyalty.edit": "Уровни скидок", "shop.seller.edit": "Реквизиты для счёта", "finance.settings": "Настройки финансов", "finance.expense.add": "Добавил расход", "finance.expense.delete": "Удалил расход",
  "finance.expense.copy": "Скопировал расходы", "task.delete": "Удалил задачу",
};
const GROUPS: Array<[string, string]> = [["", "Всё"], ["login.", "Входы"], ["security.", "Безопасность"], ["staff.", "Сотрудники"], ["order.", "Заказы"], ["client.", "Клиенты"], ["stock.", "Склад"], ["finance.", "Финансы"], ["import.", "Импорт"], ["site.", "Сайт"], ["product", "Товары"]];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ who?: string; action?: string; page?: string }> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const { total, page, pages, rows, whos } = await listAudit({ who: sp.who, action: sp.action, page: Number(sp.page) || 1 });
  const href = (over: Record<string, string>) => `/admin/audit?${new URLSearchParams(Object.entries({ who: sp.who ?? "", action: sp.action ?? "", ...over }).filter(([, v]) => v))}`;
  return (
    <>
      <h1>Журнал действий</h1>
      <p className="adm-lead">Кто и что менял в админке: входы, заказы, склад, клиенты, цены, настройки. Записи не удаляются.</p>
      <nav className="adm-tabs" aria-label="Что">
        {GROUPS.map(([k, l]) => <Link key={k} href={href({ action: k, page: "" })} aria-current={(sp.action ?? "") === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      <form method="get" className="adm-row" style={{ marginBottom: 10 }}>
        {sp.action && <input type="hidden" name="action" value={sp.action} />}
        <input name="who" defaultValue={sp.who ?? ""} className="adm-input" list="audit-who" placeholder="Кто (имя или логин)" aria-label="Кто" />
        <datalist id="audit-who">{whos.map((w) => <option key={w} value={w} />)}</datalist>
        <button type="submit" className="adm-btn">Найти</button>
        {sp.who && <Link className="adm-btn" href={href({ who: "" })}>Сбросить</Link>}
      </form>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Когда</th><th>Кто</th><th>Что</th><th className="adm-hide-sm">Подробности</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.ts.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "medium" })}</td>
                <td>{r.who}</td>
                <td className={r.action.startsWith("login.fail") || r.action === "login.locked" ? "adm-bad" : undefined}>{ACTION_RU[r.action] ?? r.action}</td>
                <td className="adm-hide-sm adm-muted" style={{ fontSize: 13, maxWidth: 420, overflowWrap: "anywhere" }}>{r.details ? JSON.stringify(r.details).slice(0, 200) : ""}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="adm-muted">Записей нет.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="adm-muted">Всего: {total}</p>
      {pages > 1 && (
        <div className="adm-pager">
          {page > 1 && <Link className="adm-btn" href={href({ page: String(page - 1) })}>← Назад</Link>}
          <span className="adm-muted">Страница {page} из {pages}</span>
          {page < pages && <Link className="adm-btn" href={href({ page: String(page + 1) })}>Дальше →</Link>}
        </div>
      )}
    </>
  );
}
