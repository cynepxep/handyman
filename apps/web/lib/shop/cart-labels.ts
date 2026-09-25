// Подписи корзины и окна «Купити в 1 клік» из реестра текстов (правятся в «Сайт → Тексты»).
import type { CartUiLabels } from "@/components/shop/cart/cart-context";
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
  };
}
