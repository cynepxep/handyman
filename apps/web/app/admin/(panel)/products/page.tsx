import Link from "next/link";
import type { Prisma } from "@handyman/db";
import { prisma } from "@handyman/db";
import { UNSORTED_ID } from "@handyman/core/catalog";
import { requirePermission } from "@/lib/auth";
import { PAGE_SIZE, loadCategories, money } from "@/lib/catalog";
import { SelectAll, SubmitButton } from "../import/client-bits";
import { markProductsAction, moveProductsAction } from "./actions";

export const dynamic = "force-dynamic";

type Params = { q?: string; cat?: string; avail?: string; flag?: string; page?: string };

function href(p: Params, over: Partial<Params>): string {
  const merged: Params = { ...p, ...over };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/admin/products${s ? `?${s}` : ""}`;
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Params & { ok?: string; error?: string }> }) {
  const session = await requirePermission("products.view");
  const canEdit = (session.permissions as string[]).includes("products.edit");
  const { ok, error, ...p } = await searchParams;
  const page = Math.max(1, Number(p.page) || 1);
  const cats = await loadCategories();

  const and: Prisma.ProductWhereInput[] = [];
  const q = p.q?.trim();
  if (q) {
    and.push({
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { articleCode: { contains: q, mode: "insensitive" } },
        { nameUk: { contains: q, mode: "insensitive" } },
        { nameRu: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (p.cat) and.push({ categoryId: { in: cats.byId.has(p.cat) ? cats.subtreeIds(p.cat) : [p.cat] } });
  if (p.avail === "yes") and.push({ supplierAvailable: true });
  if (p.avail === "no") and.push({ supplierAvailable: false });
  if (p.avail === "own") and.push({ stockItems: { some: { onHand: { gt: 0 } } } });
  if (p.flag === "conflict") and.push({ priceConflict: true });
  if (p.flag === "hidden") and.push({ visible: false });
  if (p.flag === "locked") and.push({ fieldLocks: { some: {} } });
  if (p.flag === "missing") and.push({ missingFromFeedSince: { not: null } });
  if (p.flag === "hit") and.push({ isHit: true });
  if (p.flag === "new") and.push({ isNew: true });
  const where: Prisma.ProductWhereInput = and.length ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ nameUk: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { images: { orderBy: { sort: "asc" }, take: 1, select: { url: true, localUrl: true } }, stockItems: { select: { onHand: true } }, _count: { select: { fieldLocks: true } } },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1>Товары</h1>
      <p className="adm-lead">Найдено: {total}. Нажмите на название, чтобы открыть карточку и поправить товар.</p>

      <form method="get" className="adm-card">
        <div className="adm-row">
          <input name="q" defaultValue={p.q ?? ""} className="adm-input" style={{ flex: "1 1 240px" }} placeholder="Название или артикул" aria-label="Поиск" />
          <select name="cat" defaultValue={p.cat ?? ""} className="adm-select" aria-label="Категория">
            <option value="">Все категории</option>
            {cats.flat.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <select name="avail" defaultValue={p.avail ?? ""} className="adm-select" aria-label="Наличие">
            <option value="">Любое наличие</option>
            <option value="yes">Есть у поставщика</option>
            <option value="no">Под заказ</option>
            <option value="own">Есть на нашем складе (Одесса)</option>
          </select>
          <select name="flag" defaultValue={p.flag ?? ""} className="adm-select" aria-label="Особые отметки">
            <option value="">Все товары</option>
            <option value="conflict">Расхождение цен</option>
            <option value="locked">Есть ручные правки</option>
            <option value="hidden">Скрытые с сайта</option>
            <option value="missing">Пропали из фида</option>
            <option value="hit">Хиты</option>
            <option value="new">Новинки</option>
          </select>
          <button type="submit" className="adm-btn primary">Найти</button>
          <Link href="/admin/products" className="adm-btn">Сбросить</Link>
        </div>
      </form>

      {p.cat === UNSORTED_ID && (
        <p className="adm-flash ok" style={{ borderColor: "var(--adm-warn)", color: "inherit", background: "var(--adm-soft)" }}>
          Это товары, которые не подошли ни под одну категорию из фида. Покупателям они не показываются. Отметьте товары галочками, ниже списка выберите
          категорию и нажмите «Перенести».
        </p>
      )}
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <form action={moveProductsAction}>
        <input type="hidden" name="back" value={href(p, {})} />
        <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              {canEdit && <th style={{ width: 32 }}><SelectAll name="ids" /></th>}
              <th aria-label="Фото" />
              <th>Товар</th>
              <th className="adm-hide-sm">Категория</th>
              <th className="num">Цена</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {canEdit && (
                  <td>
                    <input type="checkbox" name="ids" value={r.id} aria-label={`Выбрать ${r.sku}`} />
                  </td>
                )}
                <td style={{ width: 56 }}>
                  {r.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- фото по ссылкам поставщика, оптимизация — на этапе картинок
                    <img src={r.images[0].localUrl ?? r.images[0].url} alt="" loading="lazy" width={44} height={44} style={{ objectFit: "contain", borderRadius: 6 }} />
                  ) : null}
                </td>
                <td>
                  <a className="adm-link" href={`/admin/products/${r.id}`}>{r.nameUk}</a>
                  <div className="adm-muted">{r.sku}</div>
                </td>
                <td className="adm-muted adm-hide-sm">{cats.byId.get(r.categoryId)?.nameUk ?? r.categoryId}</td>
                <td className="num">
                  {money(r.price)}
                  {r.oldPrice ? <div className="adm-muted"><s>{money(r.oldPrice)}</s></div> : null}
                </td>
                <td>
                  <div className="adm-row" style={{ gap: 4 }}>
                    {(() => {
                      const own = r.stockItems.reduce((a, x) => a + x.onHand, 0);
                      return own > 0 ? <span className="adm-chip ok">на складе: {own} шт.</span> : null;
                    })()}
                    <span className={r.supplierAvailable ? "adm-chip ok" : "adm-chip"}>{r.supplierAvailable ? "Есть у поставщика" : "Под заказ"}</span>
                    {r.isHit && <span className="adm-chip warn">хит</span>}
                    {r.isNew && <span className="adm-chip warn">новинка</span>}
                    {r.priceConflict && <span className="adm-chip warn">расхождение цен</span>}
                    {r._count.fieldLocks > 0 && <span className="adm-chip">правки: {r._count.fieldLocks}</span>}
                    {!r.visible && <span className="adm-chip bad">скрыт</span>}
                    {r.missingFromFeedSince && <span className="adm-chip">нет в фиде</span>}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="adm-muted">Ничего не найдено.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        {canEdit && rows.length > 0 && (
          <div className="adm-card">
            <div className="adm-row">
              <b>Отмеченные товары:</b>
              <select name="categoryId" className="adm-select" aria-label="Перенести в категорию" defaultValue="">
                <option value="" disabled>Перенести в категорию…</option>
                {cats.flat.filter((c) => c.id !== UNSORTED_ID).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <SubmitButton pendingText="Переношу…">Перенести</SubmitButton>
            </div>
            <div className="adm-row" style={{ marginTop: 8 }}>
              <b>Отметки:</b>
              <button type="submit" className="adm-btn" formAction={markProductsAction.bind(null, "hit:on")}>Сделать хитом</button>
              <button type="submit" className="adm-btn" formAction={markProductsAction.bind(null, "hit:off")}>Снять «хит»</button>
              <button type="submit" className="adm-btn" formAction={markProductsAction.bind(null, "new:on")}>Сделать новинкой</button>
              <button type="submit" className="adm-btn" formAction={markProductsAction.bind(null, "new:off")}>Снять «новинку»</button>
            </div>
            <p className="adm-muted" style={{ marginTop: 6 }}>
              Перенесённая категория защищается от импорта: он её не вернёт назад. Галочка в шапке таблицы отмечает все товары на странице.
            </p>
          </div>
        )}
      </form>

      {pages > 1 && (
        <div className="adm-pager">
          {page > 1 && <a className="adm-btn" href={href(p, { page: String(page - 1) })}>← Назад</a>}
          <span className="adm-muted">Страница {page} из {pages}</span>
          {page < pages && <a className="adm-btn" href={href(p, { page: String(page + 1) })}>Дальше →</a>}
        </div>
      )}
    </>
  );
}
