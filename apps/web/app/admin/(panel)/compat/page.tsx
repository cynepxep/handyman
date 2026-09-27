// Совместимость (шаг 5.6): список групп и создание новой. Товары добавляются на странице группы (по артикулам) или в карточке товара.
import Link from "next/link";
import { listCompatGroups } from "@handyman/db/storefront-plus";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { createGroupAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CompatPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requirePermission("products.view");
  const { ok, error } = await searchParams;
  const canEdit = session.permissions.includes("products.edit");
  const groups = await listCompatGroups();
  return (
    <>
      <h1>Совместимость</h1>
      <p className="adm-lead">
        Что к чему подходит. Группа — общий признак: «Диск 125 мм», «Акумулятор 18 В», «Патрон SDS-plus». В группе два списка: <b>инструменты</b>
        (УШМ 125 мм) и <b>расходники/аксессуары</b> (круги 125 мм). На сайте: у круга — блок «Підходить до» с болгарками, у болгарки — «Витратні
        матеріали та аксесуари», а покупатель, который заказывал болгарку, видит в списках фильтр «До мого інструменту».
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      {canEdit && (
        <form action={createGroupAction} className="adm-card adm-row" style={{ alignItems: "flex-end" }}>
          <div className="adm-field" style={{ margin: 0 }}><label htmlFor="g-label">Новая группа (укр.)</label><input id="g-label" name="label" className="adm-input" placeholder="Диск 125 мм" required /></div>
          <div className="adm-field" style={{ margin: 0 }}><label htmlFor="g-label-ru">Название (рус.)</label><input id="g-label-ru" name="labelRu" className="adm-input" placeholder="Диск 125 мм" /></div>
          <SubmitButton primary pendingText="…">Создать группу</SubmitButton>
        </form>
      )}

      {groups.length === 0 ? (
        <p className="adm-muted">Групп пока нет. Создайте первую — например, «Диск 125 мм».</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Группа</th><th className="num">Инструментов</th><th className="num">Расходников</th><th>Код</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td><Link className="adm-link" href={`/admin/compat/${g.id}`}>{g.label}</Link>{g.labelRu && g.labelRu !== g.label ? <span className="adm-muted"> · {g.labelRu}</span> : null}</td>
                  <td className="num">{g.hosts}</td>
                  <td className="num">{g.accessories}</td>
                  <td className="adm-muted">{g.key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
