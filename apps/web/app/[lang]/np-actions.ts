"use server";

// Нова Пошта для оформления заказа: поиск города и отделения/почтомата. Запросы к НП — только с сервера (кэш на сутки).
// null — НП сейчас не отвечает: в форме поля работают как обычный текст.
import { npCities, npPoints, type NpCity } from "@handyman/db/novaposhta";

export type NpOption = { ref: string; label: string };

export async function npCitiesAction(q: unknown): Promise<NpCity[] | null> {
  return typeof q === "string" ? npCities(q) : [];
}

export async function npPointsAction(cityRef: unknown, kind: unknown, q: unknown, lang: unknown): Promise<NpOption[] | null> {
  if (typeof cityRef !== "string" || (kind !== "warehouse" && kind !== "postomat")) return [];
  const list = await npPoints(cityRef, kind, typeof q === "string" ? q : "");
  return list && list.map((p) => ({ ref: p.ref, label: lang === "ru" ? p.ru : p.uk }));
}
