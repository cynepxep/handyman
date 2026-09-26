import { prisma } from "@handyman/db";
import { listSessions, loadSecurity } from "@handyman/db/staff";
import { formatSecret, generateTotpSecret, otpauthUrl } from "@handyman/core";
import { requireStaff } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { changePasswordAction, disable2faAction, enable2faAction, killOtherSessionsAction, newRecoveryCodesAction } from "./actions";
import { EnableTwoFa, NewRecoveryCodes } from "./two-fa";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const device = (ua: string | null) => {
  if (!ua) return "неизвестное устройство";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "другое";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "браузер";
  return `${br} · ${os}`;
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; need2fa?: string }> }) {
  const s = await requireStaff({ allowWithout2fa: true });
  const sp = await searchParams;
  const [sessions, security, me] = await Promise.all([listSessions(s.id), loadSecurity(), prisma.staff.findUniqueOrThrow({ where: { id: s.id }, select: { recoveryCodes: true } })]);
  const secret = s.hasTwoFactor ? "" : generateTotpSecret();
  const recoveryLeft = Array.isArray(me.recoveryCodes) ? me.recoveryCodes.length : 0;

  return (
    <>
      <h1>Мой аккаунт</h1>
      <p className="adm-lead">{s.name} ({s.username}), роль «{s.roleTitle}».</p>
      {sp.need2fa && !s.hasTwoFactor && <p className="adm-flash err" role="alert">Владелец включил обязательный вход с кодом из приложения. Включите его ниже — после этого откроются остальные разделы.</p>}
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Вход с кодом из приложения {s.hasTwoFactor ? <span className="adm-chip ok">включён</span> : <span className="adm-chip warn">выключен</span>}</h2>
        <p className="adm-muted">Даже если кто-то узнает пароль, без вашего телефона он не войдёт. {security.require2fa ? "Для всех сотрудников обязателен." : ""}</p>
        {s.hasTwoFactor ? (
          <>
            <p>Кодов восстановления осталось: <b>{recoveryLeft}</b>.</p>
            <NewRecoveryCodes action={newRecoveryCodesAction} />
            <form action={disable2faAction} className="adm-row" style={{ marginTop: 12 }}>
              <input name="code" className="adm-input" inputMode="numeric" placeholder="код из приложения" style={{ width: 170 }} aria-label="Код для выключения" required />
              <button type="submit" className="adm-btn adm-danger">Выключить</button>
            </form>
          </>
        ) : (
          <EnableTwoFa action={enable2faAction} secret={secret} secretPretty={formatSecret(secret)} url={otpauthUrl(secret, s.username)} />
        )}
      </section>

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Пароль</h2>
        <form action={changePasswordAction}>
          <div className="adm-grid2">
            <div className="adm-field"><label htmlFor="pw-cur">Текущий пароль</label><input id="pw-cur" name="current" type="password" className="adm-input wide" autoComplete="current-password" required /></div>
            <div />
            <div className="adm-field"><label htmlFor="pw-new">Новый пароль</label><input id="pw-new" name="next" type="password" className="adm-input wide" autoComplete="new-password" minLength={10} required /></div>
            <div className="adm-field"><label htmlFor="pw-rep">Повторите новый</label><input id="pw-rep" name="repeat" type="password" className="adm-input wide" autoComplete="new-password" minLength={10} required /></div>
          </div>
          <p className="adm-muted" style={{ marginTop: 0 }}>Не короче 10 символов, не только цифры. После смены — выход на других устройствах.</p>
          <SubmitButton primary pendingText="Сохраняю…">Сменить пароль</SubmitButton>
        </form>
      </section>

      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Где я вошёл</h2>
        <ul className="adm-msgs">
          {sessions.map((x) => (
            <li key={x.token}>
              {device(x.userAgent)} {x.token === s.token && <span className="adm-chip ok">это устройство</span>}
              <div className="adm-muted" style={{ fontSize: 13 }}>вход {when(x.createdAt)} · действует до {when(x.expiresAt)}</div>
            </li>
          ))}
        </ul>
        {sessions.length > 1 && <form action={killOtherSessionsAction} style={{ marginTop: 8 }}><SubmitButton pendingText="…">Выйти на всех других устройствах</SubmitButton></form>}
      </section>
    </>
  );
}
