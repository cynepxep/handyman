"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavItem = { href: string; label: string; group: string };

const isActive = (href: string, pathname: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

/**
 * Меню админки: на компьютере — строка разделов; на телефоне (шаг 4.8) — кнопка «☰ Разделы» со списком по группам,
 * крупные пункты под палец; после перехода список сам закрывается.
 */
export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  const groups = [...new Set(items.map((i) => i.group))];
  const current = items.find((i) => isActive(i.href, pathname));
  return (
    <>
      <nav className="adm-nav" aria-label="Разделы админки">
        {items.map((it) => (
          <Link key={it.href} href={it.href} aria-current={isActive(it.href, pathname) ? "page" : undefined}>
            {it.label}
          </Link>
        ))}
      </nav>
      <details className="adm-mnav" ref={menu}>
        <summary>☰ {current?.label ?? "Разделы"}</summary>
        <div className="adm-mnav-list">
          {groups.map((g) => (
            <div key={g}>
              <div className="adm-mnav-group">{g}</div>
              {items.filter((i) => i.group === g).map((it) => (
                <Link key={it.href} href={it.href} aria-current={isActive(it.href, pathname) ? "page" : undefined}>{it.label}</Link>
              ))}
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
