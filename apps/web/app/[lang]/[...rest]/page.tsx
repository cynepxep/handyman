import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isShopLang } from "@handyman/core/site";
import { getShopContent } from "@/lib/shop/content";

// Любой незнакомый адрес витрины → страница «не найдено» на языке сайта (с шапкой и подвалом).
export async function generateMetadata({ params }: PageProps<"/[lang]/[...rest]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isShopLang(lang)) return {};
  const { t } = await getShopContent(lang);
  return { title: t("notFound.title") };
}

export default function UnknownShopPage() {
  notFound();
}
