"use server";

// Оплата картой на странице заказа (шаг 3.2): «Сплатити», «Я сплатив(ла), перевірити», тестовая оплата (без токена mono, не в production).
// Из браузера приходят только номер заказа и ключ из ссылки; сумму счёта сервер берёт из заказа.
import { isShopLang, type ShopLang } from "@handyman/core/site";
import { payViewOf, type PayView } from "@handyman/core/shop";
import { orderPayState, payFromSite, refreshOrderPayments, stubPay } from "@handyman/db/payments";
import { getShopContent } from "@/lib/shop/content";
import { requestOrigin } from "@/lib/request-origin";

const langOf = (l: unknown): ShopLang => (isShopLang(l) ? l : "uk");
const NO = /^HM-\d{1,9}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const valid = (no: unknown, key: unknown): [string, string] | null =>
  typeof no === "string" && typeof key === "string" && NO.test(no) && KEY.test(key) ? [no, key] : null;

// «перевірити» и автопроверка страницы: не чаще раза в 4 секунды на заказ (в памяти сервера)
const lastCheck = new Map<string, number>();
function throttled(no: string): boolean {
  const now = Date.now();
  if (now - (lastCheck.get(no) ?? 0) < 4000) return true;
  lastCheck.set(no, now);
  if (lastCheck.size > 5000) lastCheck.clear();
  return false;
}

export type StartPayResult = { ok: true; url: string; stub: boolean } | { ok: false; message: string; refresh?: boolean };

/** «Сплатити»: ссылка на страницу оплаты mono (или тестовая оплата). */
export async function startPayAction(lang: unknown, no: unknown, key: unknown): Promise<StartPayResult> {
  const { t } = await getShopContent(langOf(lang));
  const v = valid(no, key);
  if (!v) return { ok: false, message: t("noPay") };
  const r = await payFromSite(v[0], v[1], await requestOrigin());
  if (r.ok) return { ok: true, url: r.pageUrl, stub: r.stub };
  // уже оплачено или заказ закрыт — просто обновить страницу
  return { ok: false, message: t("noPay"), refresh: r.reason === "nothing" };
}

/** Спросить банк об оплате. Возвращает, что теперь показывать; changed — обновить страницу. */
export async function checkPayAction(no: unknown, key: unknown, was: unknown): Promise<{ view: PayView; changed: boolean }> {
  const v = valid(no, key);
  if (!v) return { view: "none", changed: false };
  if (!throttled(v[0])) await refreshOrderPayments(v[0], v[1]).catch(() => undefined);
  const s = await orderPayState(v[0], v[1]);
  const view = s ? payViewOf(s.order, s.last) : "none";
  return { view, changed: view !== was };
}

/** «Тест: імітувати оплату» — только пока mono не подключён и сайт не в production. */
export async function stubPayAction(no: unknown, key: unknown): Promise<boolean> {
  const v = valid(no, key);
  return v ? stubPay(v[0], v[1]) : false;
}
