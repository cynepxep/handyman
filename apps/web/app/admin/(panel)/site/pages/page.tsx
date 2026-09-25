import Link from "next/link";
import { listPages, STANDARD_PAGES } from "@handyman/db/site-content";
import { hasFillMarker } from "@handyman/core/site";
import { SubmitButton } from "../../import/client-bits";
import { createPageAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PagesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const pages = await listPages();

  return (
    <>
      <h1>Страницы сайта</h1>
      <p className="adm-lead">
        Длинные тексты: «Доставка і оплата», «Про магазин», «Контакти», оферта. Откройте страницу, чтобы поменять заголовок и текст на двух
        языках. Юридические тексты (оферту, возврат) пишите сами или с юристом — здесь только удобное место, где их хранить и менять.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr><th>Страница</th><th>Адрес</th><th>Состояние</th><th className="num">Порядок</th></tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.slug}>
                <td><Link className="adm-link" href={`/admin/site/pages/${p.slug}`}>{p.titleUk}</Link><div className="adm-muted">{p.titleRu}</div></td>
                <td><code>/{p.slug}</code></td>
                <td>
                  {!p.visible && <span className="adm-chip warn">скрыта</span>}{" "}
                  {p.visible && p.inMenu && <span className="adm-chip ok">в меню</span>}{" "}
                  {p.visible && !p.inMenu && <span className="adm-chip">не в меню</span>}{" "}
                  {(STANDARD_PAGES as readonly string[]).includes(p.slug) && <span className="adm-chip">стандартная</span>}{" "}
                  {(!p.bodyUk.trim() || hasFillMarker(p.bodyUk) || hasFillMarker(p.bodyRu)) && <span className="adm-chip bad">нужно заполнить</span>}
                </td>
                <td className="num">{p.sort}</td>
              </tr>
            ))}
            {pages.length === 0 && <tr><td colSpan={4} className="adm-muted">Страниц пока нет.</td></tr>}
          </tbody>
        </table>
      </div>

      <form action={createPageAction} className="adm-card">
        <h2 style={{ marginTop: 0 }}>Новая страница</h2>
        <div className="adm-grid2">
          <div className="adm-field"><label htmlFor="n-titleUk">Название (українською)</label><input id="n-titleUk" name="titleUk" className="adm-input wide" required minLength={2} placeholder="Гарантія та повернення" /></div>
          <div className="adm-field"><label htmlFor="n-titleRu">Название (по-русски)</label><input id="n-titleRu" name="titleRu" className="adm-input wide" required minLength={2} placeholder="Гарантия и возврат" /></div>
        </div>
        <div className="adm-field">
          <label htmlFor="n-slug">Адрес страницы (латиницей)</label>
          <input id="n-slug" name="slug" className="adm-input" required pattern="[a-z0-9\-]{2,40}" placeholder="warranty" />
          <span className="adm-muted">Только латинские буквы, цифры и дефис. Получится адрес сайта/warranty.</span>
        </div>
        <input type="hidden" name="bodyUk" value="" />
        <input type="hidden" name="bodyRu" value="" />
        <SubmitButton primary pendingText="Создаю…">Создать и перейти к тексту</SubmitButton>
      </form>
    </>
  );
}
