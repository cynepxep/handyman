// Next.js вызывает register() один раз при старте сервера. Здесь запускаются фоновые задачи (шаг 4.8) — только в Node.js.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("./lib/worker");
  startWorker();
}
