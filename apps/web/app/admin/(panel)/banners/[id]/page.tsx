// Баннер: где показывать, текст (укр./рус.), кнопка и ссылка, картинка, цвет, сроки, разделы. /admin/banners/new — новый.
import Link from "next/link";
import { notFound } from "next/navigation";
import { BANNER_PLACEMENTS, BANNER_THEMES, DEFAULT_EVERY_N } from "@handyman/core/site";
import { getBanner } from "@handyman/db/banners";
import { loadMenuConfig } from "@handyman/db/site-content";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { saveBannerAction } from "../actions";

export const dynamic = "force-dynamic";

const ymd = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

function Field({ label, name, value = "", area, placeholder, max = 300 }: { label: string; name: string; value?: string; area?: boolean; placeholder?: string; max?: number }) {
  return (
    <div className="adm-field">
      <label htmlFor={`b-${name}`}>{label}</label>
      {area
        ? <textarea id={`b-${name}`} name={name} defaultValue={value} rows={2} className="adm-textarea" placeholder={placeholder} maxLength={max} />
        : <input id={`b-${name}`} name={name} defaultValue={value} className="adm-input wide" placeholder={placeholder} maxLength={max} />}
    </div>
  );
}

export default async function BannerEditPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; place?: string }>;
}) {
  await requirePermission("ads.edit");
  const { id } = await params;
  const { error, place } = await searchParams;
  const b = id === "new" ? null : await getBanner(id);
  if (id !== "new" && !b) notFound();
  const menu = await loadMenuConfig();
  const c = b?.content;

  return (
    <>
      <p><Link className="adm-link" href="/admin/banners">← Реклама и баннеры</Link></p>
      <h1>{b ? b.name : "Новый баннер"}</h1>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      <form action={saveBannerAction} className="adm-card">
        <input type="hidden" name="id" value={b?.id ?? ""} />
        <div className="adm-grid2">
          <div className="adm-field">
            <label htmlFor="b-placement">Где показывать</label>
            <select id="b-placement" name="placement" className="adm-select" defaultValue={b?.placement ?? place ?? "listing"}>
              {BANNER_PLACEMENTS.map((p) => <option key={p.key} value={p.key}>{p.ru}</option>)}
            </select>
          </div>
          <Field label="Название для себя (покупатели не видят)" name="name" value={b?.name} placeholder="Акция на диски, октябрь" max={80} />
        </div>
        <label className="adm-row" style={{ gap: 8, margin: "4px 0 12px" }}>
          <input type="checkbox" name="active" defaultChecked={b?.active ?? true} /> <b>Включён</b>
        </label>

        <h2>Текст</h2>
        <div className="adm-grid2">
          <Field label="Заголовок (українською)" name="titleUk" value={c?.titleUk} placeholder="Знижки на диски до −20%" max={120} />
          <Field label="Заголовок (по-русски)" name="titleRu" value={c?.titleRu} placeholder="Скидки на диски до −20%" max={120} />
          <Field label="Текст (українською), необязательно" name="textUk" value={c?.textUk} area />
          <Field label="Текст (по-русски)" name="textRu" value={c?.textRu} area />
          <Field label="Кнопка (українською), необязательно" name="buttonUk" value={c?.buttonUk} placeholder="Дивитись диски" max={40} />
          <Field label="Кнопка (по-русски)" name="buttonRu" value={c?.buttonRu} placeholder="Смотреть диски" max={40} />
        </div>
        <Field label="Куда ведёт: страница сайта «/…» или адрес https://" name="href" value={c?.href} placeholder="/catalog/dysky-ta-kruhy" />
        <p className="adm-muted">Если ссылка есть, нажимается весь баннер. Нажатия считаются.</p>
        <Field label="Картинка: адрес https:// (необязательно)" name="image" value={c?.image} placeholder="https://…/banner.jpg" />
        <div className="adm-field">
          <label htmlFor="b-theme">Цвет</label>
          <select id="b-theme" name="theme" className="adm-select" defaultValue={c?.theme ?? "light"}>
            {BANNER_THEMES.map((t) => <option key={t.key} value={t.key}>{t.ru}</option>)}
          </select>
        </div>

        <h2>Когда и где</h2>
        <div className="adm-grid2">
          <div className="adm-field">
            <label htmlFor="b-from">Показывать с (необязательно)</label>
            <input id="b-from" type="date" name="startsAt" defaultValue={ymd(b?.startsAt ?? null)} className="adm-input" />
          </div>
          <div className="adm-field">
            <label htmlFor="b-to">По (включительно)</label>
            <input id="b-to" type="date" name="endsAt" defaultValue={ymd(b?.endsAt ?? null)} className="adm-input" />
          </div>
          <div className="adm-field">
            <label htmlFor="b-every">Списки товаров: после каждых … товаров</label>
            <input id="b-every" name="everyN" inputMode="numeric" defaultValue={String(b?.settings.everyN ?? DEFAULT_EVERY_N)} className="adm-input" style={{ width: 100 }} />
          </div>
          <div className="adm-field">
            <label htmlFor="b-sort">Порядок (если баннеров несколько; меньше — раньше)</label>
            <input id="b-sort" name="sort" inputMode="numeric" defaultValue={String(b?.sort ?? 0)} className="adm-input" style={{ width: 100 }} />
          </div>
        </div>
        <fieldset className="adm-card" style={{ margin: "8px 0" }}>
          <legend><b>Только в разделах</b> (для списков и страницы товара; ничего не отмечено — везде)</legend>
          <div className="adm-row" style={{ flexWrap: "wrap", gap: "6px 16px" }}>
            {menu.groups.filter((g) => !g.hidden).map((g) => (
              <label key={g.id} className="adm-row" style={{ gap: 6 }}>
                <input type="checkbox" name="groups" value={g.id} defaultChecked={b?.settings.groups.includes(g.id) ?? false} /> {g.nameUk}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="adm-sticky-save">
          <SubmitButton primary pendingText="Сохраняю…">{b ? "Сохранить" : "Добавить баннер"}</SubmitButton>
        </div>
      </form>
    </>
  );
}
