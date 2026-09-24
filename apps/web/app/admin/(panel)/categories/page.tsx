import Link from "next/link";
import { prisma } from "@handyman/db";
import { UNSORTED_ID } from "@handyman/core/catalog";
import { requirePermission } from "@/lib/auth";
import { loadCategories, type CategoryNode } from "@/lib/catalog";
import { SubmitButton } from "../import/client-bits";
import { saveCategoryAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requirePermission("products.view");
  const { ok, error } = await searchParams;
  const canEdit = (session.permissions as string[]).includes("products.edit");
  const cats = await loadCategories();
  const direct = new Map((await prisma.product.groupBy({ by: ["categoryId"], _count: { _all: true } })).map((g) => [g.categoryId, g._count._all]));
  const unsorted = direct.get(UNSORTED_ID) ?? 0;

  const total = (n: CategoryNode): number => (direct.get(n.id) ?? 0) + n.children.reduce((s, c) => s + total(c), 0);

  const Row = ({ n, depth }: { n: CategoryNode; depth: number }) => {
    const all = total(n);
    const own = direct.get(n.id) ?? 0;
    const system = n.id === UNSORTED_ID;
    return (
      <div style={{ marginLeft: depth * 18 }}>
        <form action={saveCategoryAction} className="adm-cat-row" style={{ borderTop: depth === 0 ? "1px solid var(--adm-line)" : 0 }}>
          <input type="hidden" name="id" value={n.id} />
          <div className="adm-map-name">
            <Link className="adm-link" href={`/admin/products?cat=${encodeURIComponent(n.id)}`}>{n.nameUk}</Link>{" "}
            {system && <span className="adm-chip warn">системная</span>}
            <div className="adm-muted">
              всего товаров: {all}
              {n.children.length > 0 ? ` (прямо в этой категории: ${own}, в подкатегориях: ${all - own})` : ""}
            </div>
          </div>
          {canEdit ? (
            <>
              <input name="nameUk" defaultValue={n.nameUk} className="adm-input" placeholder="Название (укр.)" aria-label={`Название по-украински: ${n.nameUk}`} />
              <input name="nameRu" defaultValue={n.nameRu} className="adm-input" placeholder="Название (рус.)" aria-label={`Название по-русски: ${n.nameUk}`} />
              <input name="sort" defaultValue={n.sort} className="adm-input" inputMode="numeric" placeholder="Порядок" aria-label={`Порядок в меню: ${n.nameUk}`} />
              <SubmitButton pendingText="…">Сохранить</SubmitButton>
            </>
          ) : null}
        </form>
        {n.children.length > 0 && depth >= 1 ? (
          <>{n.children.map((c) => <Row key={c.id} n={c} depth={depth + 1} />)}</>
        ) : n.children.length > 0 ? (
          <details style={{ marginLeft: 18 }}>
            <summary className="adm-muted">Подкатегории ({n.children.length})</summary>
            {n.children.map((c) => <Row key={c.id} n={c} depth={1} />)}
          </details>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <h1>Категории</h1>
      <p className="adm-lead">
        Так покупатель будет искать товары на сайте: сначала большой раздел, потом подраздел. Категории появляются сами при импорте
        из структуры фида поставщика. Здесь их можно переименовать и расставить по порядку. Импорт ваши названия не перезапишет.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      {unsorted > 0 && (
        <div className="adm-card" style={{ borderColor: "var(--adm-warn)" }}>
          <b>Нужно разложить по категориям: {unsorted}.</b> Эти товары не подошли ни под одну категорию из фида, покупателям они пока не видны.{" "}
          <Link className="adm-link" href={`/admin/products?cat=${UNSORTED_ID}`}>Открыть и разложить</Link>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-cat-head" aria-hidden="true">
          <div>Категория и сколько в ней товаров</div>
          <div>Название (укр.)</div>
          <div>Название (рус.)</div>
          <div title="Чем меньше число, тем выше категория в списке. Например: 0, 1, 2…">Порядок в меню</div>
          <div />
        </div>
        {cats.roots.map((r) => <Row key={r.id} n={r} depth={0} />)}
        <p className="adm-muted" style={{ marginTop: 10 }}>
          «Порядок в меню» — число: чем меньше, тем выше категория в списке (0, 1, 2…). Новые категории из фида стоят внизу (100).
        </p>
      </div>
    </>
  );
}
