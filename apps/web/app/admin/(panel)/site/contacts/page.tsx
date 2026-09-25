import { loadContacts } from "@handyman/db/site-content";
import { LINK_FIELDS, isContactsEmpty } from "@handyman/core/site";
import { SubmitButton } from "../../import/client-bits";
import { saveContactsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const c = await loadContacts();

  return (
    <>
      <h1>Контакты и график работы</h1>
      <p className="adm-lead">
        Эти данные показываются в шапке, подвале, на странице «Контакты» и в кнопках «Написать» / «Позвонить». Пока поле пустое, на сайте
        вместо него написано «Уточнюється» — ничего не выдумываем. Ссылки на соцсети пишите полностью, начиная с https://.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      {isContactsEmpty(c) && <p className="adm-flash err" style={{ borderColor: "var(--adm-warn)", color: "var(--adm-warn)" }}>Контакты ещё не заполнены — на сайте сейчас «Уточнюється».</p>}

      <form action={saveContactsAction} className="adm-card">
        <h2 style={{ marginTop: 0 }}>Телефон и почта</h2>
        <div className="adm-field">
          <label htmlFor="phones">Телефоны (каждый с новой строки, не больше пяти)</label>
          <textarea id="phones" name="phones" defaultValue={c.phones.join("\n")} rows={3} className="adm-textarea" placeholder={"+380 48 123 45 67\n+380 67 123 45 67"} />
          <span className="adm-muted">Первый телефон показывается в шапке и в кнопке «Подзвонити».</span>
        </div>
        <div className="adm-field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" defaultValue={c.email} className="adm-input wide" placeholder="shop@example.com" />
        </div>

        <h2>Адрес</h2>
        <div className="adm-grid2">
          <div className="adm-field"><label htmlFor="addressUk">Адрес (українською)</label><input id="addressUk" name="addressUk" defaultValue={c.addressUk} className="adm-input wide" placeholder="Одеса, вул. …, 1" /></div>
          <div className="adm-field"><label htmlFor="addressRu">Адрес (по-русски)</label><input id="addressRu" name="addressRu" defaultValue={c.addressRu} className="adm-input wide" placeholder="Одесса, ул. …, 1" /></div>
          <div className="adm-field"><label htmlFor="howToUk">Як дістатися (українською)</label><textarea id="howToUk" name="howToUk" defaultValue={c.howToUk} rows={2} className="adm-textarea" placeholder="Наприклад: навпроти ринку, вхід з двору" /></div>
          <div className="adm-field"><label htmlFor="howToRu">Как добраться (по-русски)</label><textarea id="howToRu" name="howToRu" defaultValue={c.howToRu} rows={2} className="adm-textarea" placeholder="Например: напротив рынка, вход со двора" /></div>
        </div>

        <h2>График работы</h2>
        <div className="adm-grid2">
          <div className="adm-field"><label htmlFor="hoursUk">Графік (українською)</label><textarea id="hoursUk" name="hoursUk" defaultValue={c.hoursUk} rows={2} className="adm-textarea" placeholder="Пн–Сб 9:00–18:00, Нд — вихідний" /></div>
          <div className="adm-field"><label htmlFor="hoursRu">График (по-русски)</label><textarea id="hoursRu" name="hoursRu" defaultValue={c.hoursRu} rows={2} className="adm-textarea" placeholder="Пн–Сб 9:00–18:00, Вс — выходной" /></div>
        </div>

        <h2>Мессенджеры и соцсети</h2>
        <div className="adm-grid2">
          {LINK_FIELDS.map((f) => (
            <div key={f.key} className="adm-field">
              <label htmlFor={f.key}>{f.label}</label>
              <input id={f.key} name={f.key} defaultValue={c[f.key]} className="adm-input wide" placeholder={f.hint} inputMode="url" />
            </div>
          ))}
        </div>

        <div className="adm-sticky-save">
          <SubmitButton primary pendingText="Сохраняю…">Сохранить контакты</SubmitButton>
        </div>
      </form>
    </>
  );
}
