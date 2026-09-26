// Запросы к Telegram Bot API (Этап 5) — без библиотек, через fetch. Токен берётся из BOT_TOKEN и никуда не пишется.
// В тестах подменяется через setTelegramFetch.

let fetchImpl: typeof fetch = (...a) => fetch(...a);
export const setTelegramFetch = (f: typeof fetch) => {
  fetchImpl = f;
};

export class TelegramError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

/** Вызов метода Bot API. Ошибка Telegram — TelegramError с кодом (409 — бота уже читает другая программа). */
export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) throw new TelegramError(0, "бот не настроен (нет BOT_TOKEN)");
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!data.ok) throw new TelegramError(data.error_code ?? res.status, data.description ?? `Telegram ${res.status}`);
  return data.result as T;
}

export type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; language_code?: string };
export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  contact?: { phone_number: string; first_name?: string; last_name?: string; user_id?: number };
};
export type TgUpdate = { update_id: number; message?: TgMessage };
