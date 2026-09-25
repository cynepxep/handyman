// Магазины и склады: у каждой точки — город, адрес, график, «можно забрать здесь». Остатки товара — по точкам (StockItem).
// Чистая логика формы админки; база — packages/db/src/warehouses.ts.

import { parseScheduleForm, scheduleText, type WeekSchedule } from "../site/schedule";

export type WarehouseInput = {
  name: string;
  cityUk: string;
  cityRu: string;
  addressUk: string;
  addressRu: string;
  isPickup: boolean;
  sort: number;
  schedule: WeekSchedule;
};

/** Точка самовывоза для витрины (оформление заказа, страница «Контакти»). */
export type PickupPoint = {
  id: string;
  city: string;
  address: string;
  /** «Пн–Пт 9:00–18:00, Сб …» на языке сайта; пусто — график не задан */
  hours: string;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Форма «Магазины и склады». Ошибки — понятными словами. */
export function validateWarehouseForm(input: Record<string, string>): { ok: true; value: WarehouseInput } | { ok: false; error: string } {
  const v = {
    name: str(input.name, 80),
    cityUk: str(input.cityUk, 60), cityRu: str(input.cityRu, 60),
    addressUk: str(input.addressUk, 160), addressRu: str(input.addressRu, 160),
    isPickup: input.isPickup === "on",
    sort: Math.max(0, Math.min(999, Math.floor(Number(input.sort) || 0))),
  };
  if (v.name.length < 2) return { ok: false, error: "Напишите название (например, «Магазин на Богданівській»)." };
  if (v.isPickup && (v.cityUk.length < 2 || v.addressUk.length < 3)) {
    return { ok: false, error: "Чтобы покупатели могли забрать заказ здесь, заполните город и адрес (українською)." };
  }
  const h = parseScheduleForm(input, "h.");
  if (!h.ok) return { ok: false, error: `График: ${h.error}` };
  return { ok: true, value: { ...v, cityRu: v.cityRu || v.cityUk, addressRu: v.addressRu || v.addressUk, schedule: h.value } };
}

/** Точка самовывоза на языке сайта. */
export function toPickupPoint(
  w: { id: string; cityUk: string; cityRu: string; addressUk: string; addressRu: string; schedule: WeekSchedule | null },
  lang: "uk" | "ru",
): PickupPoint {
  const ru = lang === "ru";
  return {
    id: w.id,
    city: (ru ? w.cityRu : "") || w.cityUk,
    address: (ru ? w.addressRu : "") || w.addressUk,
    hours: w.schedule ? scheduleText(w.schedule, lang) : "",
  };
}
