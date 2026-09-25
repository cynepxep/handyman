// Фото товаров: свои копии на нашем сервере по каждому поставщику (каталогу). Кнопка скачивает недостающие; новые фото после импорта
// докачиваются сами. Пока копии нет, сайт показывает фото с сайта поставщика.
import { prisma } from "@handyman/db";
import { lastRuns, mediaDir, mediaStats } from "@handyman/db/media";
import { requirePermission } from "@/lib/auth";
import { AutoRefresh, SubmitButton } from "../import/client-bits";
import { startMediaAction, stopMediaAction } from "./actions";

export const dynamic = "force-dynamic";

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} ГБ` : `${Math.round(bytes / 1024 ** 2)} МБ`);
const STATUS: Record<string, string> = { running: "идёт", done: "готово", stopped: "остановлено", failed: "ошибка" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("import.run");
  const { ok, error } = await searchParams;
  const [suppliers, stats, runs] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    mediaStats(),
    lastRuns(),
  ]);
  const rows = [
    ...suppliers.map((s) => ({ key: s.id, name: s.name })),
    ...(stats.some((x) => x.supplierId === null) ? [{ key: "none", name: "Без поставщика (добавлены вручную)" }] : []),
  ].map((r) => {
    const st = stats.find((x) => (x.supplierId ?? "none") === r.key) ?? { total: 0, local: 0, errors: 0, bytes: 0 };
    const run = runs.get(r.key === "none" ? "" : r.key);
    return { ...r, ...st, run };
  });
  const anyRunning = rows.some((r) => r.run?.status === "running" && !r.run.interrupted);
  const totalBytes = rows.reduce((a, r) => a + r.bytes, 0);

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

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr><th>Поставщик</th><th className="num">Фото</th><th className="num">У нас</th><th className="num">Не удалось</th><th className="num">Место</th><th>Скачивание</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const running = r.run?.status === "running" && !r.run.interrupted;
              const pct = r.run && r.run.total ? Math.round(((r.run.done + r.run.failed) / r.run.total) * 100) : 0;
              const missing = r.total - r.local;
              return (
                <tr key={r.key}>
                  <td><b>{r.name}</b></td>
                  <td className="num">{r.total}</td>
                  <td className="num">{r.local}{r.total ? ` (${Math.round((r.local / r.total) * 100)}%)` : ""}</td>
                  <td className="num">{r.errors || "—"}</td>
                  <td className="num">{r.bytes ? mb(r.bytes) : "—"}</td>
                  <td style={{ minWidth: 230 }}>
                    {running && r.run ? (
                      <>
                        <div className="adm-progress" aria-label={`Скачано ${pct}%`}><i style={{ width: `${pct}%` }} /></div>
                        <p className="adm-muted" style={{ margin: "4px 0" }}>
                          {r.run.done + r.run.failed} из {r.run.total}{r.run.failed ? `, не удалось ${r.run.failed}` : ""}{r.run.stopRequested ? " — останавливаю…" : ""}
                        </p>
                        {!r.run.stopRequested && (
                          <form action={stopMediaAction.bind(null, r.run.id)}><SubmitButton pendingText="…">Остановить</SubmitButton></form>
                        )}
                      </>
                    ) : (
                      <>
                        {r.run && (
                          <p className="adm-muted" style={{ margin: "0 0 6px" }}>
                            Последний раз: {r.run.startedAt.toLocaleString("ru-RU")} — {r.run.interrupted ? "прервано (сервер перезапускали)" : STATUS[r.run.status] ?? r.run.status}
                            {r.run.done ? `, скачано ${r.run.done}` : ""}{r.run.failed ? `, не удалось ${r.run.failed}` : ""}
                            {r.run.error ? <><br /><b style={{ color: "var(--adm-warn)" }}>{r.run.error}</b></> : null}
                          </p>
                        )}
                        {missing > 0 ? (
                          <form action={startMediaAction.bind(null, r.key)}>
                            <SubmitButton primary pendingText="Запускаю…">{r.errors ? `Скачать недостающие (${missing}, в т. ч. повторить ошибки)` : `Скачать фото к себе (${missing})`}</SubmitButton>
                          </form>
                        ) : r.total ? <span className="adm-chip ok">все фото у нас</span> : <span className="adm-muted">нет фото</span>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="adm-muted" style={{ marginTop: 12 }}>
        Всего своих копий: {mb(totalBytes)}. Папка на этом компьютере: <code>{mediaDir()}</code> — при переезде на сервер её нужно скопировать туда
        (или скачать фото заново кнопками выше). Причины ошибок (например, «сайт поставщика не ответил») видны в карточке товара — повторить можно этой же кнопкой.
      </p>
    </>
  );
}
