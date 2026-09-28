"use client";

// «Вы здесь»: подсветка раздела (Каталог, Пошук, Кошик, Обране, Кабінет) в шапке и нижней панели телефона.
// Раздел берётся из адреса страницы в браузере — сервер отдаёт одинаковую шапку для всех страниц.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { shopSection, type ShopSection } from "@handyman/core/site/routes";

export function useShopSection(): ShopSection | null {
  return shopSection(usePathname() ?? "/");
}

/** Свойства для кнопки/ссылки раздела: класс is-active и aria-current для программ чтения с экрана. */
export function activeProps(on: boolean, className = "") {
  return { className: `${className}${on ? `${className ? " " : ""}is-active` : ""}` || undefined, "aria-current": on ? ("page" as const) : undefined };
}

/** Ссылка на раздел витрины, подсвеченная, когда покупатель в этом разделе. */
export function SectionLink({ section, href, className, children }: { section: ShopSection; href: string; className?: string; children: React.ReactNode }) {
  const on = useShopSection() === section;
  return <Link href={href} {...activeProps(on, className)}>{children}</Link>;
}
