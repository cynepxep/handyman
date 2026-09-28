"use client";

// «Щось пішло не так»: если страница упала, шапка и подвал остаются, покупатель может повторить или уйти на главную.
// Шаг 8.2: ошибка уходит в журнал ошибок (/api/client-error → «Ошибки» в админке).
import { useEffect } from "react";
import { shopHref } from "@handyman/core/site/routes";
import { useShop } from "@/components/shop/client-bits";
import { btn } from "@/components/shop/ui";
import { reportClientError } from "@/lib/client-error";

export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { lang, texts: t } = useShop();
  useEffect(() => reportClientError(error, "shop"), [error]);
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
