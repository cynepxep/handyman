"use client";

// «Щось пішло не так»: если страница упала, шапка и подвал остаются, покупатель может повторить или уйти на главную.
import { shopHref } from "@handyman/core/site/routes";
import { useShop } from "@/components/shop/client-bits";
import { btn } from "@/components/shop/ui";

export default function ShopError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { lang, texts: t } = useShop();
  return (
    <section className="hm-section" style={{ paddingTop: 24 }}>
      <div className="hm-empty" role="alert">
        <h1 className="hm-h1">{t["error.title"]}</h1>
        <p className="hm-muted">{t["error.text"]}</p>
        <div className="hm-help-btns">
          <button type="button" className={btn("primary")} onClick={() => reset()}>{t["error.retry"]}</button>
          <a className={btn("secondary")} href={shopHref(lang, "/")}>{t["notFound.home"]}</a>
        </div>
      </div>
    </section>
  );
}
