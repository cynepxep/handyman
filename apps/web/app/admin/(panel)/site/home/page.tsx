import Link from "next/link";
import { prisma } from "@handyman/db";
import { loadHomeSettings } from "@handyman/db/site-content";
import { HOME_BLOCK_RU } from "@handyman/core/site";
import { SubmitButton } from "../../import/client-bits";
import { saveHomeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomeSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [s, hits, news] = await Promise.all([
    loadHomeSettings(),
    prisma.product.count({ where: { isHit: true, visible: true } }),
    prisma.product.count({ where: { isNew: true, visible: true } }),
  ]);
  const b = s.banner;
  const note: Partial<Record<string, React.ReactNode>> = {
    hits: <>отмечено: <b>{hits}</b> — <Link className="adm-link" href="/admin/products?flag=hit">список</Link></>,
    new: <>отмечено: <b>{news}</b> — <Link className="adm-link" href="/admin/products?flag=new">список</Link></>,
    banner: b.on ? "включён" : "выключен — заполните ниже",
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
        <label className="adm-row"><input type="checkbox" name="banner.on" defaultChecked={b.on} /> Показывать баннер</label>
        <div className="adm-grid2">
          <div className="adm-field"><label htmlFor="b-tu">Заголовок (українською)</label><input id="b-tu" name="banner.titleUk" defaultValue={b.titleUk} className="adm-input wide" maxLength={120} placeholder="Знижки на диски до −20%" /></div>
          <div className="adm-field"><label htmlFor="b-tr">Заголовок (по-русски)</label><input id="b-tr" name="banner.titleRu" defaultValue={b.titleRu} className="adm-input wide" maxLength={120} placeholder="Скидки на диски до −20%" /></div>
          <div className="adm-field"><label htmlFor="b-xu">Текст (українською)</label><textarea id="b-xu" name="banner.textUk" defaultValue={b.textUk} rows={2} className="adm-textarea" maxLength={300} /></div>
          <div className="adm-field"><label htmlFor="b-xr">Текст (по-русски)</label><textarea id="b-xr" name="banner.textRu" defaultValue={b.textRu} rows={2} className="adm-textarea" maxLength={300} /></div>
          <div className="adm-field"><label htmlFor="b-bu">Надпись на кнопке (українською)</label><input id="b-bu" name="banner.buttonUk" defaultValue={b.buttonUk} className="adm-input wide" maxLength={40} placeholder="Дивитися" /></div>
          <div className="adm-field"><label htmlFor="b-br">Надпись на кнопке (по-русски)</label><input id="b-br" name="banner.buttonRu" defaultValue={b.buttonRu} className="adm-input wide" maxLength={40} placeholder="Смотреть" /></div>
        </div>
        <div className="adm-field">
          <label htmlFor="b-href">Куда ведёт кнопка</label>
          <input id="b-href" name="banner.href" defaultValue={b.href} className="adm-input wide" placeholder="/catalog/dysky-ta-kruhy или /search?sale=1" />
          <span className="adm-muted">Страница нашего сайта — адрес без домена, начиная с «/» (скопируйте из адресной строки часть после :3100). Чужой сайт — полностью, с https://.</span>
        </div>
        <div className="adm-field">
          <label htmlFor="b-img">Картинка (ссылка, необязательно)</label>
          <input id="b-img" name="banner.image" defaultValue={b.image} className="adm-input wide" placeholder="https://…/banner.jpg" inputMode="url" />
          <span className="adm-muted">Полный адрес картинки с https://. Лучше широкая (примерно 1200×600). Без картинки баннер — тёмная плашка с жёлтым заголовком.</span>
        </div>
        {b.image && (
          // eslint-disable-next-line @next/next/no-img-element -- предпросмотр картинки по ссылке владельца
          <img src={b.image} alt="Картинка баннера" style={{ maxWidth: 360, maxHeight: 180, objectFit: "cover", borderRadius: 8 }} />
        )}

        <div className="adm-sticky-save">
          <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
        </div>
      </form>
    </>
  );
}
