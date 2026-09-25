// В Next.js 16 middleware.js переименован в proxy.js (та же роль, другое имя).
// Две задачи:
// 1) Админка: дешёвая проверка «есть кука сессии», без обращения к базе. Настоящая проверка прав — requirePermission() в lib/auth.ts.
// 2) Витрина на двух языках: украинская без приставки (/catalog) внутренне показывается из app/[lang] как /uk/catalog,
//    русская — /ru/catalog как есть, адрес /uk/… перенаправляется на адрес без приставки. Правила — routeStorefront() (с тестами).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { routeStorefront } from "@handyman/core/site/routes";

const SESSION_COOKIE = "hm_staff_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (pathname === "/admin/login") return NextResponse.next();
    if (!request.cookies.has(SESSION_COOKIE)) return NextResponse.redirect(new URL("/admin/login", request.url));
    return NextResponse.next();
  }

  const route = routeStorefront(pathname);
  if (route.kind === "pass") return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = route.path;
  return route.kind === "redirect" ? NextResponse.redirect(url, 308) : NextResponse.rewrite(url);
}

export const config = {
  // Всё, кроме API, служебных файлов Next.js и файлов с расширением (картинки, favicon, robots.txt).
  matcher: ["/((?!api|_next/static|_next/image|__nextjs|.*\\.[a-zA-Z0-9]{1,8}$).*)"],
};
