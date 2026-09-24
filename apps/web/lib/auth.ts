import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@handyman/db";
import {
  generateToken,
  hashPassword,
  verifyPassword,
  STAFF_SESSION_TTL_MS,
  type Permission,
} from "@handyman/core";

const COOKIE_NAME = "hm_staff_session";

export interface StaffSessionInfo {
  id: string;
  username: string;
  name: string;
  roleKey: string;
  roleTitle: string;
  permissions: Permission[];
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
    permissions: session.staff.role.permissions.map((p) => p.permission as Permission),
  };
}

// Использовать в начале любой защищённой страницы/действия админки.
export async function requireStaff(): Promise<StaffSessionInfo> {
  const session = await getStaffSession();
  if (!session) redirect("/admin/login");
  return session;
}

export async function requirePermission(permission: Permission): Promise<StaffSessionInfo> {
  const session = await requireStaff();
  if (!session.permissions.includes(permission)) {
    redirect("/admin?error=forbidden");
  }
  return session;
}

export async function loginStaff(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await prisma.staff.findUnique({ where: { username } });
  if (!staff || !staff.active) return { ok: false, error: "Неверный логин или пароль" };
  if (!verifyPassword(password, staff.passwordSalt, staff.passwordHash)) {
    return { ok: false, error: "Неверный логин или пароль" };
  }

  const token = generateToken();
  await prisma.staffSession.create({
    data: {
      token,
      staffId: staff.id,
      expiresAt: new Date(Date.now() + STAFF_SESSION_TTL_MS),
    },
  });
  await prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STAFF_SESSION_TTL_MS / 1000,
  });

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
