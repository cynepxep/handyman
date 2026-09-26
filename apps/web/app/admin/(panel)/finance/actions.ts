"use server";

import { redirect } from "next/navigation";
import { addExpense, copyExpensesFromPrev, deleteExpense, saveFinance, setOrderDeliveryCost } from "@handyman/db/finance";
import { validateExpense } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";

const who = (s: { name: string; username: string }) => s.name || s.username;
const back = (month: string, kind: "ok" | "error", text: string) => `/admin/finance?m=${encodeURIComponent(month)}&${kind}=${encodeURIComponent(text)}`;

export async function addExpenseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finance.view");
  const month = String(formData.get("month") ?? "");
  const check = validateExpense(Object.fromEntries(formData));
  if (!check.ok) redirect(back(month, "error", check.error));
  await addExpense(check.value, who(session));
  redirect(back(month, "ok", "Расход добавлен."));
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finance.view");
  await deleteExpense(String(formData.get("id") ?? ""), who(session));
  redirect(back(String(formData.get("month") ?? ""), "ok", "Расход удалён."));
}

export async function copyExpensesAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finance.view");
  const month = String(formData.get("month") ?? "");
  const n = await copyExpensesFromPrev(month, who(session));
  redirect(back(month, n ? "ok" : "error", n ? `Скопировано расходов: ${n}.` : "В прошлом месяце расходов нет."));
}

export async function saveFinanceSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finance.view");
  const g = (k: string) => String(formData.get(k) ?? "");
  await saveFinance(
    { commissionPct: { PREPAY: g("c_PREPAY"), FULL: g("c_FULL"), CARD: g("c_CARD"), LATER: g("c_LATER") }, dealerDiscountPct: g("dealerDiscountPct"), minMarginPct: g("minMarginPct") },
    who(session),
  );
  redirect(back(g("month"), "ok", "Настройки сохранены — прибыль пересчитана."));
}

/** Доставка за счёт магазина — из карточки заказа. */
export async function orderDeliveryCostAction(formData: FormData): Promise<void> {
  const session = await requirePermission("finance.view");
  const id = String(formData.get("id") ?? "");
  const v = Number(String(formData.get("shopDeliveryCost") ?? "0").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(v) || v < 0) redirect(`/admin/orders/${id}?error=${encodeURIComponent("Сумма доставки — число от 0.")}`);
  await setOrderDeliveryCost(id, v, who(session));
  redirect(`/admin/orders/${id}?ok=${encodeURIComponent("Доставка за счёт магазина сохранена.")}`);
}
