"use server";

import { redirect } from "next/navigation";
import { loginStaff } from "@/lib/auth";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    return { error: "Введите логин и пароль" };
  }

  const result = await loginStaff(username, password);
  if (!result.ok) return { error: result.error };

  redirect("/admin");
}
