import Link from "next/link";
import { prisma } from "@handyman/db";
import { listMoves, listStockDocs } from "@handyman/db/stock";
import { MOVE_REASON_RU } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";

export const dynamic = "force-dynamic";

type Params = { product?: string; reason?: string; doc?: string; page?: string; ok?: string };

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const DOC_RU: Record<string, string> = { receiving: "Приход", inventory: "Инвентаризация" };

function href(p: Params, over: Partial<Params>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ok: "", ...over })) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/admin/stock/moves${s ? `?${s}` : ""}`;
}

export default async function MovesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermission("stock.edit");
  const p = await searchParams;
  const [{ total, page, pages, rows }, docs, product, doc] = await Promise.all([
    listMoves({ productId: p.product, reason: p.reason && MOVE_REASON_RU[p.reason] ? p.reason : undefined, docId: p.doc, page: Number(p.page) || 1 }),
    listStockDocs(15),
    p.product ? prisma.product.findUnique({ where: { id: p.product }, select: { nameUk: true, sku: true } }) : null,
    p.doc ? prisma.stockDoc.findUnique({ where: { id: p.doc } }) : null,
  ]);

  return (
    <>
      <p><Link className="adm-link" href="/admin/stock">← Склад</Link></p>
      <h1>Журнал движений</h1>
      <p className="adm-lead">Каждое изменение остатка: приход, продажа, резерв под заказ и его снятие, возврат, инвентаризация, ручная правка — кто и когда.</p>
      {p.ok && <p className="adm-flash ok">{p.ok}</p>}
      {(product || doc) && (
        <p>
          Показано: {product && <b>{product.nameUk} ({product.sku})</b>}
          {doc && <b>{DOC_RU[doc.kind] ?? doc.kind} № {doc.seq} от {when(doc.createdAt)}{doc.supplier ? `, ${doc.supplier}` : ""}{doc.note ? ` — ${doc.note}` : ""} ({doc.who})</b>}
          {" "}<Link className="adm-link" href="/admin/stock/moves">показать всё</Link>
        </p>
      )}
      <nav className="adm-tabs" aria-label="Причина">
        <Link href={href(p, { reason: "", page: "" })} aria-current={!p.reason ? "page" : undefined}>Все</Link>
        {Object.entries(MOVE_REASON_RU).filter(([k]) => k !== "IMPORT").map(([k, v]) => (
          <Link key={k} href={href(p, { reason: k, page: "" })} aria-current={p.reason === k ? "page" : undefined}>{v}</Link>
        ))}
      </nav>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Когда</th><th>Товар</th><th>Что</th><th className="num">Шт.</th><th className="adm-hide-sm">Основание</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{when(m.createdAt)}<div className="adm-muted">{m.who ?? "сайт"}</div></td>
                <td>
                  <Link className="adm-link" href={href({}, { product: m.stockItem.product.id })}>{m.stockItem.product.nameUk}</Link>
                  <div className="adm-muted">{m.stockItem.product.sku} · {m.stockItem.warehouse.name}</div>
                </td>
                <td>{MOVE_REASON_RU[m.reason] ?? m.reason}{m.unitCost != null && <div className="adm-muted">по {money(m.unitCost)}</div>}</td>
                <td className="num"><b>{m.delta > 0 ? `+${m.delta}` : m.delta}</b></td>
                <td className="adm-hide-sm">
                  {m.orderNo && m.refOrderId && <Link className="adm-link" href={`/admin/orders/${m.refOrderId}`}>заказ {m.orderNo}</Link>}
                  {m.doc && m.docId && <Link className="adm-link" href={href({}, { doc: m.docId })}>{DOC_RU[m.doc.kind] ?? m.doc.kind} № {m.doc.seq}</Link>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="adm-muted">Движений нет.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="adm-muted">Всего: {total}</p>
      {pages > 1 && (
        <div className="adm-pager">
          {page > 1 && <Link className="adm-btn" href={href(p, { page: String(page - 1) })}>← Назад</Link>}
          <span className="adm-muted">Страница {page} из {pages}</span>
          {page < pages && <Link className="adm-btn" href={href(p, { page: String(page + 1) })}>Дальше →</Link>}
        </div>
      )}

      <h2>Последние документы</h2>
      {docs.length ? (
        <ul>
          {docs.map((d) => (
            <li key={d.id}>
              <Link className="adm-link" href={href({}, { doc: d.id })}>{DOC_RU[d.kind] ?? d.kind} № {d.seq}</Link>{" "}
              <span className="adm-muted">{when(d.createdAt)} · {d.who}{d.supplier ? ` · ${d.supplier}` : ""} · строк: {d._count.movements}</span>
            </li>
          ))}
        </ul>
      ) : <p className="adm-muted">Документов пока нет.</p>}
    </>
  );
}
