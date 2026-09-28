// «Интеграции → KeyCRM» (шаг 3.5, только владелец): переключатель «Передавать заказы в KeyCRM» (по умолчанию выключен — старый магазин
// тоже шлёт заказы в KeyCRM), таблица соответствия статусов KeyCRM → статусы сайта, адрес вебхука, последние вебхуки.
import Link from "next/link";
import { KEYCRM_OUR_STATUSES, ORDER_STATUS_RU, guessOurStatus } from "@handyman/core/shop";
import { maskSecret } from "@handyman/core/integrations";
import { keycrmOverview } from "@handyman/db/keycrm";
import { requireOwner } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { CopyButton } from "../../orders/[id]/status-form";
import { refreshKeycrmStatusesAction, saveKeycrmStatusMapAction, setKeycrmEnabledAction } from "./actions";

export const dynamic = "force-dynamic";

const when = (d: Date | string) => new Date(d).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const MODE_RU = {
  live: <span className="adm-chip ok">API-ключ задан</span>,
  stub: <span className="adm-chip warn">заглушка: ключа нет (на этом компьютере — тестовые номера)</span>,
  off: <span className="adm-chip bad">не подключён: нет API-ключа</span>,
};

export default async function KeycrmPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const k = await keycrmOverview();
  const { settings: s } = k;
  const hookUrl = (base: string, secret: string) => `${base || "https://<адрес сайта>/api/keycrm/webhook"}?secret=${secret}`;

  return (
    <>
      <p><Link className="adm-link" href="/admin/integrations#keycrm">← Интеграции</Link></p>
      <h1>KeyCRM</h1>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok" role="status">{sp.ok}</p>}

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Передача заказов</h2>
        <p style={{ margin: "4px 0" }}>
          {MODE_RU[k.mode]}{" "}
          {k.mode === "live" && !k.hasSource && <span className="adm-chip bad">не указан источник заказа (ID)</span>}
        </p>
        <p className="adm-muted" style={{ margin: "4px 0 10px" }}>
          Новый заказ с сайта, «Купити в 1 клік» и «Заказ по звонку» сам уходит в KeyCRM: покупатель, телефон, товары (цена со скидкой), доставка,
          комментарий, источник. Номер KeyCRM видно в заказе. Не получилось — сайт повторяет сам. <b>Тестовые заказы сами не уходят никогда</b> —
          только кнопкой в заказе, с пометкой «ТЕСТ — не обрабатывать». По умолчанию передача выключена: старый магазин тоже отправляет заказы в
          KeyCRM — включайте, когда новый сайт его заменит (иначе будут дубли).
        </p>
        <form action={setKeycrmEnabledAction} className="adm-row">
          <label className="adm-check"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Передавать заказы в KeyCRM</label>
          <SubmitButton primary pendingText="…">Сохранить</SubmitButton>
        </form>
        <p className="adm-muted" style={{ margin: "10px 0 0" }}>
          Сейчас: передано {k.byState.sent ?? 0}
          {k.byState.queued || k.byState.sending ? ` · ждут отправки ${(k.byState.queued ?? 0) + (k.byState.sending ?? 0)}` : ""}
          {k.byState.error ? <> · <span className="adm-bad">с ошибкой {k.byState.error}</span> (в заказе — причина и кнопка «Отправить ещё раз»)</> : ""}.
        </p>
      </section>

      <section className="adm-card" id="statuses">
        <h2 style={{ marginTop: 0 }}>Статусы: KeyCRM → сайт</h2>
        <p className="adm-muted" style={{ margin: "4px 0 10px" }}>
          Когда менеджер меняет статус заказа в KeyCRM, на сайте ставится статус из этой таблицы (со складом и историей — как при смене в админке).
          «Не менять» — статус на сайте остаётся прежним. Если у статуса сайта есть шаблон «отправлять автоматически» (раздел «Шаблоны»), покупатель
          получит сообщение сам; если нет — менеджер увидит в заказе напоминание «напишите покупателю».
        </p>
        <form action={refreshKeycrmStatusesAction} className="adm-row" style={{ marginBottom: 10 }}>
          <SubmitButton pendingText="Загружаю…">{s.statuses.length ? "Обновить список статусов из KeyCRM" : "Загрузить статусы из KeyCRM"}</SubmitButton>
          {s.statusesAt && <span className="adm-muted">загружено {when(s.statusesAt)}{k.mode === "stub" ? " (примерный список — KeyCRM не подключён)" : ""}</span>}
        </form>
        {s.statuses.length > 0 && (
          <form action={saveKeycrmStatusMapAction}>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>Статус в KeyCRM</th><th>Статус на сайте</th></tr></thead>
                <tbody>
                  {s.statuses.map((st) => {
                    const saved = Object.hasOwn(s.statusMap, String(st.id));
                    const value = saved ? s.statusMap[String(st.id)] : guessOurStatus(st.name, st.alias);
                    return (
                      <tr key={st.id}>
                        <td>{st.name} <span className="adm-muted">(№ {st.id})</span></td>
                        <td>
                          <select name={`st_${st.id}`} defaultValue={value} className="adm-select" aria-label={`Статус сайта для «${st.name}»`}>
                            <option value="">— не менять</option>
                            {KEYCRM_OUR_STATUSES.map((o) => <option key={o} value={o}>{ORDER_STATUS_RU[o]}</option>)}
                          </select>
                          {!saved && value && <span className="adm-muted"> подсказка — проверьте</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="adm-row" style={{ marginTop: 10 }}><SubmitButton primary pendingText="…">Сохранить таблицу</SubmitButton></div>
          </form>
        )}
      </section>

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Вебхук: KeyCRM сообщает о смене статуса</h2>
        {k.webhookSecret ? (
          <>
            <p style={{ margin: "4px 0" }}>Адрес для KeyCRM (секрет вебхука — из раздела «Интеграции»):</p>
            <p className="adm-row" style={{ margin: "4px 0" }}>
              <code style={{ wordBreak: "break-all" }}>{hookUrl(k.webhookBase.startsWith("/") ? "" : k.webhookBase, maskSecret(k.webhookSecret))}</code>
              {!k.webhookBase.startsWith("/") && <CopyButton text={hookUrl(k.webhookBase, k.webhookSecret)} />}
            </p>
          </>
        ) : (
          <p className="adm-flash warn" style={{ margin: "4px 0" }}>
            {k.weakSecret ? "Секрет вебхука сейчас слишком простой (например, шаблон «change-me-too» из файла .env) — такой сайт не принимает. " : ""}
            Задайте свой «Секрет вебхука» в <Link className="adm-link" href="/admin/integrations#keycrm">«Интеграциях»</Link> (от 16 латинских букв и цифр) — без
            него сайт вебхуки не принимает.
          </p>
        )}
        <p className="adm-muted" style={{ margin: "8px 0 0" }}>
          В KeyCRM: автоматизация (триггер) с событием «Замовлення → Зміна статусу» и действием «Відправити вебхук», метод POST, адрес — выше
          (названия пунктов — по справке KeyCRM, могут немного отличаться). Пока у сайта нет адреса в интернете (https, Этап 8), KeyCRM до него
          не достучится — поэтому сайт сам спрашивает KeyCRM о статусе открытых заказов раз в 10 минут.
        </p>
        {k.hooks.length > 0 && (
          <>
            <h3>Последние вебхуки</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {k.hooks.map((h) => {
                const b = h.body as { id?: number; status_id?: number; source_uuid?: string };
                return <li key={h.id}><span className="adm-muted">{when(h.ts)}</span> — заказ KeyCRM № {b.id ?? "?"}{b.source_uuid ? ` (${b.source_uuid})` : ""}, статус № {b.status_id ?? "?"}</li>;
              })}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
