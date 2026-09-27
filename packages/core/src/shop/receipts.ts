// Кассовые чеки через Checkbox (шаг 3.3): чистая логика без базы и сети — что пробить в чек, тело запроса, как понять ответ Checkbox,
// когда повторить и когда закрыть смену. Суммы берутся из заказа и зачтённой оплаты — не из браузера.
// Формат API сверен с официальным checkbox-sdk (Python, 1.5.0): /cashier/signin, /cashier/shift, /shifts, /shifts/close, /receipts/sell,
// /receipts/{id}. Деньги — в копейках, количество — в тысячных (1 шт. = 1000).

/** Наши состояния чека. queued — ждёт отправки; sending — отправляем; sent — Checkbox принял, ждём фискальный номер; done — готов; error — не получилось. */
export type ReceiptStatus = "queued" | "sending" | "sent" | "done" | "error";
export const RECEIPT_STATUS_RU: Record<ReceiptStatus, string> = {
  queued: "ждёт отправки",
  sending: "отправляется",
  sent: "Checkbox обрабатывает",
  done: "готов",
  error: "не создан",
};
/** sell — продажа (оплата), return — возврат денег. */
export type ReceiptKind = "sell" | "return";
export const RECEIPT_KIND_RU: Record<ReceiptKind, string> = { sell: "продажа", return: "возврат" };
/** CASHLESS — карта/онлайн, CASH — наличные (ручной чек при самовывозе). */
export type ReceiptPayType = "CASHLESS" | "CASH";
export const RECEIPT_PAY_RU: Record<ReceiptPayType, string> = { CASHLESS: "картой", CASH: "наличными" };

/** Сколько раз пробуем отправить чек, прежде чем сказать менеджерам «не создан». */
export const RECEIPT_MAX_ATTEMPTS = 8;
/** Пауза перед попыткой № n (после n неудачных), минут: 1, 2, 5, 10, 30, 60, 120… */
export function receiptRetryDelayMin(attempts: number): number {
  const steps = [1, 2, 5, 10, 30, 60, 120];
  return steps[Math.min(Math.max(attempts - 1, 0), steps.length - 1)];
}

/** Страница чека для покупателя (публичная, на сайте Checkbox). */
export const DEFAULT_RECEIPT_PAGE = "https://check.checkbox.ua";
export const receiptPageUrl = (id: string, base?: string | null) => `${(base?.trim() || DEFAULT_RECEIPT_PAGE).replace(/\/+$/, "")}/${id}`;

const round2 = (n: number) => Math.round(n * 100) / 100;
const toKop = (uah: number) => Math.round(uah * 100);

// ---------- что пробить ----------

export type ReceiptGood = { code: string; name: string; price: number; qty: number };
export type ReceiptLine = { name: string; sku: string; qty: number; unitPrice: number };

/** Названия строк, когда чек не построчный (часть суммы заказа). Фискальный чек — на украинском. */
export const RECEIPT_LINE_NAMES = {
  prepay: "Передплата за замовлення {no}",
  pay: "Оплата замовлення {no}",
  refund: "Повернення коштів за замовлення {no}",
} as const;

/**
 * Строки чека. Построчно (товары заказа) — если сумма оплаты равна сумме строк до копейки (оплачена вся сумма одним платежом);
 * иначе одна строка «Передплата за замовлення …» / «Оплата замовлення …» на всю сумму, чтобы чек всегда сходился с оплатой.
 * Допущение (Д47): отдельные «чеки передоплати» Checkbox (цепочка аванс → доплата) не используем.
 */
export function receiptGoods(p: { no: string; amount: number; items?: ReceiptLine[]; partial: "prepay" | "pay" | "refund" }): ReceiptGood[] {
  const amount = toKop(p.amount);
  const lines = (p.items ?? []).map((i) => ({ code: i.sku.slice(0, 64), name: i.name.slice(0, 256), price: toKop(i.unitPrice), qty: i.qty }));
  const itemized = lines.length > 0 && lines.every((l) => l.qty > 0 && l.price > 0) && lines.reduce((a, l) => a + l.price * l.qty, 0) === amount;
  if (itemized) return lines.map((l) => ({ ...l, price: l.price / 100 }));
  return [{ code: p.no, name: RECEIPT_LINE_NAMES[p.partial].replace("{no}", p.no), price: round2(p.amount), qty: 1 }];
}

