"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

const box: React.CSSProperties = { fontFamily: "system-ui, sans-serif", maxWidth: 380, margin: "80px auto", padding: "0 16px" };
const input: React.CSSProperties = { display: "block", width: "100%", minHeight: 44, fontSize: 16, padding: "8px 10px", borderRadius: 8, border: "1px solid #bbb", marginTop: 4, boxSizing: "border-box" };
const btn: React.CSSProperties = { minHeight: 44, fontSize: 16, borderRadius: 8, border: 0, background: "#0b6bcb", color: "#fff", fontWeight: 600, cursor: "pointer" };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  if (state.step === "code") {
    return (
      <main style={box}>
        <h1>Код из приложения</h1>
        <p style={{ color: "#555" }}>Откройте на телефоне приложение-аутентификатор (Google Authenticator и т. п.) и введите 6 цифр для Handyman.</p>
        <form action={formAction} style={{ display: "grid", gap: 12 }}>
          <input type="hidden" name="step" value="code" />
          <label>
            Код
            <input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required style={{ ...input, letterSpacing: 4, fontSize: 22 }} placeholder="123456" />
          </label>
          {state.error && <p role="alert" style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
          <button type="submit" disabled={pending} style={btn}>{pending ? "Проверяем…" : "Войти"}</button>
        </form>
        <p style={{ color: "#666", fontSize: 14, marginTop: 16 }}>Телефон потерян? Введите в поле один из кодов восстановления (вида ABCD-EFGH), которые вы сохранили при включении.</p>
      </main>
    );
  }

  return (
    <main style={box}>
      <h1>Вход в админку Handyman</h1>
      <form action={formAction} style={{ display: "grid", gap: 12 }}>
        <label>
          Логин
          <input name="username" defaultValue="owner" required autoCapitalize="none" autoComplete="username" style={input} />
        </label>
        <label>
          Пароль
          <input name="password" type="password" required autoComplete="current-password" style={input} />
        </label>
        {state.error && <p role="alert" style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
        <button type="submit" disabled={pending} style={btn}>
          {pending ? "Входим…" : "Войти"}
        </button>
      </form>
      <p style={{ color: "#666", fontSize: 14, marginTop: 16 }}>
        Первый вход: логин <code>owner</code>, пароль — значение <code>ADMIN_TOKEN</code> из файла <code>.env</code>. После 5 неверных паролей вход закрывается на 15 минут.
      </p>
    </main>
  );
}
