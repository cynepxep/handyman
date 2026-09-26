// Сотрудники и безопасность входа (шаг 4.7): вход по паролю + код из приложения, защита от подбора, коды восстановления,
// сессии («где я вошёл», «выйти со всех устройств»), управление сотрудниками, журнал действий.
// Криптография — @handyman/core (auth.ts, totp.ts). Все события входа и правки сотрудников пишутся в AuditLog.

import { prisma, Prisma } from "./client";
import {
  STAFF_SESSION_TTL_MS, checkPasswordStrength, consumeRecoveryCode, generateRecoveryCodes, generateTempPassword, generateToken,
  hashPassword, verifyPassword, verifyTotp,
} from "@handyman/core";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
const audit = (who: string, action: string, target?: string, details?: unknown) =>
  prisma.auditLog.create({ data: { who, action, target: target ?? null, details: details === undefined ? undefined : json(details) } });

export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
const CHALLENGE_MS = 5 * 60_000;
export const SECURITY_SETTING_KEY = "security";

export type SecuritySettings = { require2fa: boolean };

export async function loadSecurity(): Promise<SecuritySettings> {
  const v = (await prisma.setting.findUnique({ where: { key: SECURITY_SETTING_KEY } }))?.value as Partial<SecuritySettings> | undefined;
  return { require2fa: v?.require2fa === true };
}

export async function saveSecurity(v: SecuritySettings, who: string): Promise<void> {
  await prisma.setting.upsert({ where: { key: SECURITY_SETTING_KEY }, update: { value: json(v) }, create: { key: SECURITY_SETTING_KEY, value: json(v) } });
  await audit(who, "security.settings", undefined, v);
}

