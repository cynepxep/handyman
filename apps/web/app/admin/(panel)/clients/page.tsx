import Link from "next/link";
import { listClients } from "@handyman/db/clients";
import { TIER_KEYS, TIER_RU, formatPhone, type TierKey } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { tierChip } from "./tier-chip";

export const dynamic = "force-dynamic";

type Params = { q?: string; tier?: string; sort?: string; page?: string };

const SORT_RU: Record<string, string> = { recent: "Сначала новые", spent: "Больше покупок (₴)", orders: "Больше заказов", name: "По имени" };

function href(p: Params, over: Partial<Params>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...over })) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/admin/clients${s ? `?${s}` : ""}`;
}

const day = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv" });

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requirePermission("clients.view");
  const p = await searchParams;
  const { total, page, pages, sort, rows } = await listClients({ q: p.q, tier: p.tier, sort: p.sort, page: Number(p.page) || 1 });

  return (
    <>
      <h1>Клиенты</h1>
      <p className="adm-lead">
        Покупатель узнаётся по номеру телефона: все его заказы с сайта (а позже — из Telegram) собираются в одну карточку. «Сумма покупок» — только выполненные
        заказы, тестовые не считаются. Нажмите на имя, чтобы открыть карточку: заказы, заметка, личная скидка, уровень.
      </p>
      {session.permissions.includes("settings.edit") && (
        <p><Link className="adm-link" href="/admin/clients/levels">Уровни скидок (Старт / Майстер / Профі / Легенда / Опт) →</Link></p>
      )}
      <form method="get" className="adm-card">
        <div className="adm-row">
          <input name="q" defaultValue={p.q ?? ""} className="adm-input" style={{ flex: "1 1 240px" }} placeholder="Телефон (можно часть), имя или почта" aria-label="Поиск клиента" />
          <select name="tier" defaultValue={p.tier ?? ""} className="adm-select" aria-label="Уровень">
            <option value="">Все уровни</option>
            {TIER_KEYS.map((t) => <option key={t} value={t}>{TIER_RU[t]}</option>)}
          </select>
          <select name="sort" defaultValue={sort} className="adm-select" aria-label="Сортировка">
            {Object.entries(SORT_RU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button type="submit" className="adm-btn primary">Найти</button>
          <Link href="/admin/clients" className="adm-btn">Сбросить</Link>
        </div>
      </form>
      <p className="adm-muted">Найдено: {total}</p>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Клиент</th>
              <th className="adm-hide-sm">Уровень / скидка</th>
              <th className="num">Заказов</th>
              <th className="num">Сумма покупок</th>
              <th className="adm-hide-sm">Последний заказ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link className="adm-link" href={`/admin/clients/${c.id}`}><b>{c.name || "Без имени"}</b></Link>
                  <div className="adm-muted">
                    {c.phone ? formatPhone(c.phone) : c.username ? `@${c.username}` : c.email ?? "—"}
                    {c.tgId != null && <> · Telegram</>}
                  </div>
                  {c.note && <div className="adm-muted" style={{ fontSize: 13 }}>📝 {c.note.length > 60 ? `${c.note.slice(0, 60)}…` : c.note}</div>}
                </td>
                <td className="adm-hide-sm">
                  <span className={tierChip(c.tier as TierKey)}>{TIER_RU[c.tier as TierKey] ?? c.tier}</span>
                  {c.manualDiscountPct ? <> <span className="adm-chip ok">личная {c.manualDiscountPct} %</span></> : null}
                </td>
                <td className="num">{c._count.orders}</td>
                <td className="num">{money(c.spent)}</td>
                <td className="adm-hide-sm">{c.orders[0] ? <>{c.orders[0].no}<div className="adm-muted">{day(c.orders[0].createdAt)}</div></> : <span className="adm-muted">—</span>}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="adm-muted">{p.q || p.tier ? "Никого не нашлось — попробуйте другой запрос." : "Клиентов пока нет: они появятся с первым заказом."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="adm-pager">
          {page > 1 && <Link className="adm-btn" href={href(p, { page: String(page - 1) })}>← Назад</Link>}
          <span className="adm-muted">Страница {page} из {pages}</span>
          {page < pages && <Link className="adm-btn" href={href(p, { page: String(page + 1) })}>Дальше →</Link>}
        </div>
      )}
    </>
  );
}
