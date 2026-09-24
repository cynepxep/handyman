"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 360, margin: "80px auto" }}>
      <h1>Вход в админку Handyman</h1>
      <form action={formAction} style={{ display: "grid", gap: 12 }}>
        <label>
          Логин
          <input name="username" defaultValue="owner" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Пароль
          <input name="password" type="password" required style={{ display: "block", width: "100%" }} />
        </label>
        {state.error && <p style={{ color: "crimson" }}>{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Входим…" : "Войти"}
        </button>
      </form>
      <p style={{ color: "#666", fontSize: 14, marginTop: 16 }}>
        Первый вход: логин <code>owner</code>, пароль — значение <code>ADMIN_TOKEN</code> из файла{" "}
        <code>.env</code>.
      </p>
    </main>
  );
}
