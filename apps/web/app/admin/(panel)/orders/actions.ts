"use server";

import { redirect } from "next/navigation";
import type { OrderStatus } from "@handyman/db";
import { ORDER_STATUSES, placeManualOrder, saveSeller, setOrderStatus } from "@handyman/db/orders";
import { sendOrderMessages } from "@handyman/db/messages";
import { retryOutbox } from "@handyman/db/notify";
import { MONO_PENDING, unpaidOf, validateInvoiceAmount, validateManualOrder, validateManualReceipt, validateRefund, validateSeller } from "@handyman/core/shop";
import { PaymentError, cancelInvoiceLink, createManagerInvoice, orderInvoices, refreshInvoice, refundInvoice } from "@handyman/db/payments";
import { ReceiptError, createManualReceipt, receiptableOf, retryReceipt, sendReceiptToClient } from "@handyman/db/receipts";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";
import { requestOrigin } from "@/lib/request-origin";

const back = (id: string, kind: "ok" | "error", text: string) => `/admin/orders/${encodeURIComponent(id)}?${kind}=${encodeURIComponent(text)}`;

export type ManualOrderState = { error?: string; values?: Record<string, string> };

/** «Заказ по звонку»: при ошибке форма остаётся с введёнными данными; при успехе — переход в карточку нового заказа. */
export async function createManualOrderAction(_prev: ManualOrderState, formData: FormData): Promise<ManualOrderState> {
  const session = await requirePermission("orders.edit");
  const raw = Object.fromEntries(formData);
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  const check = validateManualOrder(raw);
  if (!check.ok) return { error: check.error, values };
  const r = await placeManualOrder(check.value, session.name || session.username);
  if (!r.ok) return { error: r.error, values };
  redirect(back(r.id, "ok", `Заказ ${r.no} создан.`));
}

/** Реквизиты продавца для счёта (право «Настройки магазина»). */
export async function saveSellerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.edit");
  const check = validateSeller(Object.fromEntries(formData));
  if (!check.ok) redirect(`/admin/orders/seller?error=${encodeURIComponent(check.error)}`);
  await saveSeller(check.value, session.name || session.username);
  redirect(`/admin/orders/seller?ok=${encodeURIComponent("Реквизиты сохранены.")}`);
}

/** Сменить статус и/или добавить заметку, затем отправить выбранные сообщения покупателю. Отмена и возврат возвращают товар на наш склад. */
export async function setStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const who = session.name || session.username;
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!(ORDER_STATUSES as string[]).includes(status)) redirect(back(id, "error", "Выберите статус из списка."));
  const r = await setOrderStatus(id, status as OrderStatus, who, note || undefined, String(formData.get("cancelReason") ?? "") || undefined);
  if (!r.ok) redirect(back(id, "error", r.error ?? "Не удалось сохранить."));
  const templateIds = formData.getAll("tpl").map(String).filter(Boolean);
  const customText = String(formData.get("custom") ?? "");
  if (!templateIds.length && !customText.trim()) redirect(back(id, "ok", "Сохранено."));
  const rep = await sendOrderMessages(id, { templateIds, customText }, who);
  const parts = [
    rep.sent && `отправлено в Telegram: ${rep.sent}`,
    rep.noChannel && `сохранено для копирования (покупатель ещё без бота): ${rep.noChannel}`,
    rep.dev && `не отправлено — бот не настроен: ${rep.dev}`,
    rep.failed && `ошибка отправки: ${rep.failed}`,
  ].filter(Boolean);
  redirect(back(id, rep.failed ? "error" : "ok", `Сохранено. Сообщения: ${parts.join("; ")}.`));
}

/** Повторить неудачную отправку сообщения. */
export async function retryMessageAction(formData: FormData): Promise<void> {
  await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const r = await retryOutbox(String(formData.get("msg") ?? ""));
  redirect(back(id, r === "SENT" ? "ok" : "error", r === "SENT" ? "Сообщение отправлено." : "Не удалось отправить — проверьте настройки бота."));
}

// ---------- оплата картой monobank (шаг 3.2) ----------

const payError = (e: unknown) => (e instanceof PaymentError ? e.message : "Не получилось — попробуйте ещё раз.");

/** Выставить счёт на оплату картой (сумма — не больше неоплаченной части) и, если отмечено, отправить ссылку покупателю. */
export async function createInvoiceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const o = await prisma.order.findUnique({ where: { id }, select: { payMode: true, status: true, total: true, dueNow: true, paidAmount: true } });
  if (!o) redirect("/admin/orders");
  const check = validateInvoiceAmount(String(formData.get("amount") ?? ""), unpaidOf({ ...o, total: o.total.toNumber(), dueNow: o.dueNow.toNumber(), paidAmount: o.paidAmount.toNumber() }));
  if (!check.ok) redirect(back(id, "error", check.error));
  let text: string;
  try {
    const inv = await createManagerInvoice(id, check.amount, session.name || session.username, await requestOrigin(), formData.get("send") === "on");
    text = `Счёт на ${check.amount} ₴ создан${inv.stub ? " (тестовый: mono не подключён)" : ""}${inv.sent ? `; ${inv.sent}` : ""}.`;
  } catch (e) {
    redirect(back(id, "error", payError(e)));
  }
  redirect(back(id, "ok", text));
}

