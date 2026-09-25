// Адреса витрины на двух языках: украинский — без приставки (/catalog), русский — с /ru (/ru/catalog).
// Внутри Next.js все страницы витрины лежат в app/[lang]; proxy.ts переписывает адрес без приставки на /uk/….
// Файл намеренно маленький и без зависимостей: его подключают proxy.ts и клиентские компоненты.

export type ShopLang = "uk" | "ru";
export const SHOP_LANGS: readonly ShopLang[] = ["uk", "ru"];
export const DEFAULT_LANG: ShopLang = "uk";
export const isShopLang = (v: unknown): v is ShopLang => v === "uk" || v === "ru";

/** Разделы, которые витрина не трогает: админка, стенды, API, служебные файлы Next.js, файлы с расширением. */
const NOT_STOREFRONT = [/^\/admin(?:\/|$)/, /^\/design(?:\/|$)/, /^\/api(?:\/|$)/, /^\/_next(?:\/|$)/, /^\/__next/, /\/[^/]*\.[a-z0-9]{1,8}$/i];

export type StorefrontRoute = { kind: "pass" } | { kind: "rewrite"; path: string } | { kind: "redirect"; path: string };

/**
 * Что сделать с входящим адресом (только путь, без ?запроса):
 * - pass — отдать как есть (русская версия /ru/…, админка, файлы);
 * - rewrite — внутренне показать украинскую версию (/catalog → /uk/catalog), адрес в браузере не меняется;
 * - redirect — /uk/… не используется как адрес: перенаправить на адрес без приставки.
 */
export function routeStorefront(pathname: string): StorefrontRoute {
  if (NOT_STOREFRONT.some((r) => r.test(pathname))) return { kind: "pass" };
  if (pathname === "/ru" || pathname.startsWith("/ru/")) return { kind: "pass" };
  if (pathname === "/uk" || pathname.startsWith("/uk/")) return { kind: "redirect", path: pathname.slice(3) || "/" };
  return { kind: "rewrite", path: pathname === "/" ? "/uk" : `/uk${pathname}` };
}

/** Адрес на нужном языке. `path` — адрес украинской версии, с ведущим «/», можно с ?запросом и #якорем. */
export function shopHref(lang: ShopLang, path: string = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (lang === "uk") return p;
  if (p === "/") return "/ru";
  if (p.startsWith("/?") || p.startsWith("/#")) return `/ru${p.slice(1)}`;
  return `/ru${p}`;
}

/** Убрать языковую приставку: /ru/catalog?x=1 → /catalog?x=1, /ru → /. */
export function stripLang(path: string): string {
  const m = /^\/(?:ru|uk)(?=$|[/?#])/.exec(path);
  if (!m) return path || "/";
  const rest = path.slice(m[0].length);
  if (rest === "") return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/** Тот же адрес на другом языке (для переключателя УКР / РУС). */
export const switchLang = (path: string, to: ShopLang): string => shopHref(to, stripLang(path));

/**
 * Ссылки витрины в одном месте. Страницы разделов, товаров, корзины и кабинета появляются в шагах 2.5–2.6;
 * до этого ссылки ведут на «не найдено», а товар — на поиск по его артикулу.
 */
export const paths = {
  home: () => "/",
  catalog: () => "/catalog",
  // до шага 2.5 группа открывается в меню каталога (якорь), потом — своей страницей
  group: (groupId: string) => `/catalog#g-${encodeURIComponent(groupId)}`,
  sub: (groupId: string, subId: string) => `/catalog/${encodeURIComponent(groupId)}/${encodeURIComponent(subId)}`,
  task: (taskId: string) => `/task/${encodeURIComponent(taskId)}`,
  search: (q?: string, page?: number) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (page && page > 1) qs.set("page", String(page));
    const s = qs.toString();
    return s ? `/search?${s}` : "/search";
  },
  product: (sku: string) => paths.search(sku),
  info: (slug: string) => `/info/${encodeURIComponent(slug)}`,
  cart: () => "/cart",
  account: () => "/account",
};
