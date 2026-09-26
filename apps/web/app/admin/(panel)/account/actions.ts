"use server";

import { redirect } from "next/navigation";
import { changeOwnPassword, disableTwoFactor, enableTwoFactor, killSessions, regenerateRecoveryCodes } from "@handyman/db/staff";
import { requireStaff } from "@/lib/auth";

export type TwoFaState = { error?: string; recoveryCodes?: string[] };

const back = (kind: "ok" | "error", text: string) => `/admin/account?${kind}=${encodeURIComponent(text)}`;

/** Включить код из приложения: секрет с этой страницы + 6 цифр из приложения. Коды восстановления показываем один раз. */
export async function enable2faAction(_prev: TwoFaState, formData: FormData): Promise<TwoFaState> {
  const s = await requireStaff({ allowWithout2fa: true });
  const secret = String(formData.get("secret") ?? "");
  if (!/^[A-Z2-7]{32}$/.test(secret)) return { error: "Обновите страницу и попробуйте снова." };
  const r = await enableTwoFactor(s.id, secret, String(formData.get("code") ?? ""));
  return r.ok ? { recoveryCodes: r.recoveryCodes } : { error: r.error };
}

export async function newRecoveryCodesAction(): Promise<TwoFaState> {
  const s = await requireStaff({ allowWithout2fa: true });
  if (!s.hasTwoFactor) return { error: "Сначала включите код из приложения." };
  return { recoveryCodes: await regenerateRecoveryCodes(s.id) };
}

export async function disable2faAction(formData: FormData): Promise<void> {
  const s = await requireStaff({ allowWithout2fa: true });
  const r = await disableTwoFactor(s.id, String(formData.get("code") ?? ""));
  redirect(r.ok ? back("ok", "Код из приложения выключен.") : back("error", r.error ?? "Не удалось."));
}

export async function changePasswordAction(formData: FormData): Promise<void> {
  const s = await requireStaff({ allowWithout2fa: true });
  const next = String(formData.get("next") ?? "");
  if (next !== String(formData.get("repeat") ?? "")) redirect(back("error", "Новый пароль и повтор не совпадают."));
  const r = await changeOwnPassword(s.id, String(formData.get("current") ?? ""), next);
  if (!r.ok) redirect(back("error", r.error ?? "Не удалось."));
  const closed = await killSessions(s.id, s.name || s.username, s.token);
  redirect(back("ok", `Пароль изменён.${closed ? ` Выход выполнен на других устройствах: ${closed}.` : ""}`));
}

export async function killOtherSessionsAction(): Promise<void> {
  const s = await requireStaff({ allowWithout2fa: true });
  const n = await killSessions(s.id, s.name || s.username, s.token);
  redirect(back("ok", n ? `Выход выполнен на других устройствах: ${n}.` : "Других входов нет."));
}
