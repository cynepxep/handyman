"use client";

import { useActionState } from "react";
import { SubmitButton } from "../import/client-bits";
import type { ResetState, StaffFormState } from "./actions";

export function NewStaffForm({ action, roles }: { action: (p: StaffFormState, fd: FormData) => Promise<StaffFormState>; roles: Array<{ key: string; title: string }> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="adm-card">
      <h2 style={{ marginTop: 0 }}>Новый сотрудник</h2>
      {state.created && (
        <div className="adm-help" role="status">
          <b>{state.created.name}</b> добавлен. Передайте ему (лично или в мессенджере):
          <pre style={{ fontSize: 16 }}>{`Адрес: ${typeof window !== "undefined" ? window.location.origin : ""}/admin\nЛогин: ${state.created.username}\nВременный пароль: ${state.created.tempPassword}`}</pre>
          Пароль показан один раз. Пусть сотрудник сразу сменит его в «Мой аккаунт» и включит вход с кодом из приложения.
        </div>
      )}
      {state.error && <p className="adm-flash err" role="alert">{state.error}</p>}
      <div className="adm-row">
        <input name="name" className="adm-input" placeholder="Имя (например, Оля)" maxLength={80} required aria-label="Имя" />
        <input name="username" className="adm-input" placeholder="логин латиницей: olya" maxLength={32} required autoCapitalize="none" aria-label="Логин" />
        <select name="roleKey" className="adm-select" aria-label="Роль" defaultValue="manager">
          {roles.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
        </select>
        <SubmitButton primary pendingText="Добавляю…">Добавить</SubmitButton>
      </div>
    </form>
  );
}

export function ResetPasswordButton({ action, id }: { action: (p: ResetState, fd: FormData) => Promise<ResetState>; id: string }) {
  const [state, formAction] = useActionState(action, {});
  if (state.tempPassword) return <span className="adm-chip ok" style={{ userSelect: "all" }}>новый пароль: {state.tempPassword}</span>;
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton pendingText="…">Сбросить пароль</SubmitButton>
      {state.error && <span className="adm-bad"> {state.error}</span>}
    </form>
  );
}
