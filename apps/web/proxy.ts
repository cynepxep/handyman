// В Next.js 16 middleware.js переименован в proxy.js (та же роль, другое имя).
// Здесь — только дешёвая проверка "есть кука сессии", без обращения к базе.
// Настоящая проверка прав — requirePermission() в lib/auth.ts на каждой странице.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "hm_staff_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
