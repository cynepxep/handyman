import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@handyman/db";
import { codeStep, loadSecurity, passwordStep } from "@handyman/db/staff";
import { hashPassword, STAFF_SESSION_TTL_MS, PERMISSIONS, type Permission } from "@handyman/core";

const COOKIE_NAME = "hm_staff_session";
const CHALLENGE_COOKIE = "hm_login_challenge"; // шаг 4.7: пароль верный, ждём код из приложения

export interface StaffSessionInfo {
  id: string;
  username: string;
  name: string;
  roleKey: string;
  roleTitle: string;
  permissions: Permission[];
  /** токен текущей сессии — чтобы «выйти со всех устройств, кроме этого» */
  token: string;
  hasTwoFactor: boolean;
}

// Дешёвая проверка "есть кука" — для proxy.ts (без обращения к базе).
export async function hasSessionCookie(): Promise<boolean> {
  const jar = await cookies();
  return jar.has(COOKIE_NAME);
}

export async function getStaffSession(): Promise<StaffSessionInfo | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.staffSession.findUnique({
    where: { token },
    include: {
      staff: {
        include: { role: { include: { permissions: true } } },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.staffSession.delete({ where: { token } }).catch(() => {});
    return null;
  }
  if (!session.staff.active) return null;

  return {
    id: session.staff.id,
    username: session.staff.username,
    name: session.staff.name,
    roleKey: session.staff.roleKey,
    roleTitle: session.staff.role.title,
    // владелец имеет все права всегда (и новые — без пересохранения роли); остальные — по списку роли
    permissions: session.staff.roleKey === "owner" ? [...PERMISSIONS] : session.staff.role.permissions.map((p) => p.permission as Permission),
    token,
    hasTwoFactor: Boolean(session.staff.twoFactorSecret),
  };
}

/**
 * Использовать в начале любой защищённой страницы/действия админки. Если владелец включил «код из приложения обязателен»,
 * сотрудника без кода отправляем его включить («Мой аккаунт»), пока не включит — остальные разделы закрыты.
 */
export async function requireStaff(opts: { allowWithout2fa?: boolean } = {}): Promise<StaffSessionInfo> {
  const session = await getStaffSession();
  if (!session) redirect("/admin/login");
  if (!opts.allowWithout2fa && !session.hasTwoFactor && (await loadSecurity()).require2fa) redirect("/admin/account?need2fa=1");
  return session;
}

export async function requirePermission(permission: Permission): Promise<StaffSessionInfo> {
  const session = await requireStaff();
  if (!session.permissions.includes(permission)) {
    redirect("/admin?error=forbidden");
  }
  return session;
}

async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: STAFF_SESSION_TTL_MS / 1000 });
  jar.delete(CHALLENGE_COOKIE);
}

const userAgent = async () => (await headers()).get("user-agent");

/** Вход, шаг 1: логин и пароль. `needCode` — дальше нужен код из приложения (вызов сохранён в куке на 5 минут). */
export async function loginStaff(username: string, password: string): Promise<{ ok: true; needCode?: boolean } | { ok: false; error: string }> {
  const r = await passwordStep(username, password, await userAgent());
  if (!r.ok) return r;
  if ("challenge" in r) {
    (await cookies()).set(CHALLENGE_COOKIE, r.challenge, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/admin", maxAge: 300 });
    return { ok: true, needCode: true };
  }
  await setSessionCookie(r.session);
  return { ok: true };
}

/** Вход, шаг 2: код из приложения или код восстановления. `restart` — начать со входа по паролю. */
export async function loginWithCode(code: string): Promise<{ ok: true } | { ok: false; error: string; restart?: boolean }> {
  const jar = await cookies();
  const challenge = jar.get(CHALLENGE_COOKIE)?.value;
  if (!challenge) return { ok: false, error: "Время вышло — войдите заново.", restart: true };
  const r = await codeStep(challenge, code, await userAgent());
  if (!r.ok) {
    if (r.restart) jar.delete(CHALLENGE_COOKIE);
    return r;
  }
  await setSessionCookie(r.session);
  return { ok: true };
}

export async function logoutStaff(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) await prisma.staffSession.delete({ where: { token } }).catch(() => {});
  jar.delete(COOKIE_NAME);
}

export async function setStaffPassword(staffId: string, newPassword: string): Promise<void> {
  const { salt, hash } = hashPassword(newPassword);
  await prisma.staff.update({ where: { id: staffId }, data: { passwordSalt: salt, passwordHash: hash } });
}

export { COOKIE_NAME as STAFF_SESSION_COOKIE };
