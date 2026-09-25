import Link from "next/link";
import { prisma } from "@handyman/db";
import { UNSORTED_ID } from "@handyman/core/catalog";
import { isSearchStale, searchStats } from "@handyman/db/catalog-search";
import { requireStaff } from "@/lib/auth";
import { SubmitButton } from "./import/client-bits";
import { rebuildSearchAction } from "./search-actions";

export const dynamic = "force-dynamic";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const session = await requireStaff();
  const { error, ok } = await searchParams;
  const can = (p: string) => (session.permissions as string[]).includes(p);

  const [products, available, conflicts, unsorted, lastRun, visible, stats, stale] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { supplierAvailable: true } }),
    prisma.product.count({ where: { priceConflict: true } }),
    prisma.product.count({ where: { categoryId: UNSORTED_ID } }),
    prisma.importRun.findFirst({ where: { status: "DONE" }, orderBy: { finishedAt: "desc" } }),
    // в поиске — только видимые и не «Нераспределённые»
    prisma.product.count({ where: { visible: true, categoryId: { not: UNSORTED_ID } } }),
    searchStats(),
    isSearchStale(),
  ]);
  const newOrders = can("orders.view") ? await prisma.order.count({ where: { status: "NEW" } }) : 0;
  const ownStock = can("products.view") ? await prisma.product.count({ where: { stockItems: { some: { onHand: { gt: 0 } } } } }) : 0;
  const searchOk = stats.ok && !stale && stats.documents === visible;

  return (
    <>
      <h1>Handyman — админка</h1>
      <p className="adm-lead">
        Вы вошли как <strong>{session.name}</strong> ({session.username}), роль: <strong>{session.roleTitle}</strong>.
      </p>
      {error === "forbidden" && <p className="adm-flash err">У вашей роли нет прав на этот раздел.</p>}
      {error && error !== "forbidden" && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      {can("orders.view") && (
        <div className="adm-grid">
          <Link href="/admin/orders?status=NEW" className={newOrders ? "adm-stat warn link" : "adm-stat link"}>
            <b>{newOrders}</b>
            <small>новых заказов (статус «Новый»)</small>
          </Link>
        </div>
      )}

      {can("products.view") ? (
        <>
          <div className="adm-grid">
            <Link href="/admin/products" className="adm-stat link">
              <b>{products}</b>
              <small>товаров в каталоге</small>
            </Link>
            <Link href="/admin/products?avail=yes" className="adm-stat ok link">
              <b>{available}</b>
              <small>есть у поставщика</small>
            </Link>
            <Link href="/admin/products?avail=no" className="adm-stat link">
              <b>{products - available}</b>
              <small>«Под заказ»</small>
            </Link>
            <Link href="/admin/products?avail=own" className="adm-stat ok link">
              <b>{ownStock}</b>
              <small>есть на нашем складе</small>
            </Link>
            <Link href="/admin/products?flag=conflict" className={conflicts ? "adm-stat warn link" : "adm-stat link"}>
              <b>{conflicts}</b>
              <small>расхождений цен</small>
            </Link>
            <Link href={`/admin/products?cat=${UNSORTED_ID}`} className={unsorted ? "adm-stat warn link" : "adm-stat link"}>
              <b>{unsorted}</b>
              <small>нужно разложить по категориям</small>
            </Link>
          </div>
          <p className="adm-muted">Нажмите на плитку, чтобы открыть список этих товаров.</p>
        </>
      ) : null}
      <p className="adm-muted">
        {lastRun?.finishedAt ? `Последний импорт: ${lastRun.finishedAt.toLocaleString("ru-RU")}.` : "Каталог ещё не загружался."}
      </p>

      <div className="adm-card">
        <div className="adm-row" style={{ justifyContent: "space-between" }}>
          <div>
            <b>Поиск по каталогу</b>{" "}
            <span className={searchOk ? "adm-chip ok" : "adm-chip warn"}>
              {!stats.ok ? "не отвечает" : searchOk ? "в порядке" : "отстаёт от каталога"}
            </span>
            <div className="adm-muted">
              {stats.ok ? `В поиске ${stats.documents} из ${visible} видимых товаров.` : "Meilisearch недоступен. Запустите его командой pnpm infra:up."}
            </div>
          </div>
          {can("products.edit") && (
            <form action={rebuildSearchAction}>
              <SubmitButton pendingText="Пересобираю…">Пересобрать поиск</SubmitButton>
            </form>
          )}
        </div>
      </div>

      <h2>Разделы</h2>
      <ul style={{ paddingLeft: 20 }}>
        {can("orders.view") && (
          <li>
            <Link className="adm-link" href="/admin/orders">Заказы</Link> — заказы с сайта и «Купить в 1 клик»: статус, ТТН, заметки
          </li>
        )}
        {can("texts.edit") && (
          <li>
            <Link className="adm-link" href="/admin/site">Сайт</Link> — тексты, контакты, страницы, меню, оформление заказа (сумма предоплаты, реквизиты)
          </li>
        )}
        {can("import.run") && (
          <li>
            <Link className="adm-link" href="/admin/import">Импорт каталога</Link> — загрузка товаров из XML-фида поставщика
          </li>
        )}
        {can("products.view") && (
          <li>
            <Link className="adm-link" href="/admin/products">Товары</Link> — поиск, фильтры, правка, расхождения цен, остаток на нашем складе
          </li>
        )}
        {can("products.view") && (
          <li>
            <Link className="adm-link" href="/admin/categories">Категории</Link> — дерево каталога
          </li>
        )}
        {can("staff.manage") && (
          <li>
            <Link className="adm-link" href="/admin/roles">Роли и права</Link>
          </li>
        )}
      </ul>
      <p className="adm-muted">Клиенты, онлайн-оплата и Новая почта по справочнику появятся на следующих этапах.</p>
      {can("texts.edit") && <p className="adm-muted">Тексты можно менять и прямо на сайте: откройте сайт в этом же браузере и нажмите «✎ Редагувати тексти» внизу слева.</p>}
    </>
  );
}
