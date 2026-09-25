import Link from "next/link";
import { loadLoyalty } from "@handyman/db/clients";
import { TIER_RU } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { saveLevelsAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LevelsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("settings.edit");
  const { ok, error } = await searchParams;
  const s = await loadLoyalty();

  return (
    <>
      <p><Link className="adm-link" href="/admin/clients">← Клиенты</Link></p>
      <h1>Уровни скидок</h1>
      <p className="adm-lead">
        Накопительная скидка: чем больше покупатель купил (только выполненные заказы, без тестовых), тем выше уровень и скидка. Уровни одинаковые на сайте,
        в Telegram-магазине и в боте. Личная скидка клиента (в его карточке) действует всегда и заменяет скидку по уровню. «Опт» — для бригад, его ставит
        сотрудник в карточке клиента вручную.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <form action={saveLevelsAction} className="adm-card">
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 40, fontWeight: 600 }}>
          <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Уровни скидок включены
        </label>
        <p className="adm-muted" style={{ marginTop: 0 }}>Пока выключено — покупатели видят обычные цены, а в карточках клиентов уровень всё равно считается (для истории).</p>
        <div className="adm-table-wrap" style={{ marginTop: 8 }}>
          <table className="adm-table">
            <thead><tr><th>Уровень</th><th>С суммы покупок, ₴</th><th>Скидка, %</th></tr></thead>
            <tbody>
              {s.levels.map((l) => (
                <tr key={l.key}>
                  <td><b>{TIER_RU[l.key]}</b></td>
                  <td>
                    {l.key === "START"
                      ? <span className="adm-muted">0 (все новые покупатели)</span>
                      : <input name={`min_${l.key}`} className="adm-input" style={{ width: 140 }} inputMode="numeric" defaultValue={l.min} aria-label={`Порог уровня ${TIER_RU[l.key]}`} />}
                  </td>
                  <td><input name={`pct_${l.key}`} className="adm-input" style={{ width: 90 }} inputMode="decimal" defaultValue={l.pct} aria-label={`Скидка уровня ${TIER_RU[l.key]}`} /></td>
                </tr>
              ))}
              <tr>
                <td><b>{TIER_RU.WHOLESALE}</b><div className="adm-muted">назначается вручную</div></td>
                <td className="adm-muted">—</td>
                <td><input name="wholesalePct" className="adm-input" style={{ width: 90 }} inputMode="decimal" defaultValue={s.wholesalePct} aria-label="Скидка уровня Опт" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="adm-muted">Скидка — от 0 до 50 %. После сохранения уровни всех клиентов пересчитываются по новым порогам.</p>
        <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
      </form>
    </>
  );
}
