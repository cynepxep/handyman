// Пока ищем — заглушки того же размера, что и карточки (страница не «прыгает» после загрузки).
import { lang } from "next/root-params";
import { isShopLang } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";
import { CardSkeletons } from "@/components/shop/ui";

export default async function SearchLoading() {
  const l = await lang();
  const { t } = await getShopContent(isShopLang(l) ? l : "uk");
  return (
    <section className="hm-section">
      <div className="hm-skel" style={{ height: 18, width: 180, marginTop: 14 }} />
      <div className="hm-skel" style={{ height: 36, width: "min(420px, 80%)" }} />
      <CardSkeletons count={8} label={t("a11y.loading")} />
    </section>
  );
}
