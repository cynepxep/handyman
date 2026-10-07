// Next.js вызывает register() один раз при старте сервера. Здесь запускаются фоновые задачи (шаг 4.8) — только в Node.js.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("./lib/worker");
  startWorker();
  if (process.env.NODE_ENV === "production") void warnDangerousEnv();
}

/** Шаг 8.3: на сервере опасные значения в .env (change-me, http, временный вход) — не падаем, а пишем в журнал ошибок (/admin/errors). */
async function warnDangerousEnv() {
  try {
    const { dangerousEnv } = await import("@handyman/core/launch-check");
    const { logError } = await import("@handyman/db/errors");
    for (const m of dangerousEnv(process.env)) logError(`[launch-check] небезопасная настройка: ${m}. Подробнее — «Проверка перед запуском» в админке`);
  } catch (e) {
    console.error("[launch-check]", e instanceof Error ? e.message : e);
  }
}

/**
 * Шаг 8.2: ошибки страниц, действий (server actions), адресов API и proxy — в журнал ошибок (/admin/errors).
 * redirect()/notFound() — не ошибки (их Next.js тоже «бросает»), они не пишутся; «Failed to find Server Action» (форма со страницы,
 * открытой до обновления сайта, или сканер) — тоже. Журнал сам маскирует телефоны и ключи.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: "render" | "route" | "action" | "proxy" },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { isNextControlFlow, isStaleServerAction } = await import("@handyman/core/errors");
    if (isNextControlFlow(error) || isStaleServerAction(error)) return;
    const { recordError } = await import("@handyman/db/errors");
    const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : null;
    const source = context.routeType === "render" ? "page" : context.routeType;
    recordError({ source, where: `${request.method} ${context.routePath}`, error, url: request.path, digest });
  } catch (e) {
    console.error("[errors] onRequestError:", e instanceof Error ? e.message : e);
  }
}
