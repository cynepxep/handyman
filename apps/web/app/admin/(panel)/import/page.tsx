import Link from "next/link";
import { prisma } from "@handyman/db";
import { ensureDefaultSupplier, getRun, listRuns } from "@handyman/db/catalog-import";
import { undoInfo, type UndoReport } from "@handyman/db/import-undo";
import { listSuppliers } from "@handyman/db/suppliers";
import { loadMenuConfig } from "@handyman/db/site-content";
import { UNSORTED_ID, lostCategories, type CatNode } from "@handyman/core/catalog";
import { requirePermission } from "@/lib/auth";
import { loadCategories } from "@/lib/catalog";
import { DoneView, FailedView, HistoryTable, PreviewView, RunningView, RunTools, StartCard, SupplierPicker } from "./views";

export const dynamic = "force-dynamic";

/** Сколько товаров поставщика лежит в разделах, которых нет в меню сайта (их не найти через «Каталог»). */
async function lostOfSupplier(supplierId: string) {
  const [cfg, cats, counts] = await Promise.all([
    loadMenuConfig(),
    loadCategories(),
    prisma.product.groupBy({ by: ["categoryId"], where: { visible: true, supplierId }, _count: { _all: true } }),
  ]);
  const direct = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const nodes: CatNode[] = [...cats.byId.values()].map((n) => ({ id: n.id, parentId: n.parentId }));
  const lost = lostCategories(nodes, direct, cfg);
  return { categories: lost.length, products: lost.reduce((a, l) => a + l.count, 0), unsorted: direct.get(UNSORTED_ID) ?? 0 };
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ run?: string; supplier?: string; error?: string; ok?: string }> }) {
  const session = await requirePermission("import.run");
  const canEditSuppliers = (session.permissions as string[]).includes("suppliers.edit");
  const { run: runId, supplier: supplierParam, error, ok } = await searchParams;

  const fallback = await ensureDefaultSupplier();
  const [run, runs, cats, suppliers] = await Promise.all([
    runId ? getRun(runId) : Promise.resolve(null),
    listRuns(undefined, 15),
    prisma.category.findMany({ where: { parentId: null }, orderBy: [{ sort: "asc" }, { nameUk: "asc" }], select: { id: true, nameUk: true } }),
    listSuppliers(),
  ]);
  const current = suppliers.find((s) => s.id === supplierParam) ?? suppliers.find((s) => s.active) ?? suppliers.find((s) => s.id === fallback.id)!;

  if (run) {
    const [brands, info, lost] = await Promise.all([
      prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      undoInfo(run.id),
      run.status === "DONE" && !run.undoneAt ? lostOfSupplier(run.supplierId) : Promise.resolve(null),
    ]);
    return (
      <>
        <h1>Импорт каталога · {run.supplier.name}</h1>
        {error && <p className="adm-flash err" role="alert">{error}</p>}
        {ok && <p className="adm-flash ok">{ok}</p>}
        <p><Link className="adm-link" href={`/admin/import?supplier=${run.supplierId}`}>← К запуску и журналу</Link></p>
        {run.undoneAt ? (
          <UndoneNote at={run.undoneAt} by={run.undoneBy} report={run.undoReport as UndoReport | null} />
        ) : (
          <>
            {run.status === "PREVIEW" && run.summary && run.report ? <PreviewView run={run} cats={cats} brands={brands} supplierName={run.supplier.name} canApply /> : null}
            {run.status === "RUNNING" && <RunningView run={run} />}
            {run.status === "DONE" && <DoneView run={run} lost={lost} />}
            {run.status === "FAILED" && <FailedView run={run} />}
          </>
        )}
        <RunTools runId={run.id} undone={!!run.undoneAt} info={info} />
      </>
    );
  }

  return (
    <>
      <h1>Импорт каталога</h1>
      <p className="adm-lead">
        Загрузка товаров из XML-фида поставщика: новые товары добавляются, цены и наличие обновляются, ваши ручные правки не затираются.
        Каталог каждого поставщика загружается отдельно — сначала выберите поставщика.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      <SupplierPicker suppliers={suppliers} currentId={current.id} canEdit={canEditSuppliers} />
      <StartCard supplier={current} canEdit={canEditSuppliers} />
      <h2>Журнал загрузок</h2>
      <p className="adm-muted">Откройте загрузку, чтобы посмотреть итог или отменить её (кнопка «Отменить загрузку» внизу страницы загрузки).</p>
      <HistoryTable runs={runs} />
    </>
  );
}

function UndoneNote({ at, by, report }: { at: Date; by: string | null; report: UndoReport | null }) {
  return (
    <div className="adm-card">
      <h2 style={{ marginTop: 0 }}>Загрузка отменена</h2>
      <p>
        {at.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}{by ? ` (${by})` : ""}.
        {report ? (
          <>
            {" "}Удалено товаров: {report.deleted}
            {report.hidden ? `, скрыто с сайта (есть заказы, склад или отзывы): ${report.hidden}` : ""}
            {report.restored ? `, возвращено прежних значений: ${report.restored}` : ""}
            {report.categoriesRemoved ? `, убрано пустых категорий: ${report.categoriesRemoved}` : ""}
            {report.brandsRemoved ? `, убрано новых брендов без товаров: ${report.brandsRemoved}` : ""}.
          </>
        ) : null}
      </p>
      {report?.keptChanged ? (
        <p className="adm-muted">Не тронуты {report.keptChanged} полей, которые после загрузки уже меняли вручную или другой загрузкой.</p>
      ) : null}
      {report?.legacy ? (
        <p className="adm-flash err" style={{ background: "var(--adm-soft)", color: "inherit" }}>
          Это была загрузка до появления отмены.
          {report.notRestorable ? ` Цены и другие поля, которые она поменяла у уже существовавших товаров (${report.notRestorable}), вернуть нельзя.` : ""}
          {report.restored ? " Отметка «нет в фиде» снята, но наличие у поставщика вернётся со следующей загрузкой его каталога — запустите её ещё раз." : ""}
        </p>
      ) : null}
    </div>
  );
}
