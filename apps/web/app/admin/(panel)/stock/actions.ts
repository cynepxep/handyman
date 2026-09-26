"use server";

import { redirect } from "next/navigation";
import { inventoryStock, receiveStock, setStockSettings } from "@handyman/db/stock";
import { validateInventory, validateReceiving } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { catalogChanged } from "@/lib/shop/cache";

export type StockFormState = { error?: string };

const who = (s: { name: string; username: string }) => s.name || s.username;

/** «Приход»: при ошибке форма остаётся как есть, при успехе — журнал этого документа. */
export async function receiveAction(_prev: StockFormState, formData: FormData): Promise<StockFormState> {
  const session = await requirePermission("stock.edit");
  const check = validateReceiving({ lines: formData.get("lines"), supplier: formData.get("supplier"), note: formData.get("note") });
  if (!check.ok) return { error: check.error };
  const r = await receiveStock({ warehouseId: String(formData.get("warehouseId") ?? "") || undefined, supplier: check.supplier, note: check.note, lines: check.lines }, who(session));
  if (!r.ok) return { error: r.error };
  catalogChanged();
  redirect(`/admin/stock/moves?doc=${r.docId}&ok=${encodeURIComponent(`Приход № ${r.seq} проведён.`)}`);
}

/** «Инвентаризация»: вписанный факт заменяет учётный остаток, разница — в журнал. */
export async function inventoryAction(_prev: StockFormState, formData: FormData): Promise<StockFormState> {
  const session = await requirePermission("stock.edit");
  const check = validateInventory({ lines: formData.get("lines"), note: formData.get("note") });
  if (!check.ok) return { error: check.error };
  const r = await inventoryStock({ warehouseId: String(formData.get("warehouseId") ?? "") || undefined, note: check.note, lines: check.lines }, who(session));
  if (!r.ok) return { error: r.error };
  catalogChanged();
  redirect(`/admin/stock/moves?doc=${r.docId}&ok=${encodeURIComponent(`Инвентаризация № ${r.seq} проведена: расхождений ${r.diffs}.`)}`);
}

/** Минимальный остаток и закупочная цена товара — из строки списка склада. */
export async function stockSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("stock.edit");
  const productId = String(formData.get("productId") ?? "");
  const back = String(formData.get("back") ?? "/admin/stock");
  const min = Number(String(formData.get("minStock") ?? "0").replace(/\s/g, ""));
  const costRaw = String(formData.get("purchasePrice") ?? "").replace(/\s/g, "").replace(",", ".");
  const cost = costRaw === "" ? null : Number(costRaw);
  if (!Number.isFinite(min) || min < 0 || (cost !== null && (!Number.isFinite(cost) || cost < 0))) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Минимум — целое число от 0, закупка — число от 0 (или пусто).")}`);
  }
  await setStockSettings(productId, { minStock: min, purchasePrice: cost === null ? null : Math.round(cost * 100) / 100 }, who(session));
  redirect(`${back}${back.includes("?") ? "&" : "?"}ok=${encodeURIComponent("Сохранено.")}`);
}
