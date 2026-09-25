"use client";

// Маленькие клиентские части витрины: переключатель языка, кнопка «Пошук» внизу, тексты для страницы ошибки.
import { createContext, useContext } from "react";
import { shopHref, switchLang, type ShopLang } from "@handyman/core/site/routes";
import { Icon } from "./icons";
import { SEARCH_INPUT_ID } from "./search-box";

/**
 * УКР / РУС. Адрес другой версии берётся в момент нажатия из адресной строки: так переключатель ведёт на ту же страницу
 * (с тем же поиском), а сервер может отдавать одинаковую разметку для всех страниц. Без JS — ведёт на главную другого языка.
 * «УКР» и «РУС» — обозначения языков, одинаковые на обоих языках, поэтому не в реестре текстов.
 */
export function LangSwitch({ lang, label }: { lang: ShopLang; label: string }) {
  const go = (to: ShopLang) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const { pathname, search, hash } = window.location;
    window.location.assign(switchLang(`${pathname}${search}${hash}`, to));
  };
  return (
    <span className="hm-lang" role="group" aria-label={label}>
      {lang === "uk" ? <b aria-current="true">УКР</b> : <a href={shopHref("uk", "/")} hrefLang="uk" lang="uk" onClick={go("uk")}>УКР</a>}
      {lang === "ru" ? <b aria-current="true">РУС</b> : <a href={shopHref("ru", "/")} hrefLang="ru" lang="ru" onClick={go("ru")}>РУС</a>}
    </span>
  );
}

/** Кнопка «Пошук» в нижней панели телефона: поднимает к полю поиска в шапке и ставит в него курсор. */
export function FocusSearchButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
        document.getElementById(SEARCH_INPUT_ID)?.focus({ preventScroll: true });
      }}
    >
      <Icon name="search" size={22} />
      {label}
    </button>
  );
}

// Тексты и язык для клиентских страниц (например, «Щось пішло не так»): кладутся в layout, читаются через useShop().
const ShopContext = createContext<{ lang: ShopLang; texts: Record<string, string> }>({ lang: "uk", texts: {} });
export function ShopTextsProvider({ lang, texts, children }: { lang: ShopLang; texts: Record<string, string>; children: React.ReactNode }) {
  return <ShopContext.Provider value={{ lang, texts }}>{children}</ShopContext.Provider>;
}
export const useShop = () => useContext(ShopContext);
