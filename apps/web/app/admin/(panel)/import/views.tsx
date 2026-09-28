import Link from "next/link";
import type { ImportSummary } from "@handyman/core/catalog";
import { NEW_BRAND_PREFIX, NO_BRAND_KEY, PATH_SEP, UNSORTED_ID, brandDecisionText } from "@handyman/core/catalog";
import type { BrandRow, ImportReport, TreeDecision, TreeRow } from "@handyman/db/catalog-import";
import type { UndoInfo } from "@handyman/db/import-undo";
import { AutoRefresh, SubmitButton } from "./client-bits";
import { applyAction, deleteRunAction, saveMappingAction, startPreviewAction, undoImportAction } from "./actions";

type Cat = { id: string; nameUk: string };
type BrandOpt = { id: string; name: string };
type SupplierRow = {
  id: string;
  name: string;
  active: boolean;
  feedUrl: string | null;
  markupPct: number | null;
  defaultBrand: string | null;
  products: number;
  brands: BrandOpt[];
};
type RunRow = {
  id: string;
  supplierId: string;
  sourceKind: string;
  sourceRef: string | null;
  status: "PREVIEW" | "RUNNING" | "DONE" | "FAILED";
  total: number;
  progress: number;
  summary: unknown;
  report: unknown;
  error: string | null;
  who: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;
const when = (d: Date | null) => (d ? d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—");
const STATUS_RU = { PREVIEW: "Проверка", RUNNING: "Идёт импорт", DONE: "Готово", FAILED: "Ошибка" } as const;

function Stat({ value, label, tone = "" }: { value: number | string; label: string; tone?: "" | "ok" | "warn" | "bad" }) {
  return (
    <div className={`adm-stat ${tone}`}>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

// ---------- запуск ----------

/** Чей каталог загружаем: поставщики кнопками (у каждого своя ссылка на фид, свои бренды и свой журнал). */
export function SupplierPicker({ suppliers, currentId, canEdit }: { suppliers: SupplierRow[]; currentId: string; canEdit: boolean }) {
  return (
    <div className="adm-card">
      <b>Поставщик:</b>
      <div className="adm-row" style={{ marginTop: 8, gap: 6 }}>
        {suppliers.map((s) => (
          <Link
            key={s.id}
            href={`/admin/import?supplier=${s.id}`}
            className={s.id === currentId ? "adm-btn primary" : "adm-btn"}
            aria-current={s.id === currentId ? "true" : undefined}
            title={s.active ? undefined : "Выключен: с ним сейчас не работаем"}
          >
            {s.name} <span style={{ opacity: 0.75 }}>· {s.products} тов.</span>{s.active ? "" : " (выкл.)"}
          </Link>
        ))}
        {canEdit && <Link href="/admin/suppliers/new" className="adm-btn">+ Новый поставщик</Link>}
      </div>
      {!canEdit && <p className="adm-muted" style={{ marginTop: 6 }}>Добавлять поставщиков может роль с правом «Поставщики и бренды».</p>}
    </div>
  );
}

export function StartCard({ supplier, canEdit }: { supplier: SupplierRow; canEdit: boolean }) {
  return (
    <div className="adm-card">
      <h2 style={{ marginTop: 0 }}>Загрузить каталог поставщика «{supplier.name}»</h2>
      <p className="adm-muted">
        Сначала будет <b>проверка</b>: вы увидите, что появится и изменится, и выберете, какие бренды загружать, — ничего не записывая в каталог.
        Только потом — кнопка «Применить». Неудачную загрузку можно отменить.
      </p>
      <p className="adm-muted">
        Наценка: {supplier.markupPct == null ? "нет (цена фида = РРЦ)" : `${supplier.markupPct}%`} · бренд, если в файле не указан: {supplier.defaultBrand ?? "не задан"} ·
        бренды поставщика: {supplier.brands.length ? supplier.brands.map((b) => b.name).join(", ") : "пока нет"}
        {canEdit && <> · <Link className="adm-link" href={`/admin/suppliers/${supplier.id}`}>настройки поставщика</Link></>}
      </p>
      <form action={startPreviewAction} className="adm-field">
        <input type="hidden" name="mode" value="url" />
        <input type="hidden" name="supplierId" value={supplier.id} />
        <label htmlFor="feed-url">Ссылка на XML-фид</label>
        <div className="adm-row">
          <input id="feed-url" name="url" className="adm-input" style={{ flex: "1 1 320px" }} defaultValue={supplier.feedUrl ?? ""} placeholder="https://…" />
          <SubmitButton primary pendingText="Скачиваю и проверяю… (до минуты)">Проверить по ссылке</SubmitButton>
        </div>
      </form>
      <form action={startPreviewAction} className="adm-field">
        <input type="hidden" name="mode" value="file" />
        <input type="hidden" name="supplierId" value={supplier.id} />
        <label htmlFor="feed-file">Или файл XML с компьютера (если сайт поставщика не отдаёт фид программе)</label>
        <div className="adm-row">
          <input id="feed-file" name="file" type="file" accept=".xml,text/xml,application/xml" className="adm-input" />
          <SubmitButton pendingText="Загружаю и проверяю…">Проверить файл</SubmitButton>
        </div>
      </form>
    </div>
  );
}

// ---------- дерево категорий ----------

function decisionText(d: TreeDecision, names: Map<string, string>): string {
  if (d.kind === "skip") return "не загружать";
  if (d.kind === "new") return `новая категория «${d.name}»`;
  return names.get(d.categoryId ?? "") ?? d.categoryId ?? "—";
}

function MapRow({ row, index, cats, names }: { row: TreeRow; index: number; cats: Cat[]; names: Map<string, string> }) {
  const value = !row.overridden ? "auto" : row.decision.kind === "skip" ? "skip" : `cat:${row.decision.categoryId}`;
  const isNoCategory = row.key === "(без категорії)";
  return (
    <div className="adm-map-row">
      <div className="adm-map-name">
        {row.name} <span className="adm-muted">· {row.count} тов.</span>{" "}
        {row.overridden ? <span className="adm-chip">выбрано вами</span> : null}
      </div>
      <input type="hidden" name={`k_${index}`} value={row.key} />
      <select name={`m_${index}`} defaultValue={value} className="adm-select" aria-label={`Куда класть: ${row.name}`}>
        <option value="auto">Автоматически: {decisionText(row.suggested, names)}</option>
        <option value="skip">Не загружать</option>
        {cats.map((c) => (
          <option key={c.id} value={`cat:${c.id}`}>{c.nameUk}</option>
        ))}
        {!isNoCategory && <option value={`new:${row.name}`}>Создать новую категорию «{row.name}»</option>}
      </select>
    </div>
  );
}

function MappingTree({ tree, cats }: { tree: TreeRow[]; cats: Cat[] }) {
  const names = new Map(cats.map((c) => [c.id, c.nameUk]));
  const roots = tree.filter((r) => r.depth === 1);
  return (
    <div>
      {roots.map((root) => {
        const children = tree.filter((r) => r.depth === 2 && r.key.startsWith(root.key + PATH_SEP));
        return (
          <div key={root.key} className="adm-root">
            <MapRow row={root} index={tree.indexOf(root)} cats={cats} names={names} />
            {children.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary className="adm-muted">Подгруппы ({children.length}) — можно назначить отдельно</summary>
                {children.map((c) => (
                  <div key={c.key} className="adm-sub">
                    <MapRow row={c} index={tree.indexOf(c)} cats={cats} names={names} />
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- бренды в файле ----------

function BrandTable({ rows, brands }: { rows: BrandRow[]; brands: BrandOpt[] }) {
  const names = new Map(brands.map((b) => [b.id, b.name]));
  const suggestedText = (r: BrandRow) =>
    r.suggested.kind === "brand" ? names.get(r.suggested.brandId) ?? "—" : r.suggested.kind === "new" ? `новый бренд «${r.suggested.name}»` : "без бренда";
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th>В файле</th>
            <th className="num">Товаров</th>
            <th>Загружать как</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const d = r.decision;
            const value = !r.overridden ? "auto" : d.kind === "skip" ? "skip" : d.brandId ? `brand:${d.brandId}` : "none";
            const isNone = r.key === NO_BRAND_KEY;
            const feedNameIsNew = !isNone && !brands.some((b) => b.name.toLowerCase() === r.name.toLowerCase());
            return (
              <tr key={r.key}>
                <td>
                  {isNone ? <i>бренд не указан</i> : <b>{r.name}</b>}
                  {r.overridden ? <> <span className="adm-chip">выбрано вами</span></> : null}
                  <div className="adm-muted">сейчас: {brandDecisionText(d, names)}</div>
                </td>
                <td className="num">{r.count}</td>
                <td>
                  <input type="hidden" name={`bk_${i}`} value={r.key} />
                  <div className="adm-row" style={{ gap: 6 }}>
                    <select name={`bm_${i}`} defaultValue={value} className="adm-select" aria-label={`Бренд для «${r.name}»`}>
                      <option value="auto">Автоматически: {suggestedText(r)}</option>
                      <option value="skip">Не загружать эти товары</option>
                      <option value="none">Без бренда</option>
                      {feedNameIsNew && <option value={`new:${r.name}`}>Создать бренд «{r.name}»</option>}
                      {brands.map((b) => (
                        <option key={b.id} value={`brand:${b.id}`}>{b.name}</option>
                      ))}
                    </select>
                    <input name={`bn_${i}`} className="adm-input" style={{ flex: "0 1 200px" }} placeholder="или новый бренд" aria-label={`Новый бренд для «${r.name}»`} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- проверка ----------

export function PreviewView({ run, cats, brands, supplierName, canApply }: { run: RunRow; cats: Cat[]; brands: BrandOpt[]; supplierName: string; canApply: boolean }) {
  const s = run.summary as ImportSummary;
  const r = run.report as ImportReport;
  const reasons = Object.entries(s.skippedByReason);
  // Похоже на файл другого поставщика: большая часть уже загруженных товаров этого поставщика «пропадёт».
  const supplierProducts = r.supplierProducts ?? 0;
  const suspicious = s.missing >= 5 && supplierProducts > 0 && s.missing / supplierProducts >= 0.3;
  const newBrands = (r.brands ?? []).filter((b) => b.decision.kind === "brand" && b.decision.brandId?.startsWith(NEW_BRAND_PREFIX));
  return (
    <>
      <h2>Результат проверки — в каталог пока ничего не записано</h2>
      <p className="adm-muted">
        Источник: {run.sourceKind === "url" ? "ссылка" : "файл"} <span style={{ overflowWrap: "anywhere" }}>{run.sourceRef}</span>. Файл фида от {r.feedInfo.date ?? "—"}, записей в файле: {r.feedInfo.totalRows}
        {r.feedInfo.currency && r.feedInfo.currency !== "UAH" ? ` (валюта ${r.feedInfo.currency}!)` : ""}.
      </p>

      <div className="adm-grid">
        <Stat value={s.created} label="появится новых" tone="ok" />
        <Stat value={s.updated} label="обновится" />
        <Stat value={s.unchanged} label="без изменений" />
        <Stat value={s.skipped} label="не будет загружено" />
        <Stat value={s.priceChanged} label="изменится цена" />
        <Stat value={s.conflicts} label="расхождения цен" tone={s.conflicts ? "warn" : ""} />
        <Stat value={s.needConfirm} label="цена ждёт подтверждения" tone={s.needConfirm ? "warn" : ""} />
        <Stat value={s.missing} label="пропали из фида" tone={s.missing ? "warn" : ""} />
        <Stat value={s.issues} label="замечаний к файлу" tone={s.issues ? "warn" : ""} />
      </div>
      {reasons.length > 0 && (
        <p className="adm-muted">
          Не загружаются: {reasons.map(([why, n]) => `${why} — ${n}`).join("; ")}.
        </p>
      )}
      {r.newCategories.length > 0 && <p className="adm-muted">Будут созданы новые категории: {r.newCategories.join(", ")}.</p>}
      {newBrands.length > 0 && (
        <p className="adm-muted">Будут созданы новые бренды: {newBrands.map((b) => (b.decision.kind === "brand" ? b.decision.brandId!.slice(NEW_BRAND_PREFIX.length) : "")).join(", ")}.</p>
      )}
      {suspicious && (
        <div className="adm-flash err" role="alert">
          <b>Внимание: похоже, это файл другого поставщика.</b> У поставщика «{supplierName}» уже {supplierProducts} товаров, и {s.missing} из них нет в этом файле —
          после «Применить» они станут «Под заказ». Если вы загружаете каталог другого поставщика — вернитесь назад, выберите нужного поставщика
          (или добавьте нового) и проверьте файл заново.
        </div>
      )}

      <form>
        <input type="hidden" name="runId" value={run.id} />
        {r.brands && r.brands.length > 0 && (
          <>
            <h3>Бренды в файле</h3>
            <p className="adm-muted" style={{ maxWidth: 760 }}>
              Выберите, какие бренды загружать и под каким названием. «Не загружать» — эти товары не попадут в каталог. Если бренд в файле не указан,
              подставляется бренд поставщика по умолчанию. Выбор запоминается для следующих загрузок этого поставщика.
            </p>
            <div className="adm-card">
              <BrandTable rows={r.brands} brands={brands} />
            </div>
          </>
        )}
        <h3>Куда класть товары</h3>
        <p className="adm-muted" style={{ maxWidth: 760 }}>
          Программа сама предложила категории по названиям (список ниже). Проверьте и при необходимости поменяйте. Товары из «Архів продукції» по умолчанию не загружаются.
          Глубже двух уровней подкатегории сворачиваются.
        </p>
        <div className="adm-card">
          <MappingTree tree={r.tree} cats={cats} />
        </div>

        {r.needConfirm.length > 0 && (
          <>
            <h3>Резкое изменение цены (больше 30%)</h3>
            <p className="adm-muted">Отметьте товары, для которых новая цена верна. Остальные сохранят прежнюю цену.</p>
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th aria-label="Подтвердить" />
                    <th>Товар</th>
                    <th className="num">Было</th>
                    <th className="num">Станет</th>
                    <th className="num">Изменение</th>
                  </tr>
                </thead>
                <tbody>
                  {r.needConfirm.map((j) => (
                    <tr key={j.sku}>
                      <td><input type="checkbox" name="approve" value={j.sku} aria-label={`Подтвердить цену ${j.sku}`} /></td>
                      <td>{j.name}<div className="adm-muted">{j.sku}</div></td>
                      <td className="num">{money(j.oldPrice)}</td>
                      <td className="num">{money(j.newPrice)}</td>
                      <td className="num">{j.newPrice > j.oldPrice ? "+" : "−"}{j.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="adm-row" style={{ marginTop: 16 }}>
          <SubmitButton formAction={saveMappingAction} pendingText="Пересчитываю…">Сохранить выбор и пересчитать</SubmitButton>
          {canApply && (
            <SubmitButton formAction={applyAction} primary pendingText="Запускаю…">
              Применить: добавить {s.created}, обновить {s.updated}
            </SubmitButton>
          )}
        </div>
        <p className="adm-muted" style={{ marginTop: 6 }}>
          «Применить» тоже сохраняет ваш выбор категорий и брендов. Числа выше пересчитываются кнопкой «Сохранить выбор и пересчитать».
        </p>
      </form>

      <Details title={`Замечания к файлу (${s.issues})`} show={r.issues.length > 0}>
        <ul>{r.issues.map((i, n) => <li key={n}>Строка {i.row}{i.sku ? ` (${i.sku})` : ""}: {i.message}</li>)}</ul>
      </Details>
      <Details title={`Изменения цен (${s.priceChanged}) — самые большие`} show={r.priceChanges.length > 0}>
        <ul>{r.priceChanges.map((c) => <li key={c.sku}>{c.name} ({c.sku}): {money(c.oldPrice)} → {money(c.newPrice)} ({c.pct > 0 ? "+" : ""}{c.pct}%)</li>)}</ul>
      </Details>
      <Details title={`Расхождения цен (${s.conflicts})`} show={r.conflicts.length > 0}>
        <p className="adm-muted">Цена задана вручную и отличается от цены поставщика (РРЦ). Импорт её не меняет. Решить можно в разделе «Товары».</p>
        <ul>{r.conflicts.map((c) => <li key={c.sku}>{c.name} ({c.sku}): у вас {money(c.price)}, у поставщика {money(c.supplierPrice)}</li>)}</ul>
      </Details>
      <Details title={`Пропали из фида (${s.missing}) — станут «Под заказ»`} show={r.missing.length > 0}>
        <ul>{r.missing.map((m) => <li key={m.sku}>{m.sku}: {m.reason}</li>)}</ul>
      </Details>
      <Details title={`Не будут загружены (${s.skipped}) — первые ${r.skipped.length}`} show={r.skipped.length > 0}>
        <ul>{r.skipped.map((m) => <li key={m.sku}>{m.name} ({m.sku}): {m.reason}</li>)}</ul>
      </Details>
    </>
  );
}

function Details({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <details className="adm-card">
      <summary><b>{title}</b></summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}

// ---------- ход и итог ----------

export function RunningView({ run }: { run: RunRow }) {
  const pct = run.total > 0 ? Math.min(100, Math.round((run.progress / run.total) * 100)) : 0;
  return (
    <>
      <AutoRefresh />
      <h2>Идёт импорт…</h2>
      <div className="adm-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="adm-muted">
        Обработано {run.progress} из {run.total} товаров ({pct}%). Страницу можно не закрывать — она обновляется сама. Если закрыть, импорт всё равно дойдёт до конца.
      </p>
    </>
  );
}

export function DoneView({ run, lost }: { run: RunRow; lost: { categories: number; products: number; unsorted: number } | null }) {
  const s = run.summary as ImportSummary;
  const r = run.report as ImportReport;
  return (
    <>
      <h2>Импорт завершён</h2>
      <div className="adm-grid">
        <Stat value={s.created} label="добавлено" tone="ok" />
        <Stat value={s.updated} label="обновлено" />
        <Stat value={s.unchanged} label="без изменений" />
        <Stat value={s.skipped} label="не загружено" />
        <Stat value={s.priceChanged} label="цен изменено" />
        <Stat value={s.conflicts} label="расхождения цен" tone={s.conflicts ? "warn" : ""} />
        <Stat value={s.needConfirm} label="цены без подтверждения" tone={s.needConfirm ? "warn" : ""} />
        <Stat value={s.missing} label="стали «Под заказ»" />
        <Stat value={s.errors} label="ошибок" tone={s.errors ? "bad" : ""} />
      </div>
      <p>
        Завершён {when(run.finishedAt)}. <Link className="adm-link" href="/admin/products">Открыть товары</Link> · <Link className="adm-link" href="/admin/import">Новая проверка</Link>
      </p>
      {lost && lost.products > 0 && (
        <div className="adm-flash err" style={{ background: "var(--adm-soft)", color: "inherit" }}>
          <b>{lost.products} товаров этого поставщика не видно в каталоге сайта</b>: их разделы ({lost.categories}) не добавлены в меню. Поиск на сайте их находит,
          а в «Каталог» они попадут, когда вы разложите разделы по группам меню: <Link className="adm-link" href="/admin/site/menu#lost">Сайт → Меню и задачи</Link>.
        </div>
      )}
      {lost && lost.unsorted > 0 && (
        <div className="adm-flash err" style={{ background: "var(--adm-soft)", color: "inherit" }}>
          <b>{lost.unsorted} товаров этого поставщика в «Нераспределённых»</b> (в файле у них не было категории) — покупатели их не видят даже в поиске.
          Перенесите их в нужные категории: <Link className="adm-link" href={`/admin/products?cat=${UNSORTED_ID}&supplier=${run.supplierId}`}>Товары → Нераспределённые</Link>.
        </div>
      )}
      <Details title={`Ошибки при записи (${s.errors})`} show={r.errors.length > 0}>
        <ul>{r.errors.map((e, n) => <li key={n}>{e.sku}: {e.message}</li>)}</ul>
      </Details>
      <Details title={`Цены, которые ждут подтверждения (${s.needConfirm}) — повторите проверку и отметьте нужные`} show={r.needConfirm.length > 0}>
        <ul>{r.needConfirm.map((j) => <li key={j.sku}>{j.name} ({j.sku}): {money(j.oldPrice)} → {money(j.newPrice)}</li>)}</ul>
      </Details>
    </>
  );
}

export function FailedView({ run }: { run: RunRow }) {
  return (
    <>
      <h2>Импорт не выполнен</h2>
      <p className="adm-flash err">{run.error ?? "Неизвестная ошибка."}</p>
      <p><Link className="adm-link" href="/admin/import">Запустить проверку заново</Link></p>
    </>
  );
}

// ---------- отмена загрузки и удаление записи ----------

export function RunTools({ runId, undone, info }: { runId: string; undone: boolean; info: UndoInfo }) {
  if (!info.can && info.deletable) {
    return (
      <form action={deleteRunAction} style={{ marginTop: 24 }}>
        <input type="hidden" name="runId" value={runId} />
        {!undone && <p className="adm-muted">{info.reason}</p>}
        <SubmitButton pendingText="Убираю…">Убрать запись из журнала</SubmitButton>
      </form>
    );
  }
  return (
    <div className="adm-card" style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>Отменить загрузку</h3>
      {info.can ? (
        <form action={undoImportAction}>
          <input type="hidden" name="runId" value={runId} />
          <p style={{ marginTop: 0 }}>
            Будет удалено товаров, добавленных этой загрузкой: <b>{info.created}</b> (товары, которые уже заказали, лежат на складе или имеют отзывы, не удаляются,
            а скрываются с сайта).{" "}
            {info.updated > 0 && (info.legacy
              ? <>Товарам поставщика, которые эта загрузка отметила «нет в фиде» ({info.updated}), отметка будет снята.</>
              : <>Товарам, которые она изменила ({info.updated}), вернутся прежние цены, наличие, бренд и категория — кроме полей, которые после загрузки уже поменяли.</>)}
          </p>
          {info.legacy && (
            <p className="adm-muted">
              Это загрузка, сделанная до появления отмены: изменения цен у существующих товаров вернуть нельзя, наличие у поставщика обновится при следующей
              загрузке его каталога.
            </p>
          )}
          <p className="adm-muted">Фото, скачанные для этих товаров, остаются на диске: при повторной загрузке они подставятся сразу.</p>
          <div className="adm-row">
            <label><input type="checkbox" name="confirm" /> Да, отменить эту загрузку</label>
            <SubmitButton pendingText="Отменяю… (до пары минут)">Отменить загрузку</SubmitButton>
          </div>
        </form>
      ) : (
        <p className="adm-muted" style={{ marginTop: 0 }}>{info.reason}</p>
      )}
    </div>
  );
}

// ---------- журнал ----------

type HistoryRow = Omit<RunRow, "total" | "progress" | "report" | "supplierId"> & { undoneAt: Date | null; supplier: { id: string; name: string } };

export function HistoryTable({ runs }: { runs: HistoryRow[] }) {
  if (!runs.length) return <p className="adm-muted">Запусков ещё не было.</p>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th>Когда</th>
            <th>Поставщик</th>
            <th>Источник</th>
            <th>Статус</th>
            <th className="num">Добавлено</th>
            <th className="num">Обновлено</th>
            <th>Кто</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const s = r.summary as ImportSummary | null;
            return (
              <tr key={r.id}>
                <td><Link className="adm-link" href={`/admin/import?run=${r.id}`}>{when(r.startedAt)}</Link></td>
                <td>{r.supplier.name}</td>
                <td style={{ overflowWrap: "anywhere" }}>{r.sourceKind === "url" ? "ссылка" : "файл"}{r.sourceRef ? `: ${r.sourceRef.slice(0, 60)}` : ""}</td>
                <td>
                  {r.undoneAt
                    ? <span className="adm-chip">Отменена</span>
                    : <span className={`adm-chip ${r.status === "DONE" ? "ok" : r.status === "FAILED" ? "bad" : "warn"}`}>{STATUS_RU[r.status]}</span>}
                </td>
                <td className="num">{r.status === "DONE" && s ? s.created : "—"}</td>
                <td className="num">{r.status === "DONE" && s ? s.updated : "—"}</td>
                <td>{r.who ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
