// Отправить ошибку из браузера в журнал (шаг 8.2) — из экранов ошибки витрины и админки. Безопасно для браузера (без серверных модулей).
// Ошибки сервера (с digest) журнал уже записал сам — сервер их пропустит. Отправка «тихая»: не получилось — ничего не показываем.
export function reportClientError(error: Error & { digest?: string }, area: "shop" | "admin"): void {
  try {
    const body = JSON.stringify({
      area,
      message: String(error?.message ?? error).slice(0, 1000),
      stack: String(error?.stack ?? "").slice(0, 4000),
      digest: error?.digest ?? "",
      url: location.pathname + location.search,
    });
    void fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* ничего */
  }
}
