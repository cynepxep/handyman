import { ORDER_STATUSES } from "@handyman/db/orders";
import { listTemplates } from "@handyman/db/messages";
import { ORDER_STATUS_RU, TEMPLATE_VARS, renderTemplate } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { deleteTemplateAction, saveTemplateAction } from "./actions";

export const dynamic = "force-dynamic";

type Tpl = { id: string; status: string; titleRu: string; titleUk: string; textUk: string; textRu: string; autoSend: boolean };

const SAMPLE = { name: "Іван", no: "HM-1024", ttn: "20450000000000", sum: 1250, due: 1050 };

function TemplateFields({ t }: { t?: Tpl }) {
  const p = t?.id ?? "new";
  return (
    <>
      <div className="adm-grid2">
        <div className="adm-field">
          <label htmlFor={`st-${p}`}>Статус заказа</label>
          <select id={`st-${p}`} name="status" className="adm-select" defaultValue={t?.status ?? "NEW"}>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_RU[s]}</option>)}
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor={`tt-${p}`}>Название (видят сотрудники)</label>
          <input id={`tt-${p}`} name="titleRu" className="adm-input wide" defaultValue={t?.titleRu ?? ""} maxLength={80} required />
        </div>
      </div>
      <div className="adm-grid2">
        <div className="adm-field">
          <label htmlFor={`uk-${p}`}>Текст українською</label>
          <textarea id={`uk-${p}`} name="textUk" className="adm-textarea" rows={3} defaultValue={t?.textUk ?? ""} maxLength={1500} required />
        </div>
        <div className="adm-field">
          <label htmlFor={`ru-${p}`}>Текст по-русски</label>
          <textarea id={`ru-${p}`} name="textRu" className="adm-textarea" rows={3} defaultValue={t?.textRu ?? ""} maxLength={1500} required />
        </div>
      </div>
      <input type="hidden" name="titleUk" value={t?.titleUk ?? ""} />
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 40 }}>
        <input type="checkbox" name="autoSend" defaultChecked={t?.autoSend ?? false} /> Отмечать заранее при смене статуса и отправлять автоматически, когда статус меняется сам (оплата, Нова Пошта)
      </label>
    </>
  );
}

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("templates.edit");
  const { ok, error } = await searchParams;
  const list = await listTemplates();

  return (
    <>
      <h1>Шаблоны сообщений</h1>
      <p className="adm-lead">
        Готовые сообщения покупателю для каждого статуса заказа. Когда менеджер меняет статус в карточке заказа, он видит шаблоны этого статуса с уже
        подставленными именем, номером и ТТН, отмечает нужные и отправляет. Покупатель получает сообщение на языке сайта, где оформил заказ.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      <div className="adm-help">
        <b>Подстановки</b> — вставьте в текст, и они заменятся данными заказа:
        <pre>{TEMPLATE_VARS.map((v) => `${v.key} — ${v.ru}`).join("\n")}</pre>
      </div>

      {ORDER_STATUSES.map((s) => {
        const items = list.filter((t) => t.status === s);
        return (
          <section key={s}>
            <h2>{ORDER_STATUS_RU[s]} <span className="adm-muted" style={{ fontWeight: 400, fontSize: 14 }}>· {items.length ? `шаблонов: ${items.length}` : "шаблонов нет"}</span></h2>
            {items.map((t) => (
              <details key={t.id} id={`t-${t.id}`} className="adm-group">
                <summary>
                  <span>{t.titleRu} {t.autoSend && <span className="adm-chip ok">авто</span>}</span>
                  <span className="adm-muted" style={{ fontWeight: 400, fontSize: 13, flex: "1 1 200px", textAlign: "right" }}>{renderTemplate(t.textUk, SAMPLE).slice(0, 90)}…</span>
                </summary>
                <div className="adm-group-body">
                  <form action={saveTemplateAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <TemplateFields t={t} />
                    <p className="adm-muted" style={{ fontSize: 13 }}>Как увидит покупатель: «{renderTemplate(t.textUk, SAMPLE)}»</p>
                    <div className="adm-row">
                      <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
                      <button type="submit" formAction={deleteTemplateAction} className="adm-btn adm-danger" formNoValidate>Удалить</button>
                    </div>
                  </form>
                </div>
              </details>
            ))}
          </section>
        );
      })}

      <section id="new" className="adm-card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Новый шаблон</h2>
        <form action={saveTemplateAction}>
          <TemplateFields />
          <div><SubmitButton primary pendingText="Добавляю…">Добавить шаблон</SubmitButton></div>
        </form>
      </section>
    </>
  );
}
