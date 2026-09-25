import Link from "next/link";
import { loadTextOverrides } from "@handyman/db/site-content";
import { groupedEntries, textVars, toLang, type Lang } from "@handyman/core/site";
import { SubmitButton } from "../../import/client-bits";
import { saveTextsAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { q?: string; group?: string; ok?: string; error?: string };

export default async function TextsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { q = "", group = "", ok, error } = await searchParams;
  const overrides = await loadTextOverrides();
  const custom = new Map(overrides.map((o) => [`${o.key}|${toLang(o.lang)}`, o.value]));
  const needle = q.trim().toLowerCase();
  // поиск по словам: «без зайвих питань» найдёт «без зайвих запитань» (каждое слово — часть текста, порядок не важен)
  const norm = (x: string) => x.toLowerCase().replace(/[’'ʼ`]/g, "'").replace(/ё/g, "е");
  const words = norm(needle).split(/[\s,.!?;:«»"()]+/).filter(Boolean);

  const groups = groupedEntries()
    .map((g) => ({
      group: g.group,
      entries: needle
        ? g.entries.filter((e) => {
            const hay = norm([e.key, e.hint ?? "", e.uk, e.ru, custom.get(`${e.key}|uk`) ?? "", custom.get(`${e.key}|ru`) ?? ""].join(" "));
            return words.every((w) => hay.includes(w));
          })
        : g.entries,
    }))
    .filter((g) => g.entries.length > 0);

  const changedIn = (entries: { key: string }[]) => entries.filter((e) => custom.has(`${e.key}|uk`) || custom.has(`${e.key}|ru`)).length;
  const langs: Array<{ lang: Lang; label: string }> = [{ lang: "uk", label: "Українська" }, { lang: "ru", label: "Русская" }];

  return (
    <>
      <h1>Тексты сайта</h1>
      <p className="adm-lead">
        Здесь можно поменять любую надпись на сайте: заголовки, кнопки, подсказки, пояснения про доставку и оплату. Слева написано, где виден текст;
        справа — два поля, по-украински и по-русски. Слова в фигурных скобках, например <b>{"{n}"}</b>, сайт заменяет числом или названием — их
        оставляйте. Кнопка <b>↺</b> возвращает стандартный текст. Контакты, график работы и адрес — на вкладке «Контакты и график», а длинные
        тексты (доставка, оферта) — на вкладке «Страницы».
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <form method="get" className="adm-row" role="search">
        <input name="q" defaultValue={q} className="adm-input" style={{ flex: "1 1 260px" }} placeholder="Найти текст: например, «кошик» или «доставка»" aria-label="Поиск по текстам" />
        <button type="submit" className="adm-btn">Найти</button>
        {(q || group) && <Link className="adm-btn" href="/admin/site/texts">Показать все</Link>}
      </form>
      {needle && <p className="adm-muted">Найдено в группах: {groups.length}.</p>}

      {groups.map((g) => {
        const n = changedIn(g.entries);
        return (
          <details key={g.group} className="adm-group" open={Boolean(needle) || g.group === group || (!group && !needle && g.group === "Главная страница")}>
            <summary>
              <span>{g.group} <span className="adm-muted">· {g.entries.length}</span></span>
              {n > 0 && <span className="adm-chip warn">изменено вами: {n}</span>}
            </summary>
            <form action={saveTextsAction} className="adm-group-body">
              <input type="hidden" name="group" value={g.group} />
              {g.entries.map((e) => {
                const vars = textVars(e);
                return (
                  <div key={e.key} className="adm-text-row">
                    <div className="adm-text-key">
                      <b>{e.hint ?? e.uk}</b>
                      <div><code>{e.key}</code>{vars.length > 0 && <> · <span className="adm-muted">оставьте: {vars.map((v) => `{${v}}`).join(" ")}</span></>}</div>
                    </div>
                    {langs.map(({ lang, label }) => {
                      const value = custom.get(`${e.key}|${lang}`) ?? e[lang];
                      return (
                        <div key={lang} className="adm-text-cell">
                          <label htmlFor={`${lang}:${e.key}`}>{label}{custom.has(`${e.key}|${lang}`) && <span className="adm-chip warn" style={{ marginLeft: 6 }}>изменён</span>}</label>
                          <textarea id={`${lang}:${e.key}`} name={`${lang}:${e.key}`} defaultValue={value} rows={value.length > 70 ? 3 : 1} maxLength={600} className="adm-textarea" />
                          {custom.has(`${e.key}|${lang}`) && (
                            <button type="submit" name="reset" value={`${e.key}|${lang}`} className="adm-btn" style={{ marginTop: 4, minHeight: 32, padding: "3px 10px" }} title="Вернуть стандартный текст">↺ Вернуть стандартный</button>
                          )}
                        </div>
                      );
                    })}
                    <span />
                  </div>
                );
              })}
              <div className="adm-sticky-save">
                <SubmitButton primary pendingText="Сохраняю…">Сохранить группу «{g.group}»</SubmitButton>
                <span className="adm-muted">Сохраняются все поля этой группы.</span>
              </div>
            </form>
          </details>
        );
      })}
      {groups.length === 0 && <p className="adm-muted">Ничего не найдено. Попробуйте другое слово.</p>}
    </>
  );
}
