// «Сторінку не знайдено» на языке сайта (язык берётся из адреса через next/root-params).
import Link from "next/link";
import { lang } from "next/root-params";
import { isShopLang, paths, shopHref } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { btn } from "@/components/shop/ui";

export default async function ShopNotFound() {
  const l = await lang();
  const shopLang = isShopLang(l) ? l : "uk";
  const { t } = await getShopContent(shopLang);
  return (
    <section className="hm-section" style={{ paddingTop: 24 }}>
      <div className="hm-empty">
        <h1 className="hm-h1">{t("notFound.title")}</h1>
        <p className="hm-muted">{t("notFound.text")}</p>
        <div className="hm-help-btns">
          <Link className={btn("primary")} href={shopHref(shopLang, paths.catalog())}>{t("notFound.catalog")}</Link>
          <Link className={btn("secondary")} href={shopHref(shopLang, paths.home())}>{t("notFound.home")}</Link>
        </div>
      </div>
    </section>
  );
}
