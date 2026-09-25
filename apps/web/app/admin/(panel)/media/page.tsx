// Фото товаров: свои копии на нашем сервере по каждому поставщику (каталогу) и фирменный стиль фото (светлый фон, товар «парит»).
// Кнопки скачивают недостающие и делают стиль; новые фото после импорта докачиваются сами. Пока копии нет — показывается фото поставщика.
import { prisma } from "@handyman/db";
import { lastRuns, mediaDir, mediaStats, photoStyleOn } from "@handyman/db/media";
import { requirePermission } from "@/lib/auth";
import { AutoRefresh, SubmitButton } from "../import/client-bits";
import { startMediaAction, startStyleAction, stopMediaAction, togglePhotoStyleAction } from "./actions";

export const dynamic = "force-dynamic";

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} ГБ` : `${Math.round(bytes / 1024 ** 2)} МБ`);
const STATUS: Record<string, string> = { running: "идёт", done: "готово", stopped: "остановлено", failed: "ошибка" };
type Run = NonNullable<ReturnType<Awaited<ReturnType<typeof lastRuns>>["get"]>>;

function RunInfo({ run, label }: { run?: Run; label: string }) {
  if (!run) return null;
  if (run.status === "running" && !run.interrupted) {
    const pct = run.total ? Math.round(((run.done + run.failed) / run.total) * 100) : 0;
    return (
      <>
        <div className="adm-progress" aria-label={`${label}: ${pct}%`}><i style={{ width: `${pct}%` }} /></div>
        <p className="adm-muted" style={{ margin: "4px 0" }}>
          {label}: {run.done + run.failed} из {run.total}{run.failed ? `, не удалось ${run.failed}` : ""}{run.stopRequested ? " — останавливаю…" : ""}
        </p>
        {!run.stopRequested && <form action={stopMediaAction.bind(null, run.id)}><SubmitButton pendingText="…">Остановить</SubmitButton></form>}
      </>
    );
  }
  return (
    <p className="adm-muted" style={{ margin: "0 0 6px" }}>
      {label}, последний раз: {run.startedAt.toLocaleString("ru-RU")} — {run.interrupted ? "прервано (сервер перезапускали)" : STATUS[run.status] ?? run.status}
      {run.done ? `, готово ${run.done}` : ""}{run.failed ? `, не удалось ${run.failed}` : ""}
      {run.error ? <><br /><b style={{ color: "var(--adm-warn)" }}>{run.error}</b></> : null}
    </p>
  );
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("import.run");
  const { ok, error } = await searchParams;
  const [suppliers, stats, runs, styleOn, samples] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    mediaStats(),
    lastRuns(),
    photoStyleOn(),
    prisma.productImage.findMany({
      where: { styledUrl: { not: null }, localUrl: { not: null } }, orderBy: { styledAt: "desc" }, take: 12,
      select: { id: true, localUrl: true, styledUrl: true, product: { select: { nameUk: true } } },
    }),
  ]);
  const rows = [
    ...suppliers.map((s) => ({ key: s.id, name: s.name })),
    ...(stats.some((x) => x.supplierId === null) ? [{ key: "none", name: "Без поставщика (добавлены вручную)" }] : []),
  ].map((r) => {
    const st = stats.find((x) => (x.supplierId ?? "none") === r.key) ?? { total: 0, local: 0, errors: 0, bytes: 0, styled: 0 };
    const sid = r.key === "none" ? "" : r.key;
    return { ...r, ...st, dl: runs.get(`${sid}|download`), style: runs.get(`${sid}|style`) };
  });
  const live = (x?: Run) => x?.status === "running" && !x.interrupted;
  const anyRunning = rows.some((r) => live(r.dl) || live(r.style));
  const totalBytes = rows.reduce((a, r) => a + r.bytes, 0);
  const styledTotal = rows.reduce((a, r) => a + r.styled, 0);

  return (
    <>
      <h1>Фото товаров</h1>
      <p className="adm-lead">
        Сайт хранит свои копии фото, чтобы они показывались, даже когда сайт поставщика не работает. Фото уменьшаются до 1200 px (формат WebP) —
        в 3–4 раза меньше исходных. Кнопка скачивает только недостающие; после каждого импорта новые фото докачиваются сами. Пока копии нет —
        показывается фото поставщика.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      {anyRunning && <AutoRefresh everyMs={2000} />}

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Фирменный стиль фото {styleOn ? <span className="adm-chip ok">включён на сайте</span> : <span className="adm-chip">выключен</span>}</h2>
        <p className="adm-muted" style={{ marginTop: 0 }}>
          Светлый плавный фон, товар «парит» над мягкой тенью, жёлтая метка — все фото в одном стиле. Исходные копии сохраняются: стиль можно выключить
          в любой момент, сайт сразу вернётся к обычным фото. Если фон у фото сложный и вырезать товар ненадёжно, фото кладётся на светлый фон целиком.
          Сначала сделайте стиль (кнопки в таблице, можно «Проба на 40 фото»), посмотрите пример ниже, потом включите.
        </p>
        <form action={togglePhotoStyleAction.bind(null, !styleOn)}>
          <SubmitButton primary={!styleOn} pendingText="Переключаю…">
            {styleOn ? "Выключить фирменный стиль на сайте" : `Включить фирменный стиль на сайте${styledTotal ? ` (готово ${styledTotal} фото)` : ""}`}
          </SubmitButton>
        </form>
      </section>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr><th>Поставщик</th><th className="num">Фото</th><th className="num">У нас</th><th className="num">В стиле</th><th className="num">Место</th><th>Скачивание</th><th>Фирменный стиль</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const missing = r.total - r.local;
              const toStyle = r.local - r.styled;
              return (
                <tr key={r.key}>
                  <td><b>{r.name}</b>{r.errors ? <div className="adm-muted">не удалось скачать: {r.errors}</div> : null}</td>
                  <td className="num">{r.total}</td>
                  <td className="num">{r.local}{r.total ? ` (${Math.round((r.local / r.total) * 100)}%)` : ""}</td>
                  <td className="num">{r.styled}</td>
                  <td className="num">{r.bytes ? mb(r.bytes) : "—"}</td>
                  <td style={{ minWidth: 220 }}>
                    <RunInfo run={r.dl} label="Скачивание" />
                    {!live(r.dl) && (missing > 0 ? (
                      <form action={startMediaAction.bind(null, r.key)}>
                        <SubmitButton primary pendingText="Запускаю…">{r.errors ? `Скачать недостающие (${missing})` : `Скачать фото к себе (${missing})`}</SubmitButton>
                      </form>
                    ) : r.total ? <span className="adm-chip ok">все фото у нас</span> : <span className="adm-muted">нет фото</span>)}
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <RunInfo run={r.style} label="Стиль" />
                    {!live(r.style) && (toStyle > 0 ? (
                      <div className="adm-row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <form action={startStyleAction.bind(null, r.key, 40)}><SubmitButton pendingText="…">Проба на 40 фото</SubmitButton></form>
                        <form action={startStyleAction.bind(null, r.key, 0)}><SubmitButton pendingText="Запускаю…">Сделать стиль ({toStyle})</SubmitButton></form>
                      </div>
                    ) : r.local ? <span className="adm-chip ok">все в стиле</span> : <span className="adm-muted">сначала скачайте</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {samples.length > 0 && (
        <section className="adm-card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Пример: было → стало (последние сделанные)</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {samples.map((s) => (
              <figure key={s.id} style={{ margin: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- просмотр своих копий в админке */}
                  <img src={s.localUrl!} alt="было" loading="lazy" style={{ width: "100%", aspectRatio: "1", objectFit: "contain", border: "1px solid var(--adm-line)", borderRadius: 10, background: "#fff" }} />
                  {/* eslint-disable-next-line @next/next/no-img-element -- просмотр фирменного стиля в админке */}
                  <img src={s.styledUrl!} alt="стало" loading="lazy" style={{ width: "100%", aspectRatio: "1", objectFit: "contain", border: "1px solid var(--adm-line)", borderRadius: 10 }} />
                </div>
                <figcaption className="adm-muted" style={{ fontSize: 13, marginTop: 4 }}>{s.product.nameUk}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <p className="adm-muted" style={{ marginTop: 12 }}>
        Всего своих копий: {mb(totalBytes)}. Папка на этом компьютере: <code>{mediaDir()}</code> — при переезде на сервер её нужно скопировать туда
        (или скачать фото заново кнопками выше). Причины ошибок (например, «сайт поставщика не ответил») видны в карточке товара — повторить можно этой же кнопкой.
      </p>
    </>
  );
}
