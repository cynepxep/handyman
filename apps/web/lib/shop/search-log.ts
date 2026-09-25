// Запись поисковых запросов для подсказок «часто шукають». Защита от накрутки: один и тот же запрос с одного адреса
// считается раз в 6 часов, всего не больше 60 запросов с адреса в сутки; поиск сотрудников (вошедших в админку) не считается.
import "server-only";
import { headers } from "next/headers";
import { logSearch } from "@handyman/db/search-stats";
import { hasSessionCookie } from "@/lib/auth";

const SAME_QUERY_MS = 6 * 3600_000;
const DAY_MS = 24 * 3600_000;
const PER_DAY = 60;
const seen = new Map<string, number>(); // ip|запрос → когда считали
const perIp = new Map<string, number[]>();

export async function logSearchSafely(q: string, results: number): Promise<void> {
  try {
    if (await hasSessionCookie()) return;
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
    const now = Date.now();
    const key = `${ip}|${q.toLowerCase().trim()}`;
    if (now - (seen.get(key) ?? 0) < SAME_QUERY_MS) return;
    const list = (perIp.get(ip) ?? []).filter((t) => now - t < DAY_MS);
    if (list.length >= PER_DAY) return;
    list.push(now);
    perIp.set(ip, list);
    seen.set(key, now);
    if (seen.size > 20_000) seen.clear();
    if (perIp.size > 20_000) perIp.clear();
    await logSearch(q, results);
  } catch (e) {
    console.error("[search] не удалось записать запрос", e instanceof Error ? e.message : e);
  }
}
