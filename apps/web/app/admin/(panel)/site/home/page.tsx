import Link from "next/link";
import { prisma } from "@handyman/db";
import { loadHomeSettings } from "@handyman/db/site-content";
import { topQueries } from "@handyman/db/search-stats";
import { HOME_BLOCK_RU } from "@handyman/core/site";
import { SubmitButton } from "../../import/client-bits";
import { saveHomeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomeSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [s, hits, news, found, missed] = await Promise.all([
    loadHomeSettings(),
    prisma.product.count({ where: { isHit: true, visible: true } }),
    prisma.product.count({ where: { isNew: true, visible: true } }),
    topQueries({ found: true, limit: 20 }),
    topQueries({ found: false, limit: 15 }),
  ]);
  const hidden = new Set(s.hints.hidden);
  const note: Partial<Record<string, React.ReactNode>> = {
    hits: <>отмечено: <b>{hits}</b> — <Link className="adm-link" href="/admin/products?flag=hit">список</Link></>,
    new: <>отмечено: <b>{news}</b> — <Link className="adm-link" href="/admin/products?flag=new">список</Link></>,
    banner: <>баннеры места «Главная» — в <Link className="adm-link" href="/admin/banners">«Реклама и баннеры»</Link></>,
  };

  return (
    <>
      <h1>Главная страница</h1>
      <p className="adm-lead">
        Какие блоки показывать на главной и в каком порядке (меньший номер — выше). Шапка с поиском всегда первая. Пустой блок (например, хитов ещё нет)
        на сайте не показывается. «Хит» и «Новинка» отмечаются в карточке товара или галочками в списке товаров. Заголовки блоков — во вкладке «Тексты»
        (группа «Главная страница») или прямо на сайте.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <form action={saveHomeAction} className="adm-card">
        <h2 style={{ marginTop: 0 }}>Блоки</h2>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th style={{ width: 90 }}>Порядок</th><th style={{ width: 90 }}>Показывать</th><th>Блок</th></tr></thead>
            <tbody>
              {s.blocks.map((bl, i) => (
                <tr key={bl.id}>
                  <td><input name={`order.${bl.id}`} defaultValue={String(i + 1)} inputMode="numeric" className="adm-input" style={{ width: 64 }} aria-label={`Порядок: ${HOME_BLOCK_RU[bl.id]}`} /></td>
                  <td><input type="checkbox" name={`on.${bl.id}`} defaultChecked={bl.on} aria-label={`Показывать: ${HOME_BLOCK_RU[bl.id]}`} /></td>
                  <td>{HOME_BLOCK_RU[bl.id]}{note[bl.id] && <div className="adm-muted">{note[bl.id]}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Баннер акции</h2>
        <p className="adm-muted">
          Баннеры теперь в отдельном разделе <Link className="adm-link" href="/admin/banners">«Реклама и баннеры»</Link>: там можно сделать несколько,
          включать и выключать, задать даты и показывать их не только на главной, но и между товарами и на странице товара. Здесь — только место
          блока на главной (строка «Баннер акции» в таблице выше).
        </p>

        <h2>Подсказки поиска («круг 125», «болгарка»…)</h2>
        <p className="adm-muted">
          Показываются под заголовком главной и в строке поиска («Часто шукають»). Порядок: сначала ваши (текст «home.hints» во вкладке «Тексты», через запятую),
          потом то, что чаще всего ищут покупатели за 30 дней (только запросы, которые находят товары), потом подразделы, из которых больше всего заказывают.
          Телефоны, почту, ссылки и артикулы сайт не запоминает; ваши собственные поиски (когда вы вошли в админку) не считаются.
        </p>
        <div className="adm-field">
          <label htmlFor="h-max">Сколько подсказок показывать (0 — не показывать)</label>
          <input id="h-max" name="hints.max" defaultValue={String(s.hints.max)} inputMode="numeric" className="adm-input" style={{ width: 80 }} />
        </div>
        <h3>Что ищут покупатели (30 дней)</h3>
        {found.length ? (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Запрос</th><th className="num">Раз</th><th className="num">Нашлось товаров</th><th>Скрыть из подсказок</th></tr></thead>
              <tbody>
                {found.map((q, i) => (
                  <tr key={q.query}>
                    <td>{q.query}</td><td className="num">{q.count}</td><td className="num">{q.results}</td>
                    <td><input type="checkbox" name={`hide.${i}`} value={q.query} defaultChecked={hidden.has(q.query)} aria-label={`Скрыть «${q.query}»`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="adm-muted">Пока пусто — статистика появится, когда покупатели начнут искать на сайте.</p>}
        {missed.length > 0 && (
          <>
            <h3>Искали, но не нашли</h3>
            <p className="adm-muted">Подсказка, каких товаров или слов не хватает (можно добавить товар или синоним): {missed.map((q) => `«${q.query}» (${q.count})`).join(", ")}.</p>
          </>
        )}
        <div className="adm-field">
          <label htmlFor="h-hidden">Скрытые слова (по одному в строке)</label>
          <textarea id="h-hidden" name="hints.hidden" rows={3} className="adm-textarea" defaultValue={s.hints.hidden.filter((h) => !found.some((q) => q.query === h)).join("\n")} />
          <span className="adm-muted">Эти запросы никогда не попадут в подсказки. Галочки в таблице выше добавляются сюда же.</span>
        </div>

        <div className="adm-sticky-save">
          <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
        </div>
      </form>
    </>
  );
}