async function newSession(staffId: string, userAgent: string | null): Promise<string> {
  const token = generateToken();
  await prisma.staffSession.create({ data: { token, staffId, expiresAt: new Date(Date.now() + STAFF_SESSION_TTL_MS), userAgent: userAgent?.slice(0, 200) ?? null } });
  await prisma.staff.update({ where: { id: staffId }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
  return token;
}

export type LoginStep = { ok: true; session: string } | { ok: true; challenge: string } | { ok: false; error: string };

const WRONG = "Неверный логин или пароль";

/**
 * Шаг 1: логин и пароль. После 5 неудач подряд вход закрывается на 15 минут (защита от подбора). Если у сотрудника включён код из
 * приложения — возвращаем «вызов» (challenge), сессию выдаст шаг 2.
 */
export async function passwordStep(username: string, password: string, userAgent: string | null): Promise<LoginStep> {
  const staff = await prisma.staff.findUnique({ where: { username } });
  if (!staff || !staff.active) {
    await audit(username || "?", "login.fail", undefined, { reason: "no-user" });
    return { ok: false, error: WRONG };
  }
  if (staff.lockedUntil && staff.lockedUntil > new Date()) {
    const min = Math.ceil((staff.lockedUntil.getTime() - Date.now()) / 60_000);
    return { ok: false, error: `Слишком много неудачных попыток. Попробуйте через ${min} мин.` };
  }
  if (!verifyPassword(password, staff.passwordSalt, staff.passwordHash)) {
    const failed = staff.failedLogins + 1;
    const lock = failed >= MAX_FAILED;
    await prisma.staff.update({ where: { id: staff.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    await audit(staff.username, lock ? "login.locked" : "login.fail", staff.id, { failed });
    return { ok: false, error: lock ? `Слишком много неудачных попыток. Вход закрыт на ${LOCK_MINUTES} минут.` : WRONG };
  }
  if (staff.twoFactorSecret) {
    const token = generateToken();
    await prisma.staffLoginChallenge.deleteMany({ where: { staffId: staff.id } });
    await prisma.staffLoginChallenge.create({ data: { token, staffId: staff.id, expiresAt: new Date(Date.now() + CHALLENGE_MS) } });
    return { ok: true, challenge: token };
  }
  await audit(staff.username, "login.ok", staff.id);
  return { ok: true, session: await newSession(staff.id, userAgent) };
}

/** Шаг 2: код из приложения (или одноразовый код восстановления). До 5 попыток, 5 минут. */
export async function codeStep(challenge: string, code: string, userAgent: string | null): Promise<{ ok: true; session: string } | { ok: false; error: string; restart?: boolean }> {
  const ch = await prisma.staffLoginChallenge.findUnique({ where: { token: challenge }, include: { staff: true } });
  if (!ch || ch.expiresAt < new Date() || !ch.staff.active || !ch.staff.twoFactorSecret) {
    if (ch) await prisma.staffLoginChallenge.delete({ where: { token: challenge } }).catch(() => {});
    return { ok: false, error: "Время вышло — войдите заново.", restart: true };
  }
  const clean = code.trim();
  let ok = /^\d{6}$/.test(clean.replace(/\s/g, "")) && verifyTotp(ch.staff.twoFactorSecret, clean).ok;
  let usedRecovery = false;
  if (!ok && /^[a-z2-7]{4}[\s-]?[a-z2-7]{4}$/i.test(clean)) {
    const left = consumeRecoveryCode(ch.staff.recoveryCodes, clean);
    if (left) {
      await prisma.staff.update({ where: { id: ch.staffId }, data: { recoveryCodes: left } });
      ok = usedRecovery = true;
    }
  }
  if (!ok) {
    const attempts = ch.attempts + 1;
    if (attempts >= MAX_FAILED) {
      await prisma.staffLoginChallenge.delete({ where: { token: challenge } });
      await audit(ch.staff.username, "login.code.fail", ch.staffId, { attempts });
      return { ok: false, error: "Слишком много неверных кодов — войдите заново.", restart: true };
    }
    await prisma.staffLoginChallenge.update({ where: { token: challenge }, data: { attempts } });
    return { ok: false, error: "Код не подходит. Проверьте, что время на телефоне верное, и введите свежий код." };
  }
  await prisma.staffLoginChallenge.delete({ where: { token: challenge } });
  await audit(ch.staff.username, usedRecovery ? "login.ok.recovery" : "login.ok", ch.staffId, { twoFactor: true });
  return { ok: true, session: await newSession(ch.staffId, userAgent) };
}

// ---------- код из приложения: включить / выключить ----------

/** Включить: сотрудник ввёл код из приложения для нового секрета — сохраняем и выдаём 10 кодов восстановления (показать один раз). */
export async function enableTwoFactor(staffId: string, secret: string, code: string): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  if (!verifyTotp(secret, code).ok) return { ok: false, error: "Код не подходит. Введите 6 цифр, которые сейчас показывает приложение." };
  const { codes, hashes } = generateRecoveryCodes();
  const s = await prisma.staff.update({ where: { id: staffId }, data: { twoFactorSecret: secret, recoveryCodes: hashes } });
  await audit(s.username, "security.2fa.on", staffId);
  return { ok: true, recoveryCodes: codes };
}

/** Выключить самому — только с текущим кодом (чтобы не выключил тот, кто просто сел за чужой компьютер). */
export async function disableTwoFactor(staffId: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!s?.twoFactorSecret) return { ok: true };
  if (!verifyTotp(s.twoFactorSecret, code).ok) return { ok: false, error: "Код не подходит." };
  await prisma.staff.update({ where: { id: staffId }, data: { twoFactorSecret: null, recoveryCodes: Prisma.DbNull } });
  await audit(s.username, "security.2fa.off", staffId);
  return { ok: true };
}

/** Новые коды восстановления (старые перестают работать). */
export async function regenerateRecoveryCodes(staffId: string): Promise<string[]> {
  const { codes, hashes } = generateRecoveryCodes();
  const s = await prisma.staff.update({ where: { id: staffId }, data: { recoveryCodes: hashes } });
  await audit(s.username, "security.recovery.new", staffId);
  return codes;
}

// ---------- пароль и сессии ----------

export async function changeOwnPassword(staffId: string, current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!s) return { ok: false, error: "Сотрудник не найден." };
  if (!verifyPassword(current, s.passwordSalt, s.passwordHash)) return { ok: false, error: "Текущий пароль неверный." };
  const weak = checkPasswordStrength(next, s.username);
  if (weak) return { ok: false, error: weak };
  const { salt, hash } = hashPassword(next);
  await prisma.staff.update({ where: { id: staffId }, data: { passwordSalt: salt, passwordHash: hash } });
  await audit(s.username, "security.password", staffId);
  return { ok: true };
}

export const listSessions = (staffId: string) =>
  prisma.staffSession.findMany({ where: { staffId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { token: true, createdAt: true, expiresAt: true, userAgent: true } });

/** Выйти со всех устройств (кроме `keepToken`, если передан). Возвращает сколько сессий закрыто. */
export async function killSessions(staffId: string, who: string, keepToken?: string): Promise<number> {
  const r = await prisma.staffSession.deleteMany({ where: { staffId, ...(keepToken ? { token: { not: keepToken } } : {}) } });
  await audit(who, "security.sessions.kill", staffId, { count: r.count, keepCurrent: Boolean(keepToken) });
  return r.count;
}

// ---------- сотрудники (владелец) ----------

export const listStaff = () =>
  prisma.staff.findMany({
    where: { username: { not: "claude-test" } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, username: true, name: true, roleKey: true, active: true, lastLoginAt: true, createdAt: true, twoFactorSecret: true, lockedUntil: true, role: { select: { title: true } }, _count: { select: { sessions: true } } },
  });

const LOGIN = /^[a-z0-9._-]{3,32}$/;

/** Новый сотрудник: имя, логин, роль → временный пароль (показать владельцу один раз; сотрудник сменит в «Мой аккаунт»). */
export async function createStaff(v: { name: string; username: string; roleKey: string }, who: string): Promise<{ ok: true; id: string; tempPassword: string } | { ok: false; error: string }> {
  const username = v.username.trim().toLowerCase();
  const name = v.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Укажите имя сотрудника." };
  if (!LOGIN.test(username)) return { ok: false, error: "Логин — 3–32 символа: латинские буквы, цифры, точка, дефис, подчёркивание." };
  if (v.roleKey === "owner") return { ok: false, error: "Роль «Владелец» новому сотруднику дать нельзя." };
  if (!(await prisma.role.findUnique({ where: { key: v.roleKey } }))) return { ok: false, error: "Выберите роль." };
  if (await prisma.staff.findUnique({ where: { username } })) return { ok: false, error: "Такой логин уже есть." };
  const tempPassword = generateTempPassword();
  const { salt, hash } = hashPassword(tempPassword);
  const s = await prisma.staff.create({ data: { username, name, roleKey: v.roleKey, passwordSalt: salt, passwordHash: hash } });
  await audit(who, "staff.create", s.id, { username, role: v.roleKey });
  return { ok: true, id: s.id, tempPassword };
}

/** Роль, имя, активен. Отключение сразу закрывает все сессии сотрудника. Владельца отключить или понизить нельзя. */
export async function updateStaff(id: string, v: { name?: string; roleKey?: string; active?: boolean }, who: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.staff.findUnique({ where: { id } });
  if (!s) return { ok: false, error: "Сотрудник не найден." };
  if (s.roleKey === "owner" && ((v.roleKey && v.roleKey !== "owner") || v.active === false)) return { ok: false, error: "Владельца нельзя отключить или сменить ему роль." };
  if (v.roleKey === "owner" && s.roleKey !== "owner") return { ok: false, error: "Роль «Владелец» выдать нельзя." };
  if (v.roleKey && !(await prisma.role.findUnique({ where: { key: v.roleKey } }))) return { ok: false, error: "Такой роли нет." };
  await prisma.staff.update({ where: { id }, data: { ...(v.name ? { name: v.name.trim().slice(0, 80) } : {}), ...(v.roleKey ? { roleKey: v.roleKey } : {}), ...(v.active !== undefined ? { active: v.active } : {}) } });
  if (v.active === false) await prisma.staffSession.deleteMany({ where: { staffId: id } });
  await audit(who, "staff.update", id, v);
  return { ok: true };
}

/** Сбросить пароль (временный показать один раз) и закрыть все сессии. */
export async function resetStaffPassword(id: string, who: string): Promise<{ ok: true; tempPassword: string } | { ok: false; error: string }> {
  const s = await prisma.staff.findUnique({ where: { id } });
  if (!s) return { ok: false, error: "Сотрудник не найден." };
  const tempPassword = generateTempPassword();
  const { salt, hash } = hashPassword(tempPassword);
  await prisma.staff.update({ where: { id }, data: { passwordSalt: salt, passwordHash: hash, failedLogins: 0, lockedUntil: null } });
  await prisma.staffSession.deleteMany({ where: { staffId: id } });
  await audit(who, "staff.password.reset", id);
  return { ok: true, tempPassword };
}

/** Сотрудник потерял телефон: владелец выключает ему код из приложения (сотрудник включит заново). */
export async function resetStaffTwoFactor(id: string, who: string): Promise<void> {
  await prisma.staff.update({ where: { id }, data: { twoFactorSecret: null, recoveryCodes: Prisma.DbNull } });
  await audit(who, "staff.2fa.reset", id);
}

// ---------- журнал действий ----------

export async function listAudit(opts: { who?: string; action?: string; page?: number; perPage?: number } = {}) {
  const perPage = opts.perPage ?? 50;
  const page = Math.max(1, opts.page ?? 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(opts.who ? { who: { contains: opts.who, mode: "insensitive" } } : {}),
    ...(opts.action ? { action: { startsWith: opts.action } } : {}),
  };
  const [total, rows, whos] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { ts: "desc" }, skip: (page - 1) * perPage, take: perPage }),
    prisma.auditLog.groupBy({ by: ["who"], _count: { _all: true }, orderBy: { _count: { who: "desc" } }, take: 20 }),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / perPage)), rows, whos: whos.map((w) => w.who) };
}
