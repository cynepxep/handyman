// Лимиты публичных форм и входа (шаг 8.3) — в базе (таблица RateLimit), а не в памяти сервера: не сбрасываются при перезапуске
// и общие для всех копий сайта. Счётчик на окно времени: «правило : хеш кто : номер окна». Адрес и телефон хранятся только хешем.
// Правила (сколько и за какое время) — RATE_RULES в @handyman/core/shop (antispam.ts). Старые строки удаляет runJobs (pruneRateLimits).

import { createHash } from "node:crypto";
import { prisma } from "./client";
import { RATE_RULES, rateWindow, type RateRuleName } from "@handyman/core/shop";

export type RateResult = { ok: boolean; count: number; retryAfterSec: number };

const subjectHash = (subject: string) => createHash("sha256").update(`hm-rate:${subject}`).digest("hex").slice(0, 32);

function keyOf(rule: RateRuleName, subject: string, now: Date) {
  const w = rateWindow(RATE_RULES[rule], now);
  return { key: `${rule}:${subjectHash(subject)}:${w.bucket}`, ...w };
}

/**
 * Засчитать событие. `ok: false` — лимит превышен (это событие уже лишнее). Одна атомарная команда базы: две одновременные попытки
 * не проскочат вместе.
 */
export async function rateHit(rule: RateRuleName, subject: string, now: Date = new Date()): Promise<RateResult> {
  const { key, expiresAt, retryAfterSec } = keyOf(rule, subject, now);
  const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  const count = Number(row?.count ?? 1);
  return { ok: count <= RATE_RULES[rule].limit, count, retryAfterSec };
}

/** Лимит уже исчерпан? (без засчитывания — например, перед проверкой пароля, когда считаются только неудачи). */
export async function rateBlocked(rule: RateRuleName, subject: string, now: Date = new Date()): Promise<RateResult> {
  const { key, retryAfterSec } = keyOf(rule, subject, now);
  const row = await prisma.rateLimit.findUnique({ where: { key }, select: { count: true } });
  const count = row?.count ?? 0;
  return { ok: count < RATE_RULES[rule].limit, count, retryAfterSec };
}

/** Сбросить счётчик (например, после удачного входа). */
export async function rateReset(rule: RateRuleName, subject: string, now: Date = new Date()): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key: keyOf(rule, subject, now).key } });
}

/** Удалить отработавшие окна (из runJobs). */
export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  return (await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}
