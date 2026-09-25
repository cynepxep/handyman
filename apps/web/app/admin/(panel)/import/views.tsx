import Link from "next/link";
import type { ImportSummary } from "@handyman/core/catalog";
import { PATH_SEP } from "@handyman/core/catalog";
import type { ImportReport, TreeDecision, TreeRow } from "@handyman/db/catalog-import";
import { AutoRefresh, SubmitButton } from "./client-bits";
import { applyAction, saveMappingAction, saveSupplierAction, startPreviewAction } from "./actions";

type Cat = { id: string; nameUk: string };
type RunRow = {
  id: string;
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

export function StartCard({ feedUrl }: { feedUrl: string | null }) {
  return (
    <div className="adm-card">
      <h2 style={{ marginTop: 0 }}>Загрузить каталог поставщика</h2>
      <p className="adm-muted">
        Сначала будет <b>проверка</b>: вы увидите, что появится и изменится, ничего не записывая в каталог. Только потом — кнопка «Применить».
      </p>
      <form action={startPreviewAction} className="adm-field">
        <input type="hidden" name="mode" value="url" />
        <label htmlFor="feed-url">Ссылка на XML-фид</label>
        <div className="adm-row">
          <input id="feed-url" name="url" className="adm-input" style={{ flex: "1 1 320px" }} defaultValue={feedUrl ?? ""} placeholder="https://…" />
          <SubmitButton primary pendingText="Скачиваю и проверяю… (до минуты)">Проверить по ссылке</SubmitButton>
        </div>
      </form>
      <form action={startPreviewAction} className="adm-field">
        <input type="hidden" name="mode" value="file" />
        <label htmlFor="feed-file">Или файл XML с компьютера (если сайт поставщика не отдаёт фид программе)</label>
        <div className="adm-row">
          <input id="feed-file" name="file" type="file" accept=".xml,text/xml,application/xml" className="adm-input" />
          <SubmitButton pendingText="Загружаю и проверяю…">Проверить файл</SubmitButton>
        </div>
      </form>
    </div>
  );
}

export function SupplierCard({ supplier, canEdit }: { supplier: { name: string; feedUrl: string | null; defaultBrand: string | null; markupPct: number | null }; canEdit: boolean }) {
  return (
    <details className="adm-card">
      <summary>
        <b>Поставщик «{supplier.name}»</b> <span className="adm-muted">— наценка {supplier.markupPct == null ? "нет (цена фида = РРЦ)" : `${supplier.markupPct}%`}, бренд по умолчанию: {supplier.defaultBrand ?? "не задан"}</span>
      </summary>
      {canEdit ? (
        <form action={saveSupplierAction} style={{ marginTop: 10 }}>
          <div className="adm-field">
            <label htmlFor="s-url">Ссылка на фид (подставляется при проверке)</label>
            <input id="s-url" name="feedUrl" className="adm-input wide" defaultValue={supplier.feedUrl ?? ""} />
          </div>
          <div className="adm-field">
            <label htmlFor="s-brand">Бренд для товаров без указания производителя в фиде</label>
            <input id="s-brand" name="defaultBrand" className="adm-input" defaultValue={supplier.defaultBrand ?? ""} />
          </div>
          <div className="adm-field">
            <label htmlFor="s-markup">Наценка к цене фида, % (у Vitals в фиде уже рекомендованная розничная цена — оставьте пустым)</label>
            <input id="s-markup" name="markupPct" className="adm-input" inputMode="decimal" defaultValue={supplier.markupPct ?? ""} />
          </div>
          <SubmitButton>Сохранить</SubmitButton>
        </form>
      ) : (
        <p className="adm-muted">Менять настройки поставщика может роль с правом «Поставщики и бренды».</p>
      )}
    </details>
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

// ---------- проверка ----------

export function PreviewView({ run, cats, canApply }: { run: RunRow; cats: Cat[]; canApply: boolean }) {
  const s = run.summary as ImportSummary;
  const r = run.report as ImportReport;
  const reasons = Object.entries(s.skippedByReason);
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

      <form>
        <input type="hidden" name="runId" value={run.id} />
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
          «Применить» тоже сохраняет ваш выбор категорий. Числа выше пересчитываются кнопкой «Сохранить выбор и пересчитать».
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

export function DoneView({ run }: { run: RunRow }) {
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

// ---------- журнал ----------

export function HistoryTable({ runs }: { runs: Omit<RunRow, "total" | "progress" | "report">[] }) {
  if (!runs.length) return <p className="adm-muted">Запусков ещё не было.</p>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>
            <th>Когда</th>
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
                <td><a className="adm-link" href={`/admin/import?run=${r.id}`}>{when(r.startedAt)}</a></td>
                <td style={{ overflowWrap: "anywhere" }}>{r.sourceKind === "url" ? "ссылка" : "файл"}{r.sourceRef ? `: ${r.sourceRef.slice(0, 60)}` : ""}</td>
                <td><span className={`adm-chip ${r.status === "DONE" ? "ok" : r.status === "FAILED" ? "bad" : "warn"}`}>{STATUS_RU[r.status]}</span></td>
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
