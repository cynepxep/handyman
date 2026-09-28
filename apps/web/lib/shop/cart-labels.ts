// Подписи корзины и окна «Купити в 1 клік» из реестра текстов (правятся в «Сайт → Тексты»).
import type { CartUiLabels } from "@/components/shop/cart/cart-context";
import type { CallbackLabels } from "@/components/shop/plus";
import type { NpEstLabels } from "@/components/shop/np-estimate";
import { stockLabels } from "@/components/shop/product-card";
import type { T } from "./content";

export function cartUiLabels(t: T): CartUiLabels {
  return {
    cart: t("cart"), empty: t("emptyT"), emptyText: t("emptyP"), subtotal: t("sub"), checkout: t("place"), continueShopping: t("contShop"),
    remove: t("cart.remove", { name: "{name}" }), gone: t("cart.gone"), loading: t("cart.loading"),
    qtyGroup: t("qty.label"), qtyDec: t("qty.dec"), qtyInc: t("qty.inc"), close: t("close"), openCart: t("cart.open", { n: "{n}" }),
    stock: stockLabels(t),
    oneClickTitle: t("oneClick.title"), oneClickLead: t("oneClick.lead"), phone: t("checkout.phone"), oneClickName: t("oneClick.name"),
    oneClickSubmit: t("oneClick.submit"), sending: t("checkout.sending"),
    qtyApplied: t("qty.applied", { price: "{price}" }), qtyHint: t("qty.hint", { n: "{n}", price: "{price}" }),
    np: npEstLabels(t),
  };
}

/** Шаг 3.4: стоимость и срок доставки НП, полоса «до бесплатной доставки». */
export function npEstLabels(t: T): NpEstLabels {
  return {
    line: t("np.est", { city: "{city}", cost: "{cost}", date: "{date}" }), cost: t("np.est.cost", { sum: "{sum}" }), free: t("np.est.free"),
    today: t("np.est.today"), tomorrow: t("np.est.tomorrow"), freeLeft: t("cart.freeShipping.left", { n: "{n}" }), freeDone: t("cart.freeShipping.done"),
    freeFrom: t("np.freeFrom", { sum: "{sum}" }),
  };
}

/** Шаг 5.6: окно «Передзвоніть мені» (страница товара, подвал). */
export function callbackLabels(t: T): CallbackLabels {
  return {
    btn: t("callback.btn"), title: t("callback.title"), lead: t("callback.lead"), phone: t("callback.phone"), name: t("callback.name"),
    send: t("callback.send"), sending: t("checkout.sending"), close: t("close"),
  };
}
