/** Цвет отметки статуса заказа в админке: новый — жёлтый, отмена/не дозвонились — красный, выполнен — зелёный. */
export const statusChip = (s: string) =>
  s === "NEW" ? "adm-chip warn" : s === "CANCELLED" || s === "RETURNED" || s === "NO_ANSWER" ? "adm-chip bad" : s === "DONE" ? "adm-chip ok" : "adm-chip";
