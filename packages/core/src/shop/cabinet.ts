// Кабинет покупателя (Этап 5, шаг 5.5): общая корзина сайт ↔ Mini App, «Мій інструмент» и подбор расходников к нему.
// Чистая логика без базы; работает и в браузере (без node:crypto).
import { cleanCart, MAX_QTY, type CartLineInput } from "./order";

// ---------- общая корзина ----------

export type CartSyncInput = {
  /** корзина на сервере и её версия (растёт при каждой записи) */
  server: CartLineInput[];
  serverVersion: number;
  /** корзина в этом браузере */
  local: CartLineInput[];
  /** какую версию сервера браузер видел последней (0 — никогда не синхронизировался) */
  baseVersion: number;
  /** браузер менял корзину после последней синхронизации */
  dirty: boolean;
};

export type CartSyncResult = { lines: CartLineInput[]; save: boolean };

/**
 * Что делать при встрече корзины браузера с корзиной на сервере.
 * - браузер ничего не менял → берём серверную (её могли поменять в Mini App или на другом устройстве);
 * - менял, а сервер с тех пор не менялся → сохраняем браузерную (в т. ч. пустую: оформил заказ или всё удалил);
 * - менялись оба (или браузер ещё не синхронизировался — первый вход) → объединяем: все товары, количество — большее.
 */
export function mergeCartSync(i: CartSyncInput): CartSyncResult {
  const server = cleanCart(i.server);
  const local = cleanCart(i.local);
  if (!i.dirty) return { lines: server, save: false };
  if (i.baseVersion > 0 && i.baseVersion === i.serverVersion) return { lines: local, save: !sameCart(local, server) };
  const qty = new Map<string, number>();
  for (const l of [...server, ...local]) qty.set(l.sku, Math.min(MAX_QTY, Math.max(qty.get(l.sku) ?? 0, l.qty)));
  const lines = cleanCart([...qty.entries()].map(([sku, q]) => ({ sku, qty: q })));
  return { lines, save: !sameCart(lines, server) };
}

export function sameCart(a: CartLineInput[], b: CartLineInput[]): boolean {
  return a.length === b.length && a.every((l, n) => l.sku === b[n].sku && l.qty === b[n].qty);
}

// ---------- «Мій інструмент» ----------

/** Сколько инструментов и избранного хранится у покупателя (защита от бесконечных списков). */
export const MAX_TOOLS = 30;
export const MAX_FAVORITES = 200;

/** Чем пользуется инструмент — от этого зависят подходящие расходники. */
export type ToolKind = "grinder" | "circularSaw" | "drill" | "perforator" | "screwdriver" | "cordless" | "other";

export type ToolInfo = { categoryId: string; name: string; facets: Record<string, string[]> };

const TOOL_CATEGORY = /^(el|gr|pw|bld)(-|$)|^ak-seriya-.+-(elektroinstrument|sadovo-parkova-tekhnika)$|^zvaryuvalne-obladnannya(-|$)/;

/** Инструмент (а не расходник, аккумулятор или ручной инструмент): такое можно добавить в «Мій інструмент». */
export function isToolCategory(categoryId: string): boolean {
  if (/^ak-seriya-.+-(akumulyatory|zaryadni|keysy|portatyvni)/.test(categoryId)) return false;
  return TOOL_CATEGORY.test(categoryId) || categoryId === "ak";
}

export function toolKind(t: Pick<ToolInfo, "categoryId" | "name">): ToolKind {
  const n = t.name.toLowerCase();
  const c = t.categoryId;
  if (c === "el-kutovi-shlifuvalni-mashyny" || /кутов\S* шліф|болгарк|\bкшм\b|\bушм\b/.test(n)) return "grinder";
  if (/^el-pyly-(tsyrkulyarni|tortsyuvalni|vidrizni)$/.test(c) || /циркуляр|дисков\S* пил|торцюв/.test(n)) return "circularSaw";
  if (c === "el-perforatory" || /перфоратор/.test(n)) return "perforator";
  if (/шуруп|гвинтокрут|гайкокрут|імпакт/.test(n) || c === "el-haykokruty-ta-hvyntokruty-merezhevi") return "screwdriver";
  if (c === "el-dryli" || /дриль/.test(n)) return "drill";
  if (c.startsWith("ak-seriya-") || c === "ak") return "cordless";
  return "other";
}

/**
 * Куда вести за расходниками к инструменту: подгруппа меню (по коду) и фильтры.
 * Коды подгрупп — из стартового меню (storefront-menu.ts); если владелец их удалил, ссылка просто не показывается.
 */
export type ConsumableLink = { key: "discs" | "sawDiscs" | "drills" | "concrete" | "bits" | "batteries" | "chargers"; groupId: string; subId: string; facets?: Record<string, string> };

export function consumablesFor(t: ToolInfo): ConsumableLink[] {
  const out: ConsumableLink[] = [];
  const diameter = t.facets.diameter?.[0];
  const series = t.facets.series?.[0];
  const d = diameter ? { diameter } : undefined;
  switch (toolKind(t)) {
    case "grinder":
      out.push({ key: "discs", groupId: "discs", subId: "discs-cut", facets: d });
      break;
    case "circularSaw":
      out.push({ key: "sawDiscs", groupId: "discs", subId: "discs-saw", facets: d });
      break;
    case "perforator":
      out.push({ key: "concrete", groupId: "drills", subId: "drills-concrete" });
      break;
    case "drill":
      out.push({ key: "drills", groupId: "drills", subId: "drills-metal" });
      break;
    case "screwdriver":
      out.push({ key: "bits", groupId: "hand", subId: "hand-screw" });
      out.push({ key: "drills", groupId: "drills", subId: "drills-metal" });
      break;
    default:
      break;
  }
  if (series) {
    out.push({ key: "batteries", groupId: "cordless", subId: "cordless-batteries", facets: { series } });
    out.push({ key: "chargers", groupId: "cordless", subId: "cordless-chargers", facets: { series } });
  }
  return out;
}
