import Link from "next/link";
import { prisma } from "@handyman/db";
import { listStaff, loadSecurity } from "@handyman/db/staff";
import { requirePermission } from "@/lib/auth";
import { createStaffAction, killStaffSessionsAction, reset2faAction, resetPasswordAction, securitySettingsAction, updateStaffAction } from "./actions";
import { NewStaffForm, ResetPasswordButton } from "./staff-forms";

export const dynamic = "force-dynamic";

const when = (d: Date | null) => (d ? d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }) : "не входил");

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const me = await requirePermission("staff.manage");
  const sp = await searchParams;
  const [staff, roles, security] = await Promise.all([listStaff(), prisma.role.findMany({ orderBy: { key: "asc" }, select: { key: true, title: true } }), loadSecurity()]);
  const assignable = roles.filter((r) => r.key !== "owner");

  return (
    <>
      <h1>Сотрудники</h1>
      <p className="adm-lead">
        Кто входит в админку и что может (права — в <Link className="adm-link" href="/admin/roles">«Роли и права»</Link>). Уволили сотрудника — нажмите
        «Отключить»: он сразу выйдет со всех устройств и больше не войдёт. Все действия записываются в <Link className="adm-link" href="/admin/audit">«Журнал действий»</Link>.
      </p>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>Сотрудник</th><th>Роль</th><th className="adm-hide-sm">Вход</th><th>Действия</th></tr></thead>
          <tbody>
            {staff.map((x) => (
              <tr key={x.id} style={x.active ? undefined : { opacity: 0.6 }}>
                <td>
                  <b>{x.name}</b> {x.id === me.id && <span className="adm-chip">это вы</span>}
                  <div className="adm-muted">{x.username}</div>
                  {!x.active && <span className="adm-chip bad">отключён</span>}{" "}
                  {x.twoFactorSecret ? <span className="adm-chip ok">код из приложения</span> : <span className="adm-chip warn">только пароль</span>}
                  {x.lockedUntil && x.lockedUntil > new Date() && <span className="adm-chip bad"> вход закрыт (подбор пароля)</span>}
                </td>
                <td>
                  {x.roleKey === "owner" ? x.role.title : (
                    <form action={updateStaffAction} className="adm-row" style={{ gap: 6 }}>
                      <input type="hidden" name="id" value={x.id} /><input type="hidden" name="act" value="role" />
                      <select name="roleKey" defaultValue={x.roleKey} className="adm-select" aria-label={`Роль: ${x.name}`}>
                        {assignable.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
                      </select>
                      <button type="submit" className="adm-btn" style={{ minHeight: 36 }}>OK</button>
                    </form>
                  )}
                </td>
                <td className="adm-hide-sm">{when(x.lastLoginAt)}<div className="adm-muted">открытых входов: {x._count.sessions}</div></td>
                <td>
                  <div className="adm-row" style={{ gap: 6 }}>
                    {x.roleKey !== "owner" && (
                      <form action={updateStaffAction}>
                        <input type="hidden" name="id" value={x.id} /><input type="hidden" name="act" value={x.active ? "off" : "on"} />
                        <button type="submit" className={x.active ? "adm-btn adm-danger" : "adm-btn"} style={{ minHeight: 36 }}>{x.active ? "Отключить" : "Включить"}</button>
                      </form>
                    )}
                    {x._count.sessions > 0 && x.id !== me.id && (
                      <form action={killStaffSessionsAction}><input type="hidden" name="id" value={x.id} /><button type="submit" className="adm-btn" style={{ minHeight: 36 }}>Выйти везде</button></form>
                    )}
                    {x.id !== me.id && <ResetPasswordButton action={resetPasswordAction} id={x.id} />}
                    {x.twoFactorSecret && x.id !== me.id && (
                      <form action={reset2faAction}><input type="hidden" name="id" value={x.id} /><button type="submit" className="adm-btn" style={{ minHeight: 36 }}>Сбросить код</button></form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewStaffForm action={createStaffAction} roles={assignable} />

      <form action={securitySettingsAction} className="adm-card">
        <h2 style={{ marginTop: 0 }}>Правила входа</h2>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 40 }}>
          <input type="checkbox" name="require2fa" defaultChecked={security.require2fa} /> Вход с кодом из приложения обязателен для всех
        </label>
        <p className="adm-muted" style={{ marginTop: 0 }}>
          Сотрудник без кода после входа увидит только «Мой аккаунт», пока не включит. Сначала включите код себе ({me.hasTwoFactor ? "у вас включён ✓" : <Link className="adm-link" href="/admin/account">включить</Link>}).
          Всегда: после 5 неверных паролей вход закрывается на 15 минут.
        </p>
        <button type="submit" className="adm-btn primary">Сохранить</button>
      </form>
    </>
  );
}
