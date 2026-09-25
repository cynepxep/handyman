import type { Metadata } from "next";
import { Roboto, Roboto_Condensed } from "next/font/google";
import { paths } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { cartUiLabels } from "@/lib/shop/cart-labels";
import { ShopCartProvider } from "@/components/shop/cart/cart-context";
import "@/components/shop/shop.css";

// Корневой layout служебных стендов дизайна: закрыты от поисковиков, в меню сайта не входят.
const robotoC = Roboto_Condensed({ variable: "--f-robotoc", subsets: ["latin", "cyrillic"], weight: ["400", "600", "700"] });
const roboto = Roboto({ variable: "--f-roboto", subsets: ["latin", "cyrillic"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "Стенд дизайна (служебная)",
  robots: { index: false, follow: false },
};

export default async function DesignRootLayout({ children }: { children: React.ReactNode }) {
  // карточки товаров на стенде — настоящие, с кнопкой «У кошик»
  const { t } = await getShopContent("uk");
  return (
    <html lang="uk" className={`${robotoC.variable} ${roboto.variable}`}>
      <body className="hm-body">
        <ShopCartProvider lang="uk" labels={cartUiLabels(t)} cartHref={paths.cart()} checkoutHref={paths.checkout()}>{children}</ShopCartProvider>
      </body>
    </html>
  );
}