/** «Проверить оплату»: спросить mono о счетах заказа, которые ждут оплаты или возврата. */
export async function refreshPaymentsAction(formData: FormData): Promise<void> {
  await requirePermission("orders.view");
  const id = String(formData.get("id") ?? "");
  const open = (await orderInvoices(id)).filter((i) => !i.stub && ((MONO_PENDING as string[]).includes(i.status) || i.checkUntil));
  let err = "";
  for (const i of open) await refreshInvoice(i.id, "проверка менеджером").catch((e) => (err = payError(e)));
  redirect(back(id, err ? "error" : "ok", err || (open.length ? "Оплата проверена." : "Нет счетов, которые ждут оплаты.")));
}

/** Отменить неоплаченную ссылку. */
export async function cancelInvoiceAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  try {
    await cancelInvoiceLink(String(formData.get("invoice") ?? ""), session.name || session.username);
  } catch (e) {
    redirect(back(id, "error", payError(e)));
  }
  redirect(back(id, "ok", "Ссылка на оплату отменена."));
}

/** Вернуть деньги покупателю (право «Оплата: возврат денег»; по умолчанию — только владелец). */
export async function refundAction(formData: FormData): Promise<void> {
  const session = await requirePermission("payments.refund");
  const id = String(formData.get("id") ?? "");
  const invoiceId = String(formData.get("invoice") ?? "");
  if (formData.get("confirm") !== "on") redirect(back(id, "error", "Поставьте галочку «Подтверждаю возврат» — деньги уйдут покупателю."));
  const inv = (await orderInvoices(id)).find((i) => i.id === invoiceId);
  if (!inv) redirect(back(id, "error", "Счёт не найден."));
  const check = validateRefund(String(formData.get("amount") ?? ""), inv.paid.toNumber());
  if (!check.ok) redirect(back(id, "error", check.error));
  let text: string;
  try {
    const r = await refundInvoice(invoiceId, check.amount, session.name || session.username);
    text = r.pending ? `Возврат ${check.amount} ₴ отправлен в monobank — банк ещё обрабатывает, статус обновится сам.` : `Возврат ${check.amount} ₴ выполнен.`;
  } catch (e) {
    redirect(back(id, "error", payError(e)));
  }
  redirect(back(id, "ok", text));
}

// ---------- кассовые чеки Checkbox (шаг 3.3) ----------

const receiptErr = (e: unknown) => (e instanceof ReceiptError ? e.message : "Не получилось — попробуйте ещё раз.");
const RECEIPT_DONE: Record<string, string> = { done: "готов", sent: "принят Checkbox, номер появится через минуту", queued: "не отправился — сайт повторит сам", error: "не создан" };

/** Чек вручную: оплата наличными/картой при самовывозе или по звонку. */
export async function manualReceiptAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const check = validateManualReceipt(String(formData.get("amount") ?? ""), String(formData.get("payType") ?? ""), await receiptableOf(id));
  if (!check.ok) redirect(back(id, "error", check.error));
  let st: string | null;
  try {
    st = (await createManualReceipt(id, check.amount, check.payType, session.name || session.username)).status;
  } catch (e) {
    redirect(back(id, "error", receiptErr(e)));
  }
  redirect(back(id, st === "error" ? "error" : "ok", `Чек на ${check.amount} ₴: ${RECEIPT_DONE[st ?? "queued"] ?? st}.`));
}

/** «Повторить» чек со статусом «не создан». */
export async function retryReceiptAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  let st: string | null;
  try {
    st = await retryReceipt(String(formData.get("receipt") ?? ""), session.name || session.username);
  } catch (e) {
    redirect(back(id, "error", receiptErr(e)));
  }
  redirect(back(id, st === "error" ? "error" : "ok", `Чек: ${RECEIPT_DONE[st ?? "queued"] ?? st}.`));
}

/** Отправить покупателю ссылку на чек ещё раз. */
export async function sendReceiptAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  let text: string;
  try {
    text = await sendReceiptToClient(String(formData.get("receipt") ?? ""), session.name || session.username);
  } catch (e) {
    redirect(back(id, "error", receiptErr(e)));
  }
  redirect(back(id, "ok", `Чек: ${text}.`));
}
