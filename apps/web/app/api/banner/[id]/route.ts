// Нажатие на баннер: считаем (+1 в «Реклама и баннеры») и ведём по ссылке из базы (не из адреса — подменить нельзя).
import { NextResponse } from "next/server";
import { clickBanner } from "@handyman/db/banners";
import { shopHref } from "@handyman/core/site";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = new URL(req.url).searchParams.get("l") === "ru" ? "ru" : "uk";
  const href = /^[\w-]{1,40}$/.test(id) ? await clickBanner(id) : null;
  const to = !href ? shopHref(lang, "/") : href.startsWith("/") ? shopHref(lang, href) : href;
  return NextResponse.redirect(new URL(to, req.url), 303);
}
