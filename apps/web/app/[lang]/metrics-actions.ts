"use server";

// «Отчёты → Метрики»: свой счётчик воронки (посетитель, корзина, оформление) — работает всегда, даже без Google Analytics и cookies.
// Сотрудник с входом в админку и роботы не считаются. Канал — по рекламным меткам из куки hm_utm (её ставит proxy.ts).
import { headers } from "next/headers";
import { isMetricStep } from "@handyman/core/shop";
import { logError } from "@handyman/db/errors";
import { recordMetric } from "@handyman/db/metrics";
import { getStaffSession } from "@/lib/auth";
import { ipFrom } from "@/lib/request-ip";
import { utmFromCookie } from "@/lib/shop/analytics";

export async function metricAction(step: unknown): Promise<void> {
  if (!isMetricStep(step)) return;
  try {
    if (await getStaffSession().catch(() => null)) return;
    const h = await headers();
    await recordMetric(step, { ip: ipFrom(h), ua: h.get("user-agent"), utm: await utmFromCookie() });
  } catch (e) {
    logError("[metrics] шаг воронки не записан", e);
  }
}
