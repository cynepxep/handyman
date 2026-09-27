// Группа совместимости (шаг 5.6): название на двух языках, инструменты и расходники (добавить по артикулам, убрать), удалить группу.
import Link from "next/link";
import { notFound } from "next/navigation";
import { compatGroupDetail } from "@handyman/db/storefront-plus";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { addSkusAction, deleteGroupAction, removeProductAction, updateGroupAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CompatGroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requirePermission("products.view");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const g = await compatGroupDetail(id);
  if (!g) notFound();
  const canEdit = session.permissions.includes("products.edit");

  const list = (role: "HOST" | "ACCESSORY", rows: typeof g.hosts, title: string, hint: string) => (
    <section className="adm-card">
      <h2 style={{ marginTop: 0 }}>{title} ({rows.length})</h2>
      <p className="adm-muted" style={{ marginTop: 0 }}>{hint}</p>
      {rows.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><Link className="adm-link" href={`/admin/products/${p.id}`}>{p.nameUk}</Link> <span className="adm-muted">{p.sku}</span>{!p.visible && <span className="adm-chip bad" style={{ marginLeft: 6 }}>скрыт</span>}</td>
                  <td className="num">{canEdit && (
                    <form action={removeProductAction}>
                      <input type="hidden" name="id" value={g.id} /><input type="hidden" name="productId" value={p.id} /><input type="hidden" name="role" value={role} />
                      <SubmitButton pendingText="…">Убрать</SubmitButton>
                    </form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <form action={addSkusAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={g.id} /><input type="hidden" name="role" value={role} />
          <div className="adm-field">
            <label htmlFor={`skus-${role}`}>Добавить по артикулам (через пробел, запятую или с новой строки)</label>
            <textarea id={`skus-${role}`} name="skus" className="adm-input wide" rows={3} placeholder="12345 12346 12347" />
          </div>
          <SubmitButton pendingText="Добавляю…">Добавить</SubmitButton>
        </form>
      )}
    </section>
  );

  return (
    <>
      <p><Link className="adm-link" href="/admin/compat">← Все группы</Link></p>
      <h1>{g.label}</h1>
      <p className="adm-muted">Код группы: {g.key}</p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      {canEdit && (
        <form action={updateGroupAction} className="adm-card adm-row" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="id" value={g.id} />
          <div className="adm-field" style={{ margin: 0 }}><label htmlFor="g-label">Название (укр.)</label><input id="g-label" name="label" className="adm-input" defaultValue={g.label} required /></div>
          <div className="adm-field" style={{ margin: 0 }}><label htmlFor="g-label-ru">Название (рус.)</label><input id="g-label-ru" name="labelRu" className="adm-input" defaultValue={g.labelRu ?? ""} /></div>
          <SubmitButton pendingText="…">Сохранить</SubmitButton>
        </form>
      )}

      {list("HOST", g.hosts, "Инструменты", "К ним подходят расходники этой группы. На сайте у них — блок «Витратні матеріали та аксесуари».")}
      {list("ACCESSORY", g.accessories, "Расходники и аксессуары", "Подходят к инструментам этой группы. На сайте у них — блок «Підходить до».")}

      {canEdit && (
        <form action={deleteGroupAction} className="adm-card">
          <input type="hidden" name="id" value={g.id} />
          <p className="adm-muted" style={{ marginTop: 0 }}>Удаление группы не удаляет товары — только связи «что к чему подходит».</p>
          <SubmitButton pendingText="Удаляю…">Удалить группу</SubmitButton>
        </form>
      )}
    </>
  );
}
