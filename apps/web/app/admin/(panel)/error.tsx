"use client";

// Экран ошибки админки (шаг 8.2): меню остаётся, можно повторить или уйти на главную. Ошибка уходит в журнал («Ошибки»);
// код ошибки (digest) — чтобы найти её там же.
import Link from "next/link";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error, "admin"), [error]);
  return (
    <section className="adm-card" role="alert">
      <h1 style={{ marginTop: 0 }}>Что-то пошло не так</h1>
      <p>Страница не открылась из-за ошибки. Она уже записана в раздел «Ошибки». Попробуйте ещё раз; если повторяется — сообщите разработчику.</p>
      {error.digest && <p className="adm-muted">Код ошибки: <code>{error.digest}</code></p>}
      <div className="adm-row">
        <button type="button" className="adm-btn primary" onClick={() => reset()}>Попробовать ещё раз</button>
        <Link className="adm-btn" href="/admin">На главную админки</Link>
      </div>
    </section>
  );
}
