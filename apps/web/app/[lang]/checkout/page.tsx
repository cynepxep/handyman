// Оформление заказа: /checkout (рус. /ru/checkout). Какие способы доставки и оплаты показывать и сумма предоплаты —
// из админки «Сайт → Оформлення»; все подписи — «Сайт → Тексты» (группа «Оформление заказа»).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DELIVERY_CHOICES, PAY_CHOICES } from "@handyman/core/shop";
import { isShopLang, paths, shopHref } from "@handyman/core/site";
import { loadCheckoutSettings } from "@handyman/db/orders";
import { pickupPoints } from "@handyman/db/warehouses";
import { getShopContent } from "@/lib/shop/content";
import { formatPrice } from "@/components/shop/format";
import { stockLabels } from "@/components/shop/product-card";
import { CheckoutForm, type CheckoutLabels } from "@/components/shop/cart/checkout-form";
import { Breadcrumbs } from "@/components/shop/ui";

export async function generateMetadata({ params }: PageProps<"/[lang]/checkout">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("checkout.title"), robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params }: PageProps<"/[lang]/checkout">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const [c, s, pickups] = await Promise.all([getShopContent(lang), loadCheckoutSettings(), pickupPoints(lang).catch(() => [])]);
  const { t, pick } = c;
  // самовывоз: адрес магазина (один — сразу в пояснении; несколько — покупатель выбирает ниже)
  const one = pickups.length === 1 ? pickups[0] : null;
  const address = one
    ? [one.city, one.address].filter(Boolean).join(", ") + (one.hours ? ` (${one.hours})` : "")
    : pickups.length > 1
      ? pickups.map((p) => p.city).filter((x, i, a) => a.indexOf(x) === i).join(", ")
      : pick(c.contacts.addressUk, c.contacts.addressRu) || t("footer.unknown");
  const fullHint = [t("pay.full.hint"), s.fullPayDiscountPct > 0 ? t("fullS", { p: s.fullPayDiscountPct }) : ""].filter(Boolean).join(". ");
  const cardHint = [t("cardS"), s.fullPayDiscountPct > 0 ? t("fullS", { p: s.fullPayDiscountPct }) : ""].filter(Boolean).join(". ");

  const labels: CheckoutLabels = {
    contacts: t("checkout.contacts"), firstName: t("checkout.firstName"), lastName: t("checkout.lastName"), phone: t("checkout.phone"),
    delivery: t("deliv"), np: t("checkout.np"), npHint: t("checkout.np.hint"),
    npTypes: { warehouse: t("delivery.np.warehouse"), postomat: t("delivery.np.postomat"), address: t("delivery.np.address") },
    city: t("checkout.city"), cityPlaceholder: t("checkout.city.placeholder"), pointPlaceholder: t("checkout.npPoint.placeholder"),
    npSearching: t("checkout.np.searching"), npNone: t("checkout.np.none"), npPickCity: t("checkout.np.pickCity"), pickupChoose: t("checkout.pickup.choose"),
    npPoint: { warehouse: t("checkout.npPoint.warehouse"), postomat: t("checkout.npPoint.postomat"), address: t("checkout.npPoint.address") },
    pickup: t("delivery.pickup"), pickupHint: t("delivery.pickup.hint", { address }),
    courier: t("delivery.courier"), courierHint: t("delivery.courier.hint"), courierAddr: t("checkout.courierAddr"),
    pay: t("pay"),
    payTitles: { prepay: t("pre"), full: t("full"), card: t("card") },
    payHints: { prepay: t("pay.prepay.hint", { sum: formatPrice(s.prepayAmount) }), full: fullHint, card: cardHint },
    comment: t("comment"), noCall: t("noCall"), noCallOff: t("checkout.noCall.off"),
    summary: t("checkout.summary"), subtotal: t("sub"), discount: t("fd"), shipping: t("dl"), shippingTariff: t("tarif"), shippingFree: t("free"),
    total: t("tot"), payNow: t("payNow"), later: t("later"), payLater: t("checkout.payLater"),
    place: t("place"), sending: t("checkout.sending"), agree: t("checkout.agree"), loading: t("cart.loading"),
    empty: t("checkout.empty"), toCatalog: t("toCatalog"), gone: t("cart.gone"),
    stock: stockLabels(t),
  };

  return (
    <section className="hm-section">
      <Breadcrumbs
        label={t("crumbs.label")}
        items={[{ href: shopHref(lang, paths.home()), label: t("crumbs.home") }, { href: shopHref(lang, paths.cart()), label: t("cart") }, { label: t("checkout.title") }]}
      />
      <h1 className="hm-h1">{t("checkout.title")}</h1>
      <CheckoutForm
        lang={lang}
        labels={labels}
        options={{ pay: PAY_CHOICES.filter((k) => s.pay[k]), delivery: DELIVERY_CHOICES.filter((k) => s.delivery[k]) }}
        catalogHref={shopHref(lang, paths.catalog())}
        pickups={pickups}
      />
    </section>
  );
}
