"use server";

import { redirect } from "next/navigation";
import { createStaff, killSessions, resetStaffPassword, resetStaffTwoFactor, saveSecurity, updateStaff } from "@handyman/db/staff";
import { requirePermission } from "@/lib/auth";

export type StaffFormState = { error?: string; created?: { name: string; username: string; tempPassword: string } };
export type ResetState = { error?: string; tempPassword?: string };

const who = (s: { name: string; username: string }) => s.name || s.username;
const back = (kind: "ok" | "error", text: string) => `/admin/staff?${kind}=${encodeURIComponent(text)}`;

/** Новый сотрудник: временный пароль показываем один раз (передайте сотруднику, он сменит в «Мой аккаунт»). */
export async function createStaffAction(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const s = await requirePermission("staff.manage");
  const name = String(formData.get("name") ?? "");
  const username = String(formData.get("username") ?? "");
  const r = await createStaff({ name, username, roleKey: String(formData.get("roleKey") ?? "") }, who(s));
  return r.ok ? { created: { name: name.trim(), username: username.trim().toLowerCase(), tempPassword: r.tempPassword } } : { error: r.error };
}

export async function resetPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const s = await requirePermission("staff.manage");
  const r = await resetStaffPassword(String(formData.get("id") ?? ""), who(s));
  return r.ok ? { tempPassword: r.tempPassword } : { error: r.error };
}

export async function updateStaffAction(formData: FormData): Promise<void> {
  const s = await requirePermission("staff.manage");
  const id = String(formData.get("id") ?? "");
  const act = String(formData.get("act") ?? "");
  const r =
    act === "role" ? await updateStaff(id, { roleKey: String(formData.get("roleKey") ?? "") }, who(s))
    : act === "off" ? await updateStaff(id, { active: false }, who(s))
    : act === "on" ? await updateStaff(id, { active: true }, who(s))
    : { ok: false, error: "Неизвестное действие." };
  redirect(r.ok ? back("ok", act === "off" ? "Сотрудник отключён, его входы закрыты." : "Сохранено.") : back("error", r.error ?? "Не удалось."));
}

export async function killStaffSessionsAction(formData: FormData): Promise<void> {
  const s = await requirePermission("staff.manage");
  const n = await killSessions(String(formData.get("id") ?? ""), who(s));
  redirect(back("ok", `Закрыто входов: ${n}.`));
}

export async function reset2faAction(formData: FormData): Promise<void> {
  const s = await requirePermission("staff.manage");
  await resetStaffTwoFactor(String(formData.get("id") ?? ""), who(s));
  redirect(back("ok", "Код из приложения у сотрудника выключен — пусть включит заново в «Мой аккаунт»."));
}

export async function securitySettingsAction(formData: FormData): Promise<void> {
  const s = await requirePermission("staff.manage");
  await saveSecurity({ require2fa: formData.get("require2fa") === "on" }, who(s));
  redirect(back("ok", "Настройки входа сохранены."));
}
