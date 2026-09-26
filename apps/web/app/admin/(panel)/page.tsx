import Link from "next/link";
import { prisma } from "@handyman/db";
import { UNSORTED_ID } from "@handyman/core/catalog";
import { isSearchStale, searchStats } from "@handyman/db/catalog-search";
import { dashboard } from "@handyman/db/reports";
import { ORDER_STATUS_RU, periodRange } from "@handyman/core/shop";
import { requireStaff } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { SubmitButton } from "./import/client-bits";
import { rebuildSearchAction } from "./search-actions";
import { statusChip } from "./orders/status-chip";
import { Stat } from "./reports/bits";

export const dynamic = "force-dynamic";

const since = (d: Date) => {
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  return min < 60 ? `${min} мин назад` : min < 1440 ? `${Math.round(min / 60)} ч назад` : `${Math.round(min / 1440)} дн назад`;
};

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; period?: string }> }) {
  const session = await requireStaff();
  const sp = await searchParams;
  const can = (p: string) => (session.permissions as string[]).includes(p);
  const fin = can("finance.view");
  const p = periodRange({ period: sp.period === "today" || sp.period === "30d" ? sp.period : sp.period === "7d" ? "7d" : "today" });

  const [dash, products, available, conflicts, unsorted, lastRun, visible, stats, stale] = await Promise.all([
    can("orders.view") ? dashboard(p) : null,
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
  const searchOk = stats.ok && !stale && stats.documents === visible;
  const s = dash?.sales;

  return (
    <>
      <h1>Handyman — админка</h1>
      <p className="adm-lead">
        Вы вошли как <strong>{session.name}</strong> ({session.username}), роль: <strong>{session.roleTitle}</strong>.
      </p>
      {sp.error === "forbidden" && <p className="adm-flash err">У вашей роли нет прав на этот раздел.</p>}
      {sp.error && sp.error !== "forbidden" && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}

      {dash && s && (
        <>
          <nav className="adm-tabs" aria-label="Период">
            {([["today", "Сегодня"], ["7d", "7 дней"], ["30d", "30 дней"]] as const).map(([k, l]) => (
              <Link key={k} href={k === "today" ? "/admin" : `/admin?period=${k}`} aria-current={p.kind === k ? "page" : undefined}>{l}</Link>
            ))}
            <Link href={`/admin/reports?period=${p.kind}`}>Подробнее — «Отчёты» →</Link>
          </nav>
          <div className="adm-grid">
            {fin && <Stat value={money(s.cur.revenue)} label="продажи" cur={s.cur.revenue} prev={s.prev.revenue} tone="ok" />}
            <Stat value={s.cur.sold} label="заказов" cur={s.cur.sold} prev={s.prev.sold} />
            {fin && <Stat value={s.cur.avg ? money(s.cur.avg) : "—"} label="средний чек" cur={s.cur.avg} prev={s.prev.avg} />}
            <Stat value={s.cur.newClients} label="новых покупателей" cur={s.cur.newClients} prev={s.prev.newClients} />
            <Stat value={s.cur.repeatClients} label="повторных покупок" cur={s.cur.repeatClients} prev={s.prev.repeatClients} />
            <Stat value={s.cur.lost} label="отмен и возвратов" cur={s.cur.lost} prev={s.prev.lost} invert tone={s.cur.lost ? "warn" : ""} />
            {fin && <Stat value="→" label="прибыль — в «Финансах»" href="/admin/finance" />}
          </div>
          <p className="adm-muted">Стрелки — сравнение с предыдущим таким же периодом. Тестовые заказы не считаются.</p>

          <div className="adm-grid2">
            <section className="adm-card">
              <h2 style={{ marginTop: 0 }}>Требуют действия</h2>
              {dash.action.length ? (
                <ul className="adm-msgs">
                  {dash.action.map((o) => (
                    <li key={o.id}>
                      <Link className="adm-link" href={`/admin/orders/${o.id}`}><b>{o.no}</b></Link> <span className={statusChip(o.status)}>{ORDER_STATUS_RU[o.status]}</span>
                      <div className="adm-muted" style={{ fontSize: 13 }}>{o.recipientName ?? "—"} · {since(o.createdAt)}{fin ? ` · ${money(o.total)}` : ""}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="adm-muted" style={{ margin: 0 }}>Все заказы в работе — ничего не ждёт. 👍</p>}
              <p style={{ marginBottom: 0 }}><Link className="adm-link" href="/admin/orders?status=action">Все, что требуют действия →</Link></p>
            </section>
            <section className="adm-card">
              <h2 style={{ marginTop: 0 }}>Заканчиваются на складе</h2>
              {dash.low.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {dash.low.map((r) => <li key={r.productId}><Link className="adm-link" href={`/admin/stock?q=${encodeURIComponent(r.sku)}`}>{r.name}</Link> <span className="adm-muted">— доступно {r.available}, минимум {r.minStock}</span></li>)}
                </ul>
              ) : <p className="adm-muted" style={{ margin: 0 }}>Ничего не заканчивается (или минимальные остатки не заданы в «Склад»).</p>}
              {dash.overdueTasks > 0 && <p style={{ marginBottom: 0 }}><Link className="adm-link" href="/admin/tasks?tab=all"><span className="adm-chip bad">просроченных задач: {dash.overdueTasks}</span></Link></p>}
            </section>
          </div>
        </>
      )}

      {can("products.view") ? (
        <>
          <h2>Каталог</h2>
          <div className="adm-grid">
            <Link href="/admin/products" className="adm-stat link"><b>{products}</b><small>товаров в каталоге</small></Link>
            <Link href="/admin/products?avail=yes" className="adm-stat ok link"><b>{available}</b><small>есть у поставщика</small></Link>
            <Link href="/admin/products?avail=no" className="adm-stat link"><b>{products - available}</b><small>«Под заказ»</small></Link>
            <Link href="/admin/products?flag=conflict" className={conflicts ? "adm-stat warn link" : "adm-stat link"}><b>{conflicts}</b><small>расхождений цен</small></Link>
            <Link href={`/admin/products?cat=${UNSORTED_ID}`} className={unsorted ? "adm-stat warn link" : "adm-stat link"}><b>{unsorted}</b><small>нужно разложить по категориям</small></Link>
          </div>
          <p className="adm-muted">
            {lastRun?.finishedAt ? `Последний импорт: ${lastRun.finishedAt.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })}.` : "Каталог ещё не загружался."}{" "}
            Полная статистика каталога — «Отчёты → Каталог».
          </p>
        </>
      ) : null}

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
      {can("texts.edit") && <p className="adm-muted">Тексты можно менять и прямо на сайте: откройте сайт в этом же браузере и нажмите «✎ Редагувати тексти» внизу слева.</p>}
    </>
  );
}
