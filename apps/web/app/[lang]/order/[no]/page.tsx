// Страница «Дякуємо» после заказа: /order/HM-1001?k=<ключ>. Без правильного ключа — 404 (чужой заказ по номеру не открыть).
// Личных данных покупателя здесь нет: номер, сумма, что будет дальше и как оплатить.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isShopLang, paths, shopHref } from "@handyman/core/site";
import { orderForThanks } from "@handyman/db/orders";
import { getShopContent } from "@/lib/shop/content";
import { formatPrice } from "@/components/shop/format";
import { Icon } from "@/components/shop/icons";
import { btn } from "@/components/shop/ui";

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
  const o = await orderForThanks(decodeURIComponent(no), typeof k === "string" ? k : "");
  if (!o) notFound();
  const c = await getShopContent(lang);
  const { t } = c;

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
        <p className="hm-alert">{payLine}</p>
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
