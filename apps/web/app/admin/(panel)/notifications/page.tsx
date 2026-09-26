import { dailySummaryText, loadNotify } from "@handyman/db/jobs";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { saveNotifyAction, sendNowAction } from "./actions";

export const dynamic = "force-dynamic";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("managers.edit");
  const sp = await searchParams;
  const s = await loadNotify();
  const preview = await dailySummaryText(s);
  // только «есть/нет» — сами ключи никогда не показываем
  const botReady = Boolean(process.env.BOT_TOKEN?.trim() && process.env.ADMIN_CHAT_ID?.trim());
  const check = (name: keyof typeof s, label: string, hint?: string) => (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", minHeight: 40, padding: "4px 0" }}>
      <input type="checkbox" name={name} defaultChecked={Boolean(s[name])} style={{ marginTop: 4 }} />
      <span>{label}{hint && <><br /><small className="adm-muted">{hint}</small></>}</span>
    </label>
  );

  return (
    <>
      <h1>Уведомления в Telegram</h1>
      <p className="adm-lead">
        Бот пишет в чат менеджеров: о новых заказах (сразу), вечерняя сводка, отчёт за неделю, напоминания по задачам и тревоги. Работает, пока
        запущен сайт — проверка раз в минуту.
      </p>
      <p>Бот: {botReady ? <span className="adm-chip ok">настроен</span> : <span className="adm-chip warn">не настроен — сообщения сохраняются, но не уходят (BOT_TOKEN и ADMIN_CHAT_ID в .env)</span>}</p>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}

      <form action={saveNotifyAction} className="adm-card">
        <div className="adm-row" style={{ alignItems: "center" }}>
          {check("daily", "Ежедневная сводка")}
          <select name="dailyHour" defaultValue={s.dailyHour} className="adm-select" aria-label="Во сколько сводка">{HOURS.map((h) => <option key={h} value={h}>в {h}:00</option>)}</select>
        </div>
        <div className="adm-row" style={{ alignItems: "center" }}>
          {check("weekly", "Отчёт за неделю по понедельникам")}
          <select name="weeklyHour" defaultValue={s.weeklyHour} className="adm-select" aria-label="Во сколько отчёт">{HOURS.map((h) => <option key={h} value={h}>в {h}:00</option>)}</select>
        </div>
        {check("taskReminders", "Напоминания по задачам в срок", "«⏰ Напоминание для olya: перезвонить Петру (заказ HM-1024)»")}
        {check("alerts", "Тревоги", "загрузка каталога не прошла, продажи ниже обычного больше чем на 40 %, хит закончился, товар ниже минимума")}
        {check("showMoney", "Показывать суммы в сводках", "выключите, если в чате не только владелец")}
        <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
      </form>

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Сводка за сегодня — так она выглядит</h2>
        <pre style={{ whiteSpace: "pre-wrap", font: "inherit", background: "var(--adm-soft)", padding: 12, borderRadius: 10, margin: "0 0 10px" }}>{preview}</pre>
        <div className="adm-row">
          <form action={sendNowAction}><input type="hidden" name="what" value="daily" /><SubmitButton pendingText="…">Отправить сводку сейчас</SubmitButton></form>
          <form action={sendNowAction}><input type="hidden" name="what" value="weekly" /><SubmitButton pendingText="…">Отправить отчёт за прошлую неделю</SubmitButton></form>
          <form action={sendNowAction}><input type="hidden" name="what" value="test" /><SubmitButton pendingText="…">Проверочное сообщение</SubmitButton></form>
        </div>
      </section>
    </>
  );
}
