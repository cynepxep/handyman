"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/site/home", label: "Главная" },
  { href: "/admin/site/texts", label: "Тексты" },
  { href: "/admin/site/contacts", label: "Контакты и график" },
  { href: "/admin/site/pages", label: "Страницы" },
  { href: "/admin/site/menu", label: "Меню и задачи" },
  { href: "/admin/site/checkout", label: "Оформление заказа" },
];

/** Вкладки раздела «Сайт». */
export function SiteTabs() {
  const pathname = usePathname();
  return (
    <nav className="adm-tabs" aria-label="Разделы «Сайт»">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={pathname.startsWith(t.href) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
