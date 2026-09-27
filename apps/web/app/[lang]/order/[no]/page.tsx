// Страница «Дякуємо» после заказа: /order/HM-1001?k=<ключ>. Без правильного ключа — 404 (чужой заказ по номеру не открыть).
// Личных данных покупателя здесь нет: номер, сумма, что будет дальше и как оплатить.
// Шаг 3.2: предоплата и полная оплата — кнопка «Сплатити» (monobank); сюда же банк возвращает покупателя после оплаты.
// Шаг 3.3: ссылки на готовые кассовые чеки Checkbox.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isShopLang, paths, shopHref } from "@handyman/core/site";
import { orderForThanks } from "@handyman/db/orders";
import { orderPayState, refreshOrderPayments } from "@handyman/db/payments";
import { orderReceiptLinks } from "@handyman/db/receipts";
import { MONO_PENDING, payViewOf } from "@handyman/core/shop";
import { getShopContent } from "@/lib/shop/content";
import { formatPrice } from "@/components/shop/format";
import { Icon } from "@/components/shop/icons";
import { btn } from "@/components/shop/ui";
import { PayBlock } from "@/components/shop/pay-block";

export async function generateMetadata({ params }: PageProps<"/[lang]/order/[no]">): Promise<Metadata> {
  const { lang, no } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("thanks.title", { no: decodeURIComponent(no) }), robots: { index: false, follow: false } };
}

export default async function ThanksPage({ params, searchParams }: PageProps<"/[lang]/order/[no]">) {
  const { lang, no } = await params;
  if (!isShopLang(lang)) notFound();
  const k = (await searchParams).k;
  const key = typeof k === "string" ? k : "";
  const o = await orderForThanks(decodeURIComponent(no), key);
  if (!o) notFound();
  const c = await getShopContent(lang);
  const { t } = c;
  // оплата картой: вернулись из банка — сразу спросим mono (не дожидаясь фоновой проверки)
  let pay = await orderPayState(o.no, key);
  if (pay?.last && !pay.last.stub && (MONO_PENDING as string[]).includes(pay.last.status)) {
    await refreshOrderPayments(o.no, key).catch(() => undefined);
    pay = await orderPayState(o.no, key);
  }
  const receipts = await orderReceiptLinks(o.no, key);
  const online = pay != null && pay.mode !== "off";
  const view = pay ? payViewOf(pay.order, pay.last) : "none";
  const paid = pay?.order.paidAmount ?? 0;

  const payLine =
    o.payMode === "PREPAY" ? t("thanks.pay.prepay", { sum: formatPrice(o.dueNow) })
    : o.payMode === "FULL" ? t("thanks.pay.full", { sum: formatPrice(o.total) })
    : o.payMode === "CARD" ? t("thanks.pay.card", { sum: formatPrice(o.total), no: o.no })
    : t("thanks.pay.pickup", { sum: formatPrice(o.total) });

  return (
    <section className="hm-section hm-thanks">
      <h1 className="hm-h1">{t("thanks.title", { no: o.no })}</h1>
      <div className="hm-panel">
        <p className="hm-muted">{t("thanks.number")}</p>
        <p><span className="hm-thanks-no">{o.no}</span></p>
        <p>{t("thanks.next")}</p>
        <div className="hm-sum">
          <div className="is-total"><span>{t("tot")}</span><span>{formatPrice(o.total)}</span></div>
          {o.dueNow > 0 && o.later > 0 && (
            <>
              <div className="is-now"><span>{t("payNow")}</span><span>{formatPrice(o.dueNow)}</span></div>
              <div><span>{t("later")}</span><span>{formatPrice(o.later)}</span></div>
            </>
          )}
        </div>
        {paid > 0 && <p className="hm-alert hm-alert-ok">{view === "paid" ? `${t("paidT")} ${t("pay.paid.sum", { sum: formatPrice(paid) })}` : t("pay.paid.sum", { sum: formatPrice(paid) })}</p>}
        {receipts.length > 0 && (
          <ul className="hm-receipts">
            {receipts.map((r) => (
              <li key={r.url}>
                <a className="hm-link" href={r.url} target="_blank" rel="noopener">
                  {t(r.kind === "return" ? "pay.receipt.return" : "pay.receipt", { sum: formatPrice(r.amount) })}
                </a>
              </li>
            ))}
          </ul>
        )}
        {online && pay?.target && view !== "none" && view !== "paid" ? (
          <PayBlock
            lang={lang} no={o.no} k={key} view={view} stub={pay.mode === "stub"}
            labels={{
              btn: t("pay.btn", { sum: formatPrice(pay.target.amount) }),
              lead: t(pay.target.kind === "prepay" ? "pay.lead.prepay" : pay.target.kind === "rest" ? "pay.lead.rest" : "pay.lead.full", { sum: formatPrice(pay.target.amount) }),
              later: t("pay.later"), pending: t("pay.pending"), notYet: t("pay.notYet"), failed: t("pay.failed"), retry: t("retry"),
              checkPay: t("checkPay"), devPay: t("devPay"), stub: t("pay.stub"), noPay: t("noPay"),
            }}
          />
        ) : (
          view !== "paid" && <p className="hm-alert">{payLine}</p>
        )}
        {o.payMode === "CARD" && (
          <div>
            <p><b>{t("cardInfoT")}</b></p>
            <p style={{ whiteSpace: "pre-line" }}>{t("checkout.requisites")}</p>
          </div>
        )}
      </div>
      {c.contacts.telegram && (
        <div className="hm-panel">
          <p>{t("thanks.telegram")}</p>
          <div>
            <a className="hm-pill" href={c.contacts.telegram} target="_blank" rel="noopener"><Icon name="chat" size={18} />Telegram</a>
          </div>
        </div>
      )}
      <div>
        <Link className={btn("primary")} href={shopHref(lang, paths.catalog())}>{t("thanks.home")}</Link>
      </div>
    </section>
  );
}
