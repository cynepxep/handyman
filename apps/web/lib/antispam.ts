import "server-only";
// Защита публичных форм витрины (шаг 8.3): скрытое поле-ловушка, «заполнено слишком быстро» и лимит в базе.
// Правила — RATE_RULES в @handyman/core/shop (antispam.ts), счётчики — @handyman/db/rate-limit.
import { filledTooFast, trapFilled, type RateRuleName } from "@handyman/core/shop";
import { rateHit } from "@handyman/db/rate-limit";
import { requestIp } from "./request-ip";

/** Что прислала форма: `website` — ловушка (человек её не видит), `fillMs` — сколько миллисекунд форма была открыта. */
export type FormGuard = { website?: unknown; fillMs?: unknown };
export type GuardError = "err.server" | "err.tooFast" | "err.tooMany";

/**
 * null — можно принимать; иначе ключ текста ошибки витрины. Ловушка — «не вышло» (боту не подсказываем); слишком быстро — «проверьте
 * и нажмите ещё раз» (живой человек просто нажмёт снова — к тому времени пройдёт больше 3 секунд); лимит — «забагато». `subject` — кого
 * считать (по умолчанию адрес).
 */
export async function guardForm(rule: RateRuleName, form: FormGuard | null | undefined, subject?: string): Promise<GuardError | null> {
  if (trapFilled(form?.website)) return "err.server";
  if (filledTooFast(form?.fillMs)) return "err.tooFast";
  if (!(await rateHit(rule, subject ?? (await requestIp()))).ok) return "err.tooMany";
  return null;
}
