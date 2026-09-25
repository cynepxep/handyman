// Корневой layout витрины. Украинская версия — адреса без приставки (/catalog), русская — /ru/catalog
// (proxy.ts внутренне переписывает /catalog → /uk/catalog). Шрифты — выбор владельца: Roboto Condensed + Roboto.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Roboto, Roboto_Condensed } from "next/font/google";
import { isShopLang, paths, pickTexts, shopHref } from "@handyman/core/site";
import { alternatesFor, getShopContent, siteUrl } from "@/lib/shop/content";
import { ShopTextsProvider } from "@/components/shop/client-bits";
import { BottomNav, SiteFooter, SiteHeader } from "@/components/shop/site-chrome";
import { ShopCartProvider } from "@/components/shop/cart/cart-context";
import { cartUiLabels } from "@/lib/shop/cart-labels";
import { TextEditor } from "@/components/shop/text-editor";
import { getStaffSession } from "@/lib/auth";
import "@/components/shop/shop.css";

const robotoC = Roboto_Condensed({ variable: "--f-robotoc", subsets: ["latin", "cyrillic"], weight: ["400", "600", "700"] });
const roboto = Roboto({ variable: "--f-roboto", subsets: ["latin", "cyrillic"], weight: ["400", "500", "700"] });

// Цены и наличие меняются после каждого импорта: пока показываем свежие данные на каждый запрос.
// Кэширование страниц — в шаге 2.8 вместе с замером скорости.
export const dynamic = "force-dynamic";

/** Тексты, нужные клиентским страницам (например, «Щось пішло не так»). */
const CLIENT_TEXT_KEYS = ["error.title", "error.text", "error.retry", "notFound.home"] as const;

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  const site = t("meta.siteName");
  return {
    metadataBase: siteUrl(),
    title: { default: `${t("meta.home.title")} — ${site}`, template: `%s — ${site}` },
    description: t("meta.description"),
    // До запуска магазина (Этап 8) сайт закрыт от поисковиков.
    robots: { index: false, follow: false },
    alternates: alternatesFor(lang, "/"),
    openGraph: { siteName: site, locale: lang === "uk" ? "uk_UA" : "ru_UA", type: "website" },
    formatDetection: { telephone: false },
  };
}

export default async function ShopRootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isShopLang(lang)) notFound();
  const [c, staff] = await Promise.all([getShopContent(lang), getStaffSession().catch(() => null)]);
  // сотрудник с правом «Тексты» видит кнопку «✎ Редагувати тексти» (покупатели — нет)
  const canEditTexts = staff?.permissions.includes("texts.edit") ?? false;
  return (
    <html lang={lang} className={`${robotoC.variable} ${roboto.variable}`}>
      <body className="hm-body">
        <a className="hm-skip" href="#main">{c.t("header.skip")}</a>
        <ShopCartProvider lang={lang} labels={cartUiLabels(c.t)} cartHref={shopHref(lang, paths.cart())} checkoutHref={shopHref(lang, paths.checkout())}>
          <SiteHeader c={c} />
          <ShopTextsProvider lang={lang} texts={pickTexts(c.texts, CLIENT_TEXT_KEYS)}>
            <main id="main" className="hm-main" tabIndex={-1}>{children}</main>
          </ShopTextsProvider>
          <SiteFooter c={c} />
          <BottomNav c={c} />
        </ShopCartProvider>
        {canEditTexts && <TextEditor lang={lang} />}
      </body>
    </html>
  );
}
