// Наличие товара для покупателя — три состояния:
//   local    — есть на нашем складе в Одессе (StockItem.onHand > 0): отправляем быстро;
//   supplier — нет у нас, но есть у поставщика: сначала заказываем у него, отправка минимум через 3–4 дня;
//   order    — нет нигде («Під замовлення»): срок уточняет менеджер, заказ обязательно подтверждаем звонком.
// Подписи и сроки — тексты в админке (stock.*), здесь только правило.

export type StockLevel = "local" | "supplier" | "order";

export function stockLevel(ownQty: number, supplierAvailable: boolean): StockLevel {
  if (ownQty > 0) return "local";
  return supplierAvailable ? "supplier" : "order";
}

/** Для сортировки: чем быстрее можно отправить, тем выше в списке. */
export const STOCK_RANK: Record<StockLevel, 2 | 1 | 0> = { local: 2, supplier: 1, order: 0 };

/** Ключи текстов состояния: подпись и пояснение. */
export const STOCK_TEXT: Record<StockLevel, { label: string; note: string }> = {
  local: { label: "stock.local", note: "stock.local.note" },
  supplier: { label: "stock.supplier", note: "stock.supplier.note" },
  order: { label: "stock.order", note: "stock.order.note" },
};

/**
 * Можно ли покупателю отказаться от звонка («Не телефонуйте мені»): нельзя, если в заказе есть «під замовлення» —
 * срок и наличие обязательно уточняем.
 */
export const canSkipCall = (levels: StockLevel[]) => !levels.includes("order");
