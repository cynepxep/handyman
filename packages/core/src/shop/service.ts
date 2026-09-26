// Задачи-напоминания и гарантийные обращения (шаг 4.5б) — чистая логика без базы.

import { kyivDayStart } from "./order-admin";

// ---------- задачи ----------

/** «2026-09-26T18:00» из поля «дата и время» — это время по Киеву → момент в UTC. Пусто/мусор — null. */
export function parseKyivDateTime(v: string | null | undefined): Date | null {
  const m = String(v ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (h > 23 || min > 59) return null;
  return new Date(kyivDayStart(m[1]).getTime() + (h * 60 + min) * 60_000);
}

/** Момент → значение для поля «дата и время» (по Киеву). */
export function toKyivInput(d: Date | null | undefined): string {
  if (!d) return "";
  const s = d.toLocaleString("sv-SE", { timeZone: "Europe/Kyiv", hour12: false });
  return s.slice(0, 16).replace(" ", "T");
}

export type TaskBucket = "overdue" | "today" | "later" | "none";

/** Куда отнести задачу: просрочена, на сегодня (по Киеву), позже, без срока. */
export function taskBucket(dueAt: Date | null, now = new Date()): TaskBucket {
  if (!dueAt) return "none";
  if (dueAt.getTime() < now.getTime()) return "overdue";
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  return dueAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }) === today ? "today" : "later";
}

export function validateTask(raw: Record<string, unknown>): { ok: true; value: { title: string; dueAt: Date | null; assignee: string | null } } | { ok: false; error: string } {
  const title = String(raw.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return { ok: false, error: "Напишите, что сделать (например, «перезвонить, уточнить отделение»)." };
  const dueRaw = String(raw.dueAt ?? "").trim();
  const dueAt = dueRaw ? parseKyivDateTime(dueRaw) : null;
  if (dueRaw && !dueAt) return { ok: false, error: "Не понял дату и время напоминания." };
  const assignee = String(raw.assignee ?? "").trim().slice(0, 60) || null;
  return { ok: true, value: { title, dueAt, assignee } };
}

// ---------- гарантия и обмен ----------

export const SERVICE_STATUSES = ["RECEIVED", "SENT", "IN_REPAIR", "READY", "CLOSED", "REJECTED"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const SERVICE_STATUS_RU: Record<ServiceStatus, string> = {
  RECEIVED: "Принят от покупателя",
  SENT: "Отправлен в сервис",
  IN_REPAIR: "В ремонте / диагностике",
  READY: "Готов, ждёт выдачи",
  CLOSED: "Выдан / закрыт",
  REJECTED: "Отказ в гарантии",
};

export const SERVICE_RESOLUTIONS: Record<string, string> = {
  repaired: "Отремонтирован",
  replaced: "Заменён на новый (обмен)",
  refunded: "Возврат денег",
  rejected: "Не гарантийный случай",
};

/** Черновик сообщения покупателю при смене статуса (менеджер правит перед отправкой). {no} — номер обращения, {product} — товар. */
export const SERVICE_CLIENT_TEXT: Record<ServiceStatus, { uk: string; ru: string }> = {
  RECEIVED: { uk: "Ваше гарантійне звернення №{no} ({product}) прийнято. Повідомимо, щойно буде результат.", ru: "Ваше гарантийное обращение №{no} ({product}) принято. Сообщим, как только будет результат." },
  SENT: { uk: "Звернення №{no}: {product} передано в сервісний центр на діагностику.", ru: "Обращение №{no}: {product} передан в сервисный центр на диагностику." },
  IN_REPAIR: { uk: "Звернення №{no}: {product} на діагностиці/ремонті. Це зазвичай займає до 14 днів.", ru: "Обращение №{no}: {product} на диагностике/ремонте. Обычно это занимает до 14 дней." },
  READY: { uk: "Звернення №{no}: {product} готовий, можна забирати.", ru: "Обращение №{no}: {product} готов, можно забирать." },
  CLOSED: { uk: "Звернення №{no} закрито. Дякуємо, що обрали Handyman!", ru: "Обращение №{no} закрыто. Спасибо, что выбрали Handyman!" },
  REJECTED: { uk: "Звернення №{no}: на жаль, сервіс не визнав випадок гарантійним. Зателефонуйте нам — підкажемо варіанти.", ru: "Обращение №{no}: к сожалению, сервис не признал случай гарантийным. Позвоните нам — подскажем варианты." },
};

export const serviceNo = (seq: number) => `С-${seq}`;

export function validateServiceCase(raw: Record<string, unknown>): { ok: true; value: { productName: string; serial: string; problem: string; phone: string; name: string; orderNo: string; sku: string } } | { ok: false; error: string } {
  const s = (k: string, max: number) => String(raw[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const productName = s("productName", 200);
  const problem = String(raw.problem ?? "").trim().slice(0, 2000);
  if (!productName) return { ok: false, error: "Укажите товар (или выберите его из заказа)." };
  if (!problem) return { ok: false, error: "Опишите неисправность со слов покупателя." };
  return { ok: true, value: { productName, serial: s("serial", 80), problem, phone: s("phone", 40), name: s("name", 80), orderNo: s("orderNo", 20).toUpperCase(), sku: s("sku", 64) } };
}
