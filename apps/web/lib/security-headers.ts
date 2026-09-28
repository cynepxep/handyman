// Заголовки безопасности (шаг 8.3) — подключаются в next.config.ts → headers().
// Сайт можно встроить в чужую страницу только в Telegram (Mini App в web.telegram.org), админку — никуда.
// Полную политику скриптов (CSP script-src) не ставим: Next.js вставляет свои скрипты в страницу, их пришлось бы подписывать на каждом запросе.
type Header = { key: string; value: string };

export const TELEGRAM_FRAME_ANCESTORS = "https://web.telegram.org https://*.telegram.org";

export function securityHeaders(production: boolean): Array<{ source: string; headers: Header[] }> {
  const common: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    // браузер запоминает: сайт — только по https (полгода). Только на сервере: на ПК владельца сайт открывается по http
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }] : []),
  ];
  return [
    { source: "/:path*", headers: [...common, { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${TELEGRAM_FRAME_ANCESTORS}` }] },
    // админка: не встраивается никуда (ни в Telegram, ни в свои страницы)
    ...["/admin", "/admin/:path*"].map((source) => ({
      source,
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    })),
  ];
}
