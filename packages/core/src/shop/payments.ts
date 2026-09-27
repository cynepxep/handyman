// Оплата картой через monobank (шаг 3.2): чистая логика без базы и сети — сколько просить, как собрать счёт, как понять ответ mono,
// сколько по счёту зачтено после оплаты и возвратов. Деньги считает только сервер: сумма счёта — из заказа, не из браузера.
// Проверка подписи уведомления (node:crypto) — в packages/db/src/payments.ts, сюда её не класть (модуль импортирует браузер).

/** Состояния счёта mono (invoice/status). hold не используем (оплата сразу, paymentType=debit). */
export type MonoStatus = "created" | "processing" | "hold" | "success" | "failure" | "reversed" | "expired";
export const MONO_STATUSES: MonoStatus[] = ["created", "processing", "hold", "success", "failure", "reversed", "expired"];
/** Ещё не оплачен и не закрыт — ждём. */
export const MONO_PENDING: MonoStatus[] = ["created", "processing", "hold"];

/** prepay — предоплата с сайта, full — вся сумма с сайта, rest — доплата с сайта, manual — счёт, выставленный менеджером. */
export type InvoiceKind = "prepay" | "full" | "rest" | "manual";

export const PAY_STATUS_RU: Record<MonoStatus, string> = {
  created: "ждёт оплаты",
  processing: "оплата обрабатывается",
  hold: "деньги заблокированы",
  success: "оплачено",
  failure: "оплата не прошла",
  reversed: "деньги возвращены",
  expired: "срок ссылки истёк",
};
export const INVOICE_KIND_RU: Record<InvoiceKind, string> = { prepay: "предоплата", full: "полная оплата", rest: "доплата", manual: "счёт менеджера" };

/** Сколько живёт ссылка на оплату (validity в mono), секунд. */
export const INVOICE_VALIDITY_SEC = 24 * 3600;
/** Меньше гривны mono не принимает. */
export const MIN_PAY = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Гривны → копейки (mono считает в копейках). */
export const toKop = (uah: number) => Math.round(uah * 100);
const fromKop = (k: number) => round2(k / 100);

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const str = (x: unknown) => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");
const int = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : null);

// ---------- что просить у покупателя ----------

export type PayOrder = { payMode: string; status: string; total: number; dueNow: number; paidAmount: number };

/** Статусы, в которых покупатель уже не платит с сайта. */
const CLOSED = ["CANCELLED", "RETURNED", "DONE"];

/**
 * Кнопка «Сплатити» на странице заказа: сколько и за что. Предоплата — до суммы предоплаты (остаток — при получении),
 * полная — всё, что не оплачено. «По реквизитам» и «уточнит менеджер» с сайта не платятся (счёт может выставить менеджер).
 */
export function sitePayTarget(o: PayOrder): { kind: InvoiceKind; amount: number } | null {
  if (CLOSED.includes(o.status)) return null;
  const paid = Math.max(0, o.paidAmount);
  if (o.payMode === "PREPAY") {
    const left = round2(o.dueNow - paid);
    return left >= MIN_PAY ? { kind: paid > 0 ? "rest" : "prepay", amount: left } : null;
  }
  if (o.payMode === "FULL") {
    const left = round2(o.total - paid);
    return left >= MIN_PAY ? { kind: paid > 0 ? "rest" : "full", amount: left } : null;
  }
  return null;
}

/** Сколько ещё не оплачено по заказу (для счёта менеджера по умолчанию). */
export const unpaidOf = (o: PayOrder) => Math.max(0, round2(o.total - Math.max(0, o.paidAmount)));

// ---------- счёт ----------

export type InvoiceLine = { name: string; sku: string; qty: number; unitPrice: number };

/**
 * Тело запроса invoice/create. Корзина — построчно, если счёт на всю сумму заказа (сумма строк совпадает до копейки);
 * иначе (предоплата, доплата) — одна строка «Передплата за замовлення …», чтобы сумма корзины всегда равнялась сумме счёта.
 */
