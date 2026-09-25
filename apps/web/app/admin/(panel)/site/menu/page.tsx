import { prisma } from "@handyman/db";
import { hasCustomMenu, loadMenuConfig } from "@handyman/db/site-content";
import { TASK_ICONS, lostCategories, type CatNode, type MenuGroup, type MenuSub } from "@handyman/core/catalog";
import { loadCategories } from "@/lib/catalog";
import { SubmitButton } from "../../import/client-bits";
import {
  addGroupAction, addSubAction, addTaskAction, assignLostAction, removeGroupAction, removeSubAction, removeTaskAction,
  resetMenuAction, saveGroupAction, saveTaskAction,
} from "./actions";

export const dynamic = "force-dynamic";

const claimsOf = (s: MenuSub) => [
  ...s.categoryIds.map((id) => ({ id, own: false })),
  ...(s.ownIds ?? []).map((id) => ({ id, own: true })),
];

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [cfg, custom, cats, counts] = await Promise.all([
    loadMenuConfig(),
    hasCustomMenu(),
    loadCategories(),
    prisma.product.groupBy({ by: ["categoryId"], where: { visible: true }, _count: { _all: true } }),
  ]);
  const direct = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const nodes: CatNode[] = [...cats.byId.values()].map((n) => ({ id: n.id, parentId: n.parentId }));
  const lost = lostCategories(nodes, direct, cfg);
  const lostProducts = lost.reduce((a, l) => a + l.count, 0);
  const nameOf = (id: string) => cats.byId.get(id)?.nameUk ?? `нет в базе: ${id}`;
  const total = (id: string, own: boolean) => (own ? direct.get(id) ?? 0 : cats.subtreeIds(id).reduce((a, x) => a + (direct.get(x) ?? 0), 0));
  const subOptions = cfg.groups.flatMap((g) => g.subs.map((s) => ({ id: s.id, label: `${g.nameUk} › ${s.nameUk}` })));
  const subTotal = (s: MenuSub) => claimsOf(s).reduce((a, c) => a + total(c.id, c.own), 0);

  const CatSelect = ({ name, value }: { name: string; value: string }) => (
    <select name={name} defaultValue={value} className="adm-select" aria-label="Куда положить категорию">
      {subOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      <option value="">— убрать из меню —</option>
    </select>
  );

  const GroupCard = ({ g, index }: { g: MenuGroup; index: number }) => {
    const emptySubs = g.subs.filter((s) => claimsOf(s).length === 0);
    const sum = g.subs.reduce((a, s) => a + subTotal(s), 0);
    return (
      <details id={`g-${g.id}`} className="adm-group" open={index === 0}>
        <summary>
          <span>{g.nameUk} <span className="adm-muted">· подгрупп: {g.subs.length} · товаров: {sum}</span></span>
          {g.hidden && <span className="adm-chip warn">скрыта на сайте</span>}
        </summary>
        <div className="adm-group-body">
          <form action={saveGroupAction}>
            <input type="hidden" name="groupId" value={g.id} />
            <div className="adm-grid2">
              <div className="adm-field"><label htmlFor={`g-${g.id}-uk`}>Название (українською)</label><input id={`g-${g.id}-uk`} name="g.nameUk" defaultValue={g.nameUk} className="adm-input wide" required minLength={2} /></div>
              <div className="adm-field"><label htmlFor={`g-${g.id}-ru`}>Название (по-русски)</label><input id={`g-${g.id}-ru`} name="g.nameRu" defaultValue={g.nameRu} className="adm-input wide" required minLength={2} /></div>
              <div className="adm-field"><label htmlFor={`g-${g.id}-huk`}>Подсказка под названием (українською)</label><input id={`g-${g.id}-huk`} name="g.hintUk" defaultValue={g.hintUk} className="adm-input wide" /></div>
              <div className="adm-field"><label htmlFor={`g-${g.id}-hru`}>Подсказка (по-русски)</label><input id={`g-${g.id}-hru`} name="g.hintRu" defaultValue={g.hintRu} className="adm-input wide" /></div>
            </div>
            <div className="adm-row" style={{ margin: "4px 0 10px" }}>
              <label className="adm-row">Место в списке <input name="g.order" defaultValue={index + 1} inputMode="numeric" className="adm-input" style={{ width: 70 }} aria-label="Место группы в списке" /></label>
              <label className="adm-row"><input type="checkbox" name="g.hidden" defaultChecked={g.hidden === true} /> Не показывать группу на сайте</label>
            </div>

            <h3>Подгруппы и какие категории в них лежат</h3>
            {g.subs.length === 0 && <p className="adm-muted">Подгрупп пока нет — добавьте ниже.</p>}
            {g.subs.map((s, si) => (
              <div key={s.id} style={{ borderTop: "1px solid var(--adm-line)", padding: "8px 0" }}>
                <div className="adm-menu-row" style={{ borderTop: 0 }}>
                  <input name={`sub:${s.id}:nameUk`} defaultValue={s.nameUk} className="adm-input" aria-label={`Название подгруппы (укр.): ${s.nameUk}`} required minLength={2} />
                  <input name={`sub:${s.id}:nameRu`} defaultValue={s.nameRu} className="adm-input" aria-label={`Название подгруппы (рус.): ${s.nameUk}`} required minLength={2} />
                  <input name={`sub:${s.id}:order`} defaultValue={si + 1} inputMode="numeric" className="adm-input" aria-label={`Место подгруппы: ${s.nameUk}`} title="Место в списке" />
                  <label className="adm-row"><input type="checkbox" name={`sub:${s.id}:hidden`} defaultChecked={s.hidden === true} /> скрыть</label>
                </div>
                {claimsOf(s).length === 0 && <p className="adm-muted" style={{ paddingLeft: 18 }}>В подгруппе нет категорий. Перенесите сюда категории из других подгрупп или удалите её (кнопка ниже).</p>}
                {claimsOf(s).map((c) => (
                  <div key={c.id} className="adm-menu-cats">
                    <span>{nameOf(c.id)} <span className="adm-muted">· {total(c.id, c.own)}{c.own ? " (только прямо в ней)" : ""}</span></span>
                    <CatSelect name={`to:${c.id}`} value={s.id} />
                  </div>
                ))}
              </div>
            ))}
            <div className="adm-sticky-save">
              <SubmitButton primary pendingText="Сохраняю…">Сохранить группу «{g.nameUk}»</SubmitButton>
              <span className="adm-muted">Сохраняются названия, порядок и перенос категорий.</span>
            </div>
          </form>

          <form action={addSubAction} className="adm-row" style={{ marginTop: 12 }}>
            <input type="hidden" name="groupId" value={g.id} />
            <input name="nameUk" className="adm-input" placeholder="Новая подгруппа (укр.)" aria-label="Название новой подгруппы (укр.)" required minLength={2} />
            <input name="nameRu" className="adm-input" placeholder="Новая подгруппа (рус.)" aria-label="Название новой подгруппы (рус.)" required minLength={2} />
            <SubmitButton pendingText="…">Добавить подгруппу</SubmitButton>
          </form>
          {emptySubs.length > 0 && (
            <form action={removeSubAction} className="adm-row" style={{ marginTop: 8 }}>
              <input type="hidden" name="groupId" value={g.id} />
              <select name="subId" className="adm-select" aria-label="Пустая подгруппа для удаления">
                {emptySubs.map((s) => <option key={s.id} value={s.id}>{s.nameUk}</option>)}
              </select>
              <button type="submit" className="adm-btn adm-danger">Удалить пустую подгруппу</button>
            </form>
          )}
          {g.subs.length === 0 && (
            <form action={removeGroupAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="groupId" value={g.id} />
              <button type="submit" className="adm-btn adm-danger">Удалить пустую группу</button>
            </form>
          )}
        </div>
      </details>
    );
  };

  return (
    <>
      <h1>Меню каталога и задачи</h1>
      <p className="adm-lead">
        Так покупатель находит товары: сначала группа («Диски та круги»), потом подгруппа («Відрізні по металу»). Это <b>отдельный слой над
        категориями поставщика</b>: категории и импорт не меняются, а здесь вы решаете, в какой подгруппе показывать каждую категорию.
        Ниже же — «задачи» на главной («Різати метал», «Свердлити»…).
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      <p>
        <span className={custom ? "adm-chip warn" : "adm-chip ok"}>{custom ? "Меню изменено вами" : "Стандартное меню"}</span>{" "}
        <span className="adm-muted">Групп: {cfg.groups.length}, подгрупп: {cfg.groups.reduce((a, g) => a + g.subs.length, 0)}, задач: {cfg.tasks.length}.</span>
      </p>

      {lost.length > 0 ? (
        <div className="adm-card" id="lost" style={{ borderColor: "var(--adm-bad)" }}>
          <b style={{ color: "var(--adm-bad)" }}>Не видны в меню: категорий {lost.length}, товаров {lostProducts}.</b>
          <p className="adm-muted">Такие товары остаются на сайте и находятся поиском, но в меню их нет. Чаще всего это новые категории после импорта. Выберите подгруппу для каждой.</p>
          {lost.map((l) => (
            <form key={l.id} action={assignLostAction} className="adm-row" style={{ margin: "6px 0" }}>
              <input type="hidden" name="catId" value={l.id} />
              <span style={{ flex: "1 1 220px" }}>{nameOf(l.id)} <span className="adm-muted">· {l.count}</span></span>
              <select name="subId" className="adm-select" defaultValue="" aria-label={`Куда положить: ${nameOf(l.id)}`}>
                <option value="">— выберите подгруппу —</option>
                {subOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <SubmitButton pendingText="…">Добавить в меню</SubmitButton>
            </form>
          ))}
        </div>
      ) : (
        <p className="adm-flash ok">Все {[...direct.values()].reduce((a, b) => a + b, 0)} товаров попадают в меню: ничего не потеряно.</p>
      )}

      <h2>Группы меню</h2>
      {cfg.groups.map((g, i) => <GroupCard key={g.id} g={g} index={i} />)}
      <form action={addGroupAction} className="adm-card adm-row">
        <input name="nameUk" className="adm-input" placeholder="Новая группа (укр.)" aria-label="Название новой группы (укр.)" required minLength={2} />
        <input name="nameRu" className="adm-input" placeholder="Новая группа (рус.)" aria-label="Название новой группы (рус.)" required minLength={2} />
        <SubmitButton pendingText="…">Добавить группу</SubmitButton>
      </form>

      <h2 id="tasks">Задачи на главной</h2>
      <p className="adm-lead">Плитки «Що потрібно зробити?»: покупатель нажимает задачу и видит подходящие товары. К задаче можно отнести любые категории.</p>
      {cfg.tasks.map((t, i) => (
        <details key={t.id} id={`t-${t.id}`} className="adm-group">
          <summary>
            <span>{t.nameUk} <span className="adm-muted">· категорий: {t.categoryIds.length + (t.ownIds?.length ?? 0)}</span></span>
            {t.hidden && <span className="adm-chip warn">скрыта на сайте</span>}
          </summary>
          <div className="adm-group-body">
            <form action={saveTaskAction}>
              <input type="hidden" name="taskId" value={t.id} />
              <div className="adm-grid2">
                <div className="adm-field"><label htmlFor={`t-${t.id}-uk`}>Название (українською)</label><input id={`t-${t.id}-uk`} name="nameUk" defaultValue={t.nameUk} className="adm-input wide" required minLength={2} /></div>
                <div className="adm-field"><label htmlFor={`t-${t.id}-ru`}>Название (по-русски)</label><input id={`t-${t.id}-ru`} name="nameRu" defaultValue={t.nameRu} className="adm-input wide" required minLength={2} /></div>
                <div className="adm-field"><label htmlFor={`t-${t.id}-huk`}>Подсказка (українською)</label><input id={`t-${t.id}-huk`} name="hintUk" defaultValue={t.hintUk} className="adm-input wide" /></div>
                <div className="adm-field"><label htmlFor={`t-${t.id}-hru`}>Подсказка (по-русски)</label><input id={`t-${t.id}-hru`} name="hintRu" defaultValue={t.hintRu} className="adm-input wide" /></div>
              </div>
              <div className="adm-row" style={{ margin: "4px 0 10px" }}>
                <label className="adm-row">Значок <select name="icon" defaultValue={t.icon} className="adm-select">{TASK_ICONS.map((ic) => <option key={ic.key} value={ic.key}>{ic.label}</option>)}</select></label>
                <label className="adm-row">Место <input name="order" defaultValue={i + 1} inputMode="numeric" className="adm-input" style={{ width: 70 }} aria-label="Место задачи в списке" /></label>
                <label className="adm-row"><input type="checkbox" name="hidden" defaultChecked={t.hidden === true} /> Не показывать на сайте</label>
              </div>
              <b>Какие категории входят (уберите галочку — категория выйдет из задачи)</b>
              <div className="adm-chips">
                {t.categoryIds.map((id) => <label key={id} className="adm-chipcheck"><input type="checkbox" name="cat" value={id} defaultChecked /> {nameOf(id)}</label>)}
                {(t.ownIds ?? []).map((id) => <label key={`o-${id}`} className="adm-chipcheck"><input type="checkbox" name="ownCat" value={id} defaultChecked /> {nameOf(id)} (только прямо в ней)</label>)}
                {t.categoryIds.length + (t.ownIds?.length ?? 0) === 0 && <span className="adm-muted">Пока нет категорий — добавьте ниже.</span>}
              </div>
              <div className="adm-field">
                <label htmlFor={`t-${t.id}-add`}>Добавить категорию (вместе с вложенными)</label>
                <select id={`t-${t.id}-add`} name="addCat" defaultValue="" className="adm-select">
                  <option value="">— не добавлять —</option>
                  {cats.flat.filter((c) => c.id !== "unsorted").map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div className="adm-sticky-save"><SubmitButton primary pendingText="Сохраняю…">Сохранить задачу «{t.nameUk}»</SubmitButton></div>
            </form>
            <form action={removeTaskAction} style={{ marginTop: 8 }}>
              <input type="hidden" name="taskId" value={t.id} />
              <button type="submit" className="adm-btn adm-danger">Удалить задачу</button>
            </form>
          </div>
        </details>
      ))}
      <form action={addTaskAction} className="adm-card adm-row">
        <input name="nameUk" className="adm-input" placeholder="Новая задача (укр.)" aria-label="Название новой задачи (укр.)" required minLength={2} />
        <input name="nameRu" className="adm-input" placeholder="Новая задача (рус.)" aria-label="Название новой задачи (рус.)" required minLength={2} />
        <SubmitButton pendingText="…">Добавить задачу</SubmitButton>
      </form>

      {custom && (
        <form action={resetMenuAction} className="adm-card">
          <h2 style={{ marginTop: 0 }}>Вернуть стандартное меню</h2>
          <p className="adm-muted">Все ваши правки групп, подгрупп и задач будут потеряны. Тексты, страницы и товары не затрагиваются.</p>
          <label className="adm-row"><input type="checkbox" name="confirm" /> Да, вернуть стандартное меню и задачи</label>
          <div style={{ marginTop: 8 }}><button type="submit" className="adm-btn adm-danger">Вернуть стандартное</button></div>
        </form>
      )}
    </>
  );
}
