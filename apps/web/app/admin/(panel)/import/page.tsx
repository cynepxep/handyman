import { prisma } from "@handyman/db";
import { ensureDefaultSupplier, getRun, listRuns } from "@handyman/db/catalog-import";
import { requirePermission } from "@/lib/auth";
import { DoneView, FailedView, HistoryTable, PreviewView, RunningView, StartCard, SupplierCard } from "./views";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ run?: string; error?: string; ok?: string }> }) {
  const session = await requirePermission("import.run");
  const { run: runId, error, ok } = await searchParams;

  const supplier = await ensureDefaultSupplier();
  const [run, runs, cats] = await Promise.all([
    runId ? getRun(runId) : Promise.resolve(null),
    listRuns(supplier.id, 10),
    prisma.category.findMany({ where: { parentId: null }, orderBy: [{ sort: "asc" }, { nameUk: "asc" }], select: { id: true, nameUk: true } }),
  ]);

  return (
    <>
      <h1>Импорт каталога</h1>
      <p className="adm-lead">Загрузка товаров из XML-фида поставщика: новые товары добавляются, цены и наличие обновляются, ваши ручные правки не затираются.</p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      {run ? (
        <>
          <p><a className="adm-link" href="/admin/import">← К запуску и журналу</a></p>
          {run.status === "PREVIEW" && run.summary && run.report ? <PreviewView run={run} cats={cats} canApply /> : null}
          {run.status === "RUNNING" && <RunningView run={run} />}
          {run.status === "DONE" && <DoneView run={run} />}
          {run.status === "FAILED" && <FailedView run={run} />}
        </>
      ) : (
        <>
          <StartCard feedUrl={supplier.feedUrl} />
          <SupplierCard supplier={supplier} canEdit={(session.permissions as string[]).includes("suppliers.edit")} />
          <h2>Журнал запусков</h2>
          <HistoryTable runs={runs} />
        </>
      )}
    </>
  );
}