export function invoiceRequest(p: {
  no: string; amount: number; destination: string; items?: InvoiceLine[]; redirectUrl: string; webHookUrl?: string | null; validitySec?: number;
}) {
  const amount = toKop(p.amount);
  const lines = (p.items ?? []).map((i) => ({ name: i.name.slice(0, 128), qty: i.qty, sum: toKop(i.unitPrice), code: i.sku.slice(0, 64) }));
  const itemized = lines.length > 0 && lines.every((l) => l.qty > 0 && l.sum > 0) && lines.reduce((a, l) => a + l.sum * l.qty, 0) === amount;
  return {
    amount,
    ccy: 980,
    merchantPaymInfo: {
      reference: p.no,
      destination: p.destination.slice(0, 280),
      basketOrder: itemized ? lines : [{ name: p.destination.slice(0, 128), qty: 1, sum: amount, code: p.no }],
    },
    redirectUrl: p.redirectUrl,
    ...(p.webHookUrl ? { webHookUrl: p.webHookUrl } : {}),
    validity: p.validitySec ?? INVOICE_VALIDITY_SEC,
    paymentType: "debit",
  };
}

/** Адрес для уведомлений mono — только если у сайта есть https-адрес (PUBLIC_URL). Без него статус узнаём опросом. */
export function monoWebhookUrl(publicUrl: string | undefined | null): string | null {
  const base = (publicUrl ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[^\s/]+/.test(base) ? `${base}/api/pay/mono` : null;
}

/** Ответ invoice/create: { invoiceId, pageUrl }. */
export function readCreateResponse(status: number, body: unknown): { ok: true; invoiceId: string; pageUrl: string } | { ok: false; error: string } {
  const b = obj(body);
  const invoiceId = str(b.invoiceId);
  const pageUrl = str(b.pageUrl);
  if (status === 200 && invoiceId && /^https:\/\//.test(pageUrl)) return { ok: true, invoiceId, pageUrl };
  return { ok: false, error: monoErrorText(status, body) };
}

/** Ошибка mono для админки и журнала (по-русски, без ключей). */
export function monoErrorText(status: number, body: unknown): string {
  const b = obj(body);
  if (status === 401 || status === 403) return "monobank не принял токен — проверьте его в «Интеграциях».";
  const t = str(b.errText) || str(b.errorDescription) || str(b.errCode);
  return `monobank ответил ошибкой ${status}${t ? `: ${t}` : ""}.`;
}

// ---------- состояние счёта ----------

export type MonoInvoiceData = {
  invoiceId: string;
  status: MonoStatus;
  /** сумма счёта, ₴ */
  amount: number;
  /** сколько сейчас на счёте после возвратов, ₴ (mono finalAmount); null — mono не прислал */
  finalAmount: number | null;
  modifiedAt: Date | null;
  failureReason: string | null;
  reference: string;
  /** возвращено (успешные строки cancelList), ₴ */
  refunded: number;
  /** возврат ещё обрабатывается */
  refundPending: boolean;
};

/** Разобрать ответ invoice/status или тело уведомления mono (они одинаковые). Не похоже на счёт — null. */
export function readMonoInvoice(body: unknown): MonoInvoiceData | null {
  const b = obj(body);
  const invoiceId = str(b.invoiceId);
  const status = str(b.status) as MonoStatus;
  const amount = int(b.amount);
  if (!invoiceId || !MONO_STATUSES.includes(status) || amount === null) return null;
  const fin = int(b.finalAmount);
  const d = str(b.modifiedDate) || str(b.createdDate);
  const at = d ? new Date(d) : null;
  const cancels = Array.isArray(b.cancelList) ? b.cancelList.map(obj) : [];
  return {
    invoiceId, status, amount: fromKop(amount), finalAmount: fin === null ? null : fromKop(fin),
    modifiedAt: at && !Number.isNaN(at.getTime()) ? at : null,
    failureReason: str(b.failureReason) || str(b.errCode) || null,
    reference: str(b.reference),
    refunded: fromKop(cancels.filter((c) => str(c.status) === "success").reduce((a, c) => a + (int(c.amount) ?? 0), 0)),
    refundPending: cancels.some((c) => str(c.status) === "processing"),
  };
}

/** Сколько по счёту зачтено сейчас: оплачен — сумма после возвратов; всё возвращено, не оплачен — 0. */
export function creditedOf(d: Pick<MonoInvoiceData, "status" | "amount" | "finalAmount" | "refunded">): number {
  if (d.status === "success") return round2(Math.max(0, d.finalAmount ?? d.amount - d.refunded));
  if (d.status === "reversed") return round2(Math.max(0, d.finalAmount ?? 0));
  return 0;
}

/** Уведомления mono могут прийти не по порядку: более старое, чем уже записанное, не применяем. */
export const isStale = (stored: Date | null, incoming: Date | null) => stored != null && incoming != null && incoming.getTime() < stored.getTime();

/** Счёт закрыт окончательно — опрашивать больше не нужно. */
export const isFinal = (d: Pick<MonoInvoiceData, "status" | "refundPending">) => !MONO_PENDING.includes(d.status) && !d.refundPending;

/**
 * Как часто спрашивать mono о счёте, пока нет уведомлений: первые 30 минут — раз в минуту (покупатель сейчас платит),
 * потом — раз в 10 минут, до конца срока ссылки.
 */
export function pollDue(p: { createdAt: Date; checkedAt: Date | null }, now: Date): boolean {
  if (!p.checkedAt) return true;
  const age = now.getTime() - p.createdAt.getTime();
  const since = now.getTime() - p.checkedAt.getTime();
  return since >= (age < 30 * 60_000 ? 55_000 : 10 * 60_000);
}

// ---------- страница заказа ----------

export type PayView = "due" | "pending" | "failed" | "paid" | "none";

/**
 * Что показать покупателю на странице заказа: «сплатити», «чекаємо оплату», «оплата не пройшла», «оплату отримано».
 * `last` — последний счёт с сайта (если был).
 */
export function payViewOf(o: PayOrder, last: { status: string } | null): PayView {
  const target = sitePayTarget(o);
  if (!target) return o.paidAmount > 0 ? "paid" : "none";
  if (last && MONO_PENDING.includes(last.status as MonoStatus)) return "pending";
  if (last && (last.status === "failure" || last.status === "expired")) return "failed";
  return "due";
}

// ---------- формы админки ----------

const num = (raw: string) => Number(String(raw ?? "").replace(/\s/g, "").replace(",", "."));

/** Сумма счёта менеджера: от 1 ₴ до неоплаченной части заказа. */
export function validateInvoiceAmount(raw: string, max: number): { ok: true; amount: number } | { ok: false; error: string } {
  const a = round2(num(raw));
  if (!Number.isFinite(a) || a < MIN_PAY) return { ok: false, error: `Сумма счёта — число от ${MIN_PAY} ₴.` };
  if (a > round2(max) + 0.001) return { ok: false, error: `Не больше неоплаченной части заказа: ${round2(max)} ₴.` };
  return { ok: true, amount: a };
}

/** Сумма возврата: больше 0 и не больше зачтённого по счёту. */
export function validateRefund(raw: string, paid: number): { ok: true; amount: number } | { ok: false; error: string } {
  const a = round2(num(raw));
  if (!Number.isFinite(a) || a <= 0) return { ok: false, error: "Сумма возврата — число больше нуля." };
  if (a > round2(paid) + 0.001) return { ok: false, error: `Вернуть можно не больше оплаченного по этому счёту: ${round2(paid)} ₴.` };
  return { ok: true, amount: a };
}
