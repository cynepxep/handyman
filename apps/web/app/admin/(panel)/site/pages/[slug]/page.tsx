import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageBySlug, loadContacts, STANDARD_PAGES } from "@handyman/db/site-content";
import { loadCheckoutSettings } from "@handyman/db/orders";
import { deliveryPageDraft, renderPageBody } from "@handyman/core/site";
import { DraftButton } from "../draft-button";
import { SubmitButton } from "../../../import/client-bits";
import { deletePageAction, savePageAction } from "../actions";

export const dynamic = "force-dynamic";

const CHEAT = `## Заголовок раздела

Обычный абзац. Чтобы начать новый — оставьте пустую строку.

- пункт списка
- ещё пункт

1. первый шаг
2. второй шаг

Слово **жирным**, [ссылка](https://example.com), звонок [+380 48 123 45 67](tel:+380481234567).`;

export default async function EditPagePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { slug } = await params;
  const { ok, error } = await searchParams;
  const p = await getPageBySlug(slug);
  if (!p) notFound();
  const standard = (STANDARD_PAGES as readonly string[]).includes(p.slug);
  // для «Доставка і оплата» — черновик из настроек оформления и контактов
  const draft = p.slug === "delivery" ? deliveryPageDraft(...(await Promise.all([loadCheckoutSettings(), loadContacts()]))) : null;

  return (
    <>
      <p><Link className="adm-link" href="/admin/site/pages">← Все страницы</Link></p>
      <h1>{p.titleUk}</h1>
      <p className="adm-lead">Адрес: <code>/{p.slug}</code>{standard ? " · стандартная страница (её можно скрыть, но не удалить)" : ""}</p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <details className="adm-help">
        <summary><b>Как оформлять текст</b></summary>
        <p className="adm-muted" style={{ margin: "6px 0 0" }}>Кнопок форматирования нет — всё делается простыми знаками. Скопируйте образец и замените слова:</p>
        <pre>{CHEAT}</pre>
      </details>

      {draft && <DraftButton uk={draft.uk} ru={draft.ru} />}

      <form action={savePageAction} className="adm-card">
        <input type="hidden" name="slug" value={p.slug} />
        <div className="adm-grid2">
          <div className="adm-field"><label htmlFor="titleUk">Название (українською)</label><input id="titleUk" name="titleUk" defaultValue={p.titleUk} className="adm-input wide" required minLength={2} /></div>
          <div className="adm-field"><label htmlFor="titleRu">Название (по-русски)</label><input id="titleRu" name="titleRu" defaultValue={p.titleRu} className="adm-input wide" required minLength={2} /></div>
          <div className="adm-field"><label htmlFor="bodyUk">Текст (українською)</label><textarea id="bodyUk" name="bodyUk" defaultValue={p.bodyUk} rows={16} className="adm-textarea" /></div>
          <div className="adm-field"><label htmlFor="bodyRu">Текст (по-русски)</label><textarea id="bodyRu" name="bodyRu" defaultValue={p.bodyRu} rows={16} className="adm-textarea" /></div>
        </div>
        <div className="adm-row" style={{ margin: "8px 0" }}>
          <label className="adm-row"><input type="checkbox" name="visible" defaultChecked={p.visible} /> Показывать на сайте</label>
          <label className="adm-row"><input type="checkbox" name="inMenu" defaultChecked={p.inMenu} /> Ссылка в меню и подвале</label>
          <label className="adm-row">Порядок <input name="sort" defaultValue={p.sort} inputMode="numeric" className="adm-input" style={{ width: 80 }} aria-label="Порядок в меню" /></label>
        </div>
        <div className="adm-sticky-save">
          <SubmitButton primary pendingText="Сохраняю…">Сохранить страницу</SubmitButton>
          <span className="adm-muted">«Порядок»: чем меньше число, тем левее ссылка.</span>
        </div>
      </form>

      <h2>Как это выглядит сейчас (сохранённый текст, украинский)</h2>
      <div className="adm-card adm-preview" dangerouslySetInnerHTML={{ __html: renderPageBody(p.bodyUk) || "<p class=\"adm-muted\">Текст пока пустой.</p>" }} />

      {!standard && (
        <form action={deletePageAction} className="adm-card">
          <input type="hidden" name="slug" value={p.slug} />
          <p className="adm-muted">Удалить страницу насовсем? Это нельзя отменить.</p>
          <button type="submit" className="adm-btn adm-danger">Удалить страницу</button>
        </form>
      )}
    </>
  );
}
