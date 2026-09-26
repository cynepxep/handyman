"use server";

import { redirect } from "next/navigation";
import { loginStaff, loginWithCode } from "@/lib/auth";

export interface LoginState {
  error?: string;
  /** "code" — пароль верный, показываем поле для кода из приложения */
  step?: "code";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (formData.get("step") === "code") {
    const r = await loginWithCode(String(formData.get("code") ?? ""));
    if (!r.ok) return r.restart ? { error: r.error } : { error: r.error, step: "code" };
    redirect("/admin");
  }
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Введите логин и пароль" };
  const result = await loginStaff(username, password);
  if (!result.ok) return { error: result.error };
  if (result.needCode) return { step: "code" };
  redirect("/admin");
}
