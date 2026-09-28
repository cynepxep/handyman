// «Интеграции» (шаг 3.1): ключи внешних сервисов — только владелец. Ключи хранятся в базе зашифрованными и показываются маской;
// пустое поле при сохранении — «оставить как было». Без ключа сервис работает заглушкой (так было и раньше).
import { integrationsOverview, secretsKeySource, type FieldState } from "@handyman/db/integrations";
import { requireOwner } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { checkIntegrationAction, clearIntegrationAction, saveIntegrationAction } from "./actions";

export const dynamic = "force-dynamic";

const when = (d: Date | string) => new Date(d).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });

function FieldNow({ f }: { f: FieldState }) {
  if (f.source === "db") return <span className="adm-muted">сейчас: <code>{f.shown}</code> · сохранено {f.updatedBy}, {when(f.updatedAt!)}</span>;
  if (f.source === "env") return <span className="adm-muted">сейчас: <code>{f.shown}</code> · из файла .env ({f.env})</span>;
  if (f.source === "broken") return <span className="adm-chip bad">не читается (сменился ключ шифрования) — введите заново</span>;
  return <span className="adm-muted">не задано</span>;
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; s?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const list = await integrationsOverview();

  return (
    <>
      <h1>Интеграции</h1>
      <p className="adm-lead">
        Ключи внешних сервисов. Видит и меняет только владелец. Ключи хранятся в базе в зашифрованном виде и показываются маской (последние
        4 знака — чтобы узнать, тот ли ключ). Пока ключа нет, сервис работает «заглушкой» — магазин не ломается. Чтобы задать или заменить ключ, впишите
        его и нажмите «Сохранить» (или «Проверить подключение» — она тоже сначала сохраняет введённое); пустое поле оставляет прежнее значение.
      </p>

      {list.map((it) => (
        <section key={it.id} id={it.id} className="adm-card">
          <h2 style={{ marginTop: 0, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {it.title}
            {it.configured ? <span className="adm-chip ok">ключ задан</span> : <span className="adm-chip warn">заглушка</span>}
          </h2>
          <p style={{ margin: "4px 0" }}>{it.what}</p>
          {!it.configured && <p className="adm-muted" style={{ margin: "4px 0" }}>Без ключа: {it.stub.charAt(0).toLowerCase() + it.stub.slice(1)}</p>}
          {sp.s === it.id && sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
          {sp.s === it.id && sp.ok && <p className="adm-flash ok" role="status">{sp.ok}</p>}
          {it.check && !(sp.s === it.id && (sp.ok || sp.error)) && (
            <p style={{ margin: "6px 0" }}>
              <span className={it.check.ok ? "adm-chip ok" : "adm-chip bad"}>{it.check.ok ? "проверка прошла" : "проверка не прошла"}</span>{" "}
              {it.check.message} <small className="adm-muted">({when(it.check.at)}, {it.check.who})</small>
            </p>
          )}

          <form action={saveIntegrationAction} autoComplete="off">
            <input type="hidden" name="id" value={it.id} />
            {it.fields.map((f) => (
              <div key={f.key} className="adm-field">
                <label htmlFor={`${it.id}-${f.key}`}>{f.label}</label>
                <FieldNow f={f} />
                <input
                  id={`${it.id}-${f.key}`}
                  name={`f_${f.key}`}
                  className="adm-input wide"
                  type={f.secret ? "password" : "text"}
                  autoComplete={f.secret ? "new-password" : "off"}
                  spellCheck={false}
                  placeholder={f.source === "none" ? "вставьте значение" : "новое значение (пусто — оставить как есть)"}
                  maxLength={500}
                />
                {f.hint && <small className="adm-muted">{f.hint}</small>}
              </div>
            ))}
            <div className="adm-row">
              <SubmitButton primary pendingText="Сохраняю и проверяю…">Сохранить</SubmitButton>
              <SubmitButton formAction={checkIntegrationAction} pendingText="Проверяю…">Проверить подключение</SubmitButton>
            </div>
          </form>

          {it.fields.some((f) => f.source === "db" || f.source === "broken") && (
            <div className="adm-row" style={{ marginTop: 8 }}>
              {it.fields
                .filter((f) => f.source === "db" || f.source === "broken")
                .map((f) => (
                  <form key={f.key} action={clearIntegrationAction}>
                    <input type="hidden" name="id" value={it.id} />
                    <input type="hidden" name="field" value={f.key} />
                    <SubmitButton pendingText="…">Удалить из базы: {f.label.toLowerCase()}</SubmitButton>
                  </form>
                ))}
            </div>
          )}
        </section>
      ))}

      <p className="adm-muted" style={{ maxWidth: 760 }}>
        Ключ шифрования лежит не в базе, а в <code>{secretsKeySource()}</code>. Храните его вместе с резервной копией базы: без него сохранённые здесь
        ключи не прочитать (их придётся ввести заново). Значения из файла .env по-прежнему работают, если здесь поле пустое.
      </p>
    </>
  );
}
