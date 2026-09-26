"use client";

import { useActionState } from "react";
import { SubmitButton } from "../import/client-bits";
import type { TwoFaState } from "./actions";

function Codes({ codes }: { codes: string[] }) {
  return (
    <div className="adm-help" role="status">
      <b>Коды восстановления — сохраните их сейчас</b> (перепишите или сфотографируйте и держите отдельно от телефона). Каждый код работает один раз,
      если телефон потерян. Больше они показаны не будут.
      <pre style={{ fontSize: 16, letterSpacing: 1 }}>{codes.join("\n")}</pre>
    </div>
  );
}

/** Включение кода из приложения: ключ/ссылка → 6 цифр → коды восстановления. */
export function EnableTwoFa({ action, secret, secretPretty, url }: { action: (p: TwoFaState, fd: FormData) => Promise<TwoFaState>; secret: string; secretPretty: string; url: string }) {
  const [state, formAction] = useActionState(action, {});
  if (state.recoveryCodes) {
    return (
      <>
        <p className="adm-flash ok">Готово: теперь при входе после пароля понадобится код из приложения.</p>
        <Codes codes={state.recoveryCodes} />
      </>
    );
  }
  return (
    <form action={formAction}>
      <ol style={{ paddingLeft: 20, margin: "0 0 10px" }}>
        <li>Установите на телефон приложение <b>Google Authenticator</b> (или Microsoft Authenticator) из App Store / Google Play.</li>
        <li>
          С телефона нажмите: <a className="adm-link" href={url}>добавить Handyman в приложение</a>. С компьютера — в приложении «+» → «Ввести ключ»:
          <div style={{ fontFamily: "monospace", fontSize: 18, letterSpacing: 1, margin: "6px 0", userSelect: "all" }}>{secretPretty}</div>
          <small className="adm-muted">Название — Handyman, тип — «по времени».</small>
        </li>
        <li>Впишите 6 цифр, которые показывает приложение:</li>
      </ol>
      <input type="hidden" name="secret" value={secret} />
      <div className="adm-row">
        <input name="code" className="adm-input" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" style={{ width: 140, fontSize: 18, letterSpacing: 3 }} aria-label="Код из приложения" required />
        <SubmitButton primary pendingText="Проверяю…">Включить</SubmitButton>
      </div>
      {state.error && <p className="adm-flash err" role="alert">{state.error}</p>}
    </form>
  );
}

export function NewRecoveryCodes({ action }: { action: (p: TwoFaState) => Promise<TwoFaState> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction}>
      {state.recoveryCodes ? <Codes codes={state.recoveryCodes} /> : <SubmitButton pendingText="…">Выдать новые коды восстановления</SubmitButton>}
      {state.error && <p className="adm-flash err">{state.error}</p>}
    </form>
  );
}
