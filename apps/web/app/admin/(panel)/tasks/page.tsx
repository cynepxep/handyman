import Link from "next/link";
import { listTasks } from "@handyman/db/service";
import { requirePermission } from "@/lib/auth";
import { TaskForm, TaskList } from "./tasks-block";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  const session = await requirePermission("orders.view");
  const canEdit = session.permissions.includes("orders.edit");
  const sp = await searchParams;
  const tab = sp.tab === "all" || sp.tab === "done" ? sp.tab : "mine";
  const { rows, counts } = await listTasks({ done: tab === "done", assignee: tab === "mine" ? session.username : undefined, limit: 300 });
  const back = `/admin/tasks${tab !== "mine" ? `?tab=${tab}` : ""}`;
  return (
    <>
      <h1>Задачи</h1>
      <p className="adm-lead">
        Напоминания себе и коллегам: «перезвонить в 18:00», «проверить оплату», «заказать у поставщика». Задачу можно поставить здесь или прямо в
        карточке заказа/клиента. Просроченные — красным сверху. Напоминание в Telegram в срок появится вместе с фоновыми задачами (шаг 4.8).
      </p>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}
      <nav className="adm-tabs" aria-label="Какие задачи">
        <Link href="/admin/tasks" aria-current={tab === "mine" ? "page" : undefined}>Мои и общие</Link>
        <Link href="/admin/tasks?tab=all" aria-current={tab === "all" ? "page" : undefined}>Все открытые</Link>
        <Link href="/admin/tasks?tab=done" aria-current={tab === "done" ? "page" : undefined}>Выполненные</Link>
      </nav>
      {tab !== "done" && (counts.overdue > 0 || counts.today > 0) && (
        <p><span className="adm-chip bad">просрочено: {counts.overdue}</span> <span className="adm-chip warn">на сегодня: {counts.today}</span></p>
      )}
      <section className="adm-card">
        <TaskList rows={rows} back={back} canEdit={canEdit} showLinks />
        {canEdit && tab !== "done" && <TaskForm back={back} />}
      </section>
    </>
  );
}
