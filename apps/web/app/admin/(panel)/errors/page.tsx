// «Ошибки» (шаг 8.2; право errors.view — владелец и главный администратор): группы одинаковых ошибок сайта со счётчиком,
// когда были в первый и последний раз, «Закрыть». Хранятся 30 дней после последнего раза. Тексты уже без телефонов и ключей.
import Link from "next/link";
import { ERROR_KEEP_DAYS, ERROR_SOURCE_RU, ERROR_SPIKE, isErrorSource, type ErrorSource } from "@handyman/core/errors";
import { listErrors, type ErrorTab } from "@handyman/db/errors";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { closeAllErrorsAction, closeErrorAction, reopenErrorAction } from "./actions";
import { HealthCard } from "./health-card";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "medium" });
const TABS: Array<[ErrorTab, string]> = [["open", "Открытые"], ["closed", "Закрытые"], ["all", "Все"]];

export default async function ErrorsPage({ searchParams }: { searchParams: Promise<{ tab?: string; source?: string; ok?: string }> }) {
  await requirePermission("errors.view");
  const sp = await searchParams;
  const tab: ErrorTab = sp.tab === "closed" || sp.tab === "all" ? sp.tab : "open";
  const source = isErrorSource(sp.source) ? sp.source : "";
  const { rows, total } = await listErrors({ tab, source });
  const href = (over: { tab?: string; source?: string }) => {
    const q = new URLSearchParams(Object.entries({ tab: tab === "open" ? "" : tab, source, ...over }).filter(([, v]) => v) as Array<[string, string]>);
    return `/admin/errors${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <h1>Ошибки</h1>
      <p className="adm-lead">
        Здесь собираются ошибки сайта: страницы и кнопки, фоновые задачи, внешние сервисы (оплата, чеки, KeyCRM, бот, Нова Пошта) и ошибки в браузере
        покупателя. Одинаковые ошибки собраны в одну строку со счётчиком. О новой ошибке или всплеске (от {ERROR_SPIKE.count} раз за {ERROR_SPIKE.minutes} минут)
        приходит сообщение в Telegram — не чаще раза в час. Разобрались — нажмите «Закрыть»; если ошибка повторится, она вернётся сюда.
        Хранятся {ERROR_KEEP_DAYS} дней. Телефоны, имена, адреса покупателей и ключи сервисов в журнал не попадают.
      </p>
      {sp.ok && <p className="adm-flash ok" role="status">{sp.ok}</p>}

      <HealthCard link={false} />

      <nav className="adm-tabs" aria-label="Какие">
        {TABS.map(([k, l]) => <Link key={k} href={href({ tab: k === "open" ? "" : k })} aria-current={tab === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      <div className="adm-row" style={{ marginBottom: 10 }}>
        <span className="adm-muted">Откуда:</span>
        <Link className={source ? "adm-chip" : "adm-chip ok"} href={href({ source: "" })}>все</Link>
        {(Object.keys(ERROR_SOURCE_RU) as ErrorSource[]).map((k) => (
          <Link key={k} className={source === k ? "adm-chip ok" : "adm-chip"} href={href({ source: k })}>{ERROR_SOURCE_RU[k]}</Link>
        ))}
        {tab === "open" && rows.length > 0 && (
          <form action={closeAllErrorsAction} style={{ marginLeft: "auto" }}>
            <SubmitButton pendingText="Закрываю…">Закрыть все открытые</SubmitButton>
          </form>
        )}
      </div>

      {rows.length ? (
        <ul className="adm-errors">
          {rows.map((r) => (
            <li key={r.id} className="adm-card">
              <details>
                <summary>
                  <span className="adm-chip">{ERROR_SOURCE_RU[r.source as ErrorSource] ?? r.source}</span>{" "}
                  {r.where && <code className="adm-muted">{r.where}</code>}{" "}
                  <b className="adm-err-msg">{r.message}</b>
                  <div className="adm-muted" style={{ fontSize: 13, marginTop: 4 }}>
                    <span className={r.count >= ERROR_SPIKE.count ? "adm-chip warn" : "adm-chip"}>×{r.count}</span> последний раз {when(r.lastAt)}
                    {r.closedAt && <> · <span className="adm-chip ok">закрыта</span> {when(r.closedAt)}{r.closedBy ? ` (${r.closedBy})` : ""}</>}
                    {!r.closedAt && r.reopenedAt && <> · <span className="adm-chip bad">повторилась после закрытия</span></>}
                  </div>
                </summary>
                <dl className="adm-err-dl">
                  <dt>Впервые</dt><dd>{when(r.firstAt)}</dd>
                  {r.url && <><dt>Адрес</dt><dd><code>{r.url}</code></dd></>}
                  {r.digest && <><dt>Код ошибки</dt><dd><code>{r.digest}</code></dd></>}
                  {r.alertedAt && <><dt>Сообщение в Telegram</dt><dd>{when(r.alertedAt)}</dd></>}
                </dl>
                {r.stack && <pre className="adm-err-stack">{r.stack}</pre>}
              </details>
              <form action={r.closedAt ? reopenErrorAction : closeErrorAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton pendingText="…">{r.closedAt ? "Открыть снова" : "Закрыть"}</SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="adm-muted">{tab === "open" ? "Открытых ошибок нет. 👍" : "Ничего нет."}</p>
      )}
      {total > rows.length && <p className="adm-muted">Показаны последние {rows.length} из {total}.</p>}
    </>
  );
}
