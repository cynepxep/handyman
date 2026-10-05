"use client";

// «Отчёты → Метрики»: отметка шага воронки (визит, корзина, оформление) — один раз за день на вкладку; сервер ещё раз проверяет
// «один раз в день» по отпечатку без cookies (db/src/metrics.ts). Не зависит от включённой аналитики Google.
import { useEffect } from "react";
import type { MetricStep } from "@handyman/core/shop";
import { metricAction } from "@/app/[lang]/metrics-actions";

export function countStep(step: MetricStep): void {
  const k = `hm.m.${step}.${new Date().toDateString()}`;
  try {
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, "1");
  } catch {
    // без sessionStorage (приватный режим) — сервер сам не посчитает дважды
  }
  void metricAction(step).catch(() => {});
}

/** Визит: при первом показе страницы витрины (роботы без JavaScript сюда не доходят). */
export function MetricsBeacon() {
  useEffect(() => {
    countStep("visit");
  }, []);
  return null;
}
