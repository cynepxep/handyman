import type { Metadata } from "next";
import { Roboto, Roboto_Condensed } from "next/font/google";
import "@/components/shop/shop.css";

// Корневой layout служебных стендов дизайна: закрыты от поисковиков, в меню сайта не входят.
const robotoC = Roboto_Condensed({ variable: "--f-robotoc", subsets: ["latin", "cyrillic"], weight: ["400", "600", "700"] });
const roboto = Roboto({ variable: "--f-roboto", subsets: ["latin", "cyrillic"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "Стенд дизайна (служебная)",
  robots: { index: false, follow: false },
};

export default function DesignRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={`${robotoC.variable} ${roboto.variable}`}>
      <body className="hm-body">{children}</body>
    </html>
  );
}
