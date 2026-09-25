// Реклама и баннеры: где на сайте, включён ли, сроки, нажатия. Основа будущего раздела рекламы (кампании, показы — следующие этапы).
import Link from "next/link";
import { BANNER_PLACEMENTS, bannerLive } from "@handyman/core/site";
import { listBanners } from "@handyman/db/banners";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { deleteBannerAction, toggleBannerAction } from "./actions";

export const dynamic = "force-dynamic";

const day = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("ru-RU") : "");

function status(b: { active: boolean; startsAt: Date | string | null; endsAt: Date | string | null }) {
  if (!b.active) return <span className="adm-chip">выключен</span>;
  if (bannerLive(b)) return <span className="adm-chip ok">показывается</span>;
  if (b.startsAt && new Date(b.startsAt) > new Date()) return <span className="adm-chip warn">с {day(b.startsAt)}</span>;
  return <span className="adm-chip">срок закончился</span>;
}

export default async function BannersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("ads.edit");
  const { ok, error } = await searchParams;
  const all = await listBanners();

  return (
    <>
      <h1>Реклама и баннеры</h1>
      <p className="adm-lead">
        Баннеры акций и объявлений в разных местах сайта: на главной, между товарами в списках, на странице товара. Каждый можно включить
        и выключить, задать даты показа и ограничить разделами. Нажатия считаются. Позже здесь же появится реклама (кампании, показы, аналитика).
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      <p><Link className="adm-btn primary" href="/admin/banners/new">+ Добавить баннер</Link></p>

      {BANNER_PLACEMENTS.map((pl) => {
        const rows = all.filter((b) => b.placement === pl.key);
        return (
          <section key={pl.key} className="adm-card">
            <h2 style={{ marginTop: 0 }}>{pl.ru}</h2>
            <p className="adm-muted" style={{ marginTop: 0 }}>{pl.hint}.</p>
            {rows.length === 0 ? (
              <p className="adm-muted">Баннеров нет.</p>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead><tr><th>Баннер</th><th>Статус</th><th>Сроки</th><th className="num">Нажатий</th><th /></tr></thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <Link className="adm-link" href={`/admin/banners/${b.id}`}><b>{b.name}</b></Link>
                          <div className="adm-muted">
                            {b.content.titleUk}
                            {b.settings.groups.length ? ` · только в разделах: ${b.settings.groups.length}` : ""}
                            {pl.key === "listing" ? ` · после каждых ${b.settings.everyN} товаров` : ""}
                          </div>
                        </td>
                        <td>{status(b)}</td>
                        <td className="adm-muted">{b.startsAt || b.endsAt ? `${day(b.startsAt) || "…"} — ${day(b.endsAt) || "…"}` : "без срока"}</td>
                        <td className="num">{b.clicks ?? 0}</td>
                        <td>
                          <div className="adm-row" style={{ gap: 6 }}>
                            <form action={toggleBannerAction.bind(null, b.id, !b.active)}>
                              <SubmitButton pendingText="…">{b.active ? "Выключить" : "Включить"}</SubmitButton>
                            </form>
                            <form action={deleteBannerAction.bind(null, b.id)}>
                              <SubmitButton pendingText="…">Удалить</SubmitButton>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