/** Сумма строк чека, ₴. */
export const goodsTotal = (g: ReceiptGood[]) => round2(g.reduce((a, x) => a + toKop(x.price) * x.qty, 0) / 100);

/** Тело POST /receipts/sell. Возврат — те же строки с is_return и ссылкой на чек продажи. */
export function sellReceiptBody(p: {
  id: string; goods: ReceiptGood[]; payType: ReceiptPayType; isReturn?: boolean; relatedId?: string | null; emails?: string[]; label?: string;
}) {
  const value = p.goods.reduce((a, g) => a + toKop(g.price) * g.qty, 0);
  const emails = (p.emails ?? []).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return {
    id: p.id,
    goods: p.goods.map((g) => ({
      good: { code: g.code, name: g.name, price: toKop(g.price) },
      quantity: g.qty * 1000,
      ...(p.isReturn ? { is_return: true } : {}),
    })),
    payments: [{ type: p.payType, value, label: p.label ?? (p.payType === "CASH" ? "Готівка" : "Картка") }],
    ...(p.isReturn && p.relatedId ? { related_receipt_id: p.relatedId } : {}),
    ...(emails.length ? { delivery: { emails } } : {}),
  };
}

// ---------- ответы Checkbox ----------

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const str = (x: unknown) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");

export type CheckboxReceipt = { id: string; status: "CREATED" | "PENDING" | "DONE" | "ERROR" | string; fiscalCode: string | null; taxUrl: string | null; error: string | null };

/** Ответ /receipts/sell и /receipts/{id}. Не похоже на чек — null. */
export function readCheckboxReceipt(body: unknown): CheckboxReceipt | null {
  const b = obj(body);
  const id = str(b.id);
  const status = str(b.status);
  if (!id || !status) return null;
  const tr = obj(b.transaction);
  const error = status === "ERROR" ? str(tr.response_error_message) || str(tr.response_status) || str(tr.status) || "Checkbox не смог зарегистрировать чек" : null;
  return { id, status, fiscalCode: str(b.fiscal_code) || null, taxUrl: str(b.tax_url) || null, error };
}

/** Смена кассира: /cashier/shift (нет смены — null в теле) и /shifts. */
export function readShift(body: unknown): { id: string; status: "CREATED" | "OPENED" | "CLOSING" | "CLOSED" | string } | null {
  const b = obj(body);
  const id = str(b.id);
  const status = str(b.status);
  return id && status ? { id, status } : null;
}

/** Ошибка Checkbox — по-русски для истории заказа и админки (без ключей). */
export function checkboxErrorText(status: number, body: unknown): string {
  const b = obj(body);
  if (status === 401 || status === 403) return "Checkbox не принял логин, пароль кассира или ключ кассы — проверьте их в «Интеграциях».";
  const detail = Array.isArray(b.detail) ? b.detail.map((d) => str(obj(d).msg)).filter(Boolean).join("; ") : str(b.detail);
  const t = [str(b.message), detail].filter(Boolean).join(": ");
  return `Checkbox ответил ошибкой ${status}${t ? `: ${t.slice(0, 300)}` : ""}.`;
}

// ---------- смена ----------

/** Закрыть смену пора: после 23:00 по Киеву (раз в сутки — следит база). Смена не может длиться больше 24 часов. */
export const shiftCloseDue = (kyivHour: number) => kyivHour >= 23;

// ---------- формы админки ----------

const num = (raw: string) => Number(String(raw ?? "").replace(/\s/g, "").replace(",", "."));

/** Ручной чек: сумма от 0,01 ₴ до ещё не пробитой части заказа; способ оплаты — картой или наличными. */
export function validateManualReceipt(raw: string, payRaw: string, max: number): { ok: true; amount: number; payType: ReceiptPayType } | { ok: false; error: string } {
  const a = round2(num(raw));
  if (!Number.isFinite(a) || a <= 0) return { ok: false, error: "Сумма чека — число больше нуля." };
  if (a > round2(max) + 0.001) return { ok: false, error: `Не больше суммы заказа без уже пробитых чеков: ${round2(max)} ₴.` };
  const payType = payRaw === "CASH" ? "CASH" : payRaw === "CASHLESS" ? "CASHLESS" : null;
  if (!payType) return { ok: false, error: "Выберите, как оплатили: картой или наличными." };
  return { ok: true, amount: a, payType };
}
