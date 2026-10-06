// В Next.js 16 middleware.js переименован в proxy.js (та же роль, другое имя).
// Две задачи:
// 1) Админка: дешёвая проверка «есть кука сессии», без обращения к базе. Настоящая проверка прав — requirePermission() в lib/auth.ts.
// 2) Витрина на двух языках: украинская без приставки (/catalog) внутренне показывается из app/[lang] как /uk/catalog,
//    русская — /ru/catalog как есть, адрес /uk/… перенаправляется на адрес без приставки. Правила — routeStorefront() (с тестами).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routeStorefront } from "@handyman/core/site/routes";
import { UTM_COOKIE, UTM_COOKIE_DAYS, utmFromParams } from "@handyman/core/shop/analytics";

const SESSION_COOKIE = "hm_staff_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (pathname === "/admin/login") return NextResponse.next();
    if (!request.cookies.has(SESSION_COOKIE)) return NextResponse.redirect(new URL("/admin/login", request.url));
    return NextResponse.next();
  }

  const route = routeStorefront(pathname);
  const url = request.nextUrl.clone();
  url.pathname = route.kind === "pass" ? pathname : route.path;
  const res = route.kind === "pass" ? NextResponse.next() : route.kind === "redirect" ? NextResponse.redirect(url, 308) : NextResponse.rewrite(url);
  // Этап 5: приглашение друга (…?ref=КОД) — запоминаем на 30 дней, засчитаем при входе или первом заказе
  const ref = request.nextUrl.searchParams.get("ref");
  if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref) && !request.cookies.has("hm_ref")) {
    res.cookies.set("hm_ref", ref.toUpperCase(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 86400 });
  }
  // шаг А1: метки рекламы (utm_*, gclid, fbclid, ttclid) — запоминаем последний рекламный переход на 30 дней, при заказе они попадут в заказ
  const utm = utmFromParams(request.nextUrl.searchParams, pathname);
  if (utm) {
    res.cookies.set(UTM_COOKIE, JSON.stringify(utm), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: UTM_COOKIE_DAYS * 86400 });
  }
  return res;
}

export const config = {
  // Всё, кроме API, служебных файлов Next.js и файлов с расширением (картинки, favicon, robots.txt).
  matcher: ["/((?!api|_next/static|_next/image|__nextjs|.*\\.[a-zA-Z0-9]{1,8}$).*)"],
};
