"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavItem = { href: string; label: string; group: string };

const isActive = (href: string, pathname: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

/** Разделы по группам, по порядку первого появления группы. */
const byGroup = (items: NavItem[]) => [...new Set(items.map((i) => i.group))].map((g) => ({ group: g, items: items.filter((i) => i.group === g) }));

/**
 * Список разделов слева на компьютере, по группам. Не помещается по высоте — прокручивается сам по себе;
 * открытый раздел сам прокручивается в видимую часть.
 */
export function AdminSideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = list.current;
    const active = el?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!el || !active) return;
    const top = active.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top + active.offsetHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = top - (el.clientHeight - active.offsetHeight) / 2;
    }
  }, [pathname]);
  return (
    <nav ref={list} className="adm-snav" aria-label="Разделы админки">
      {byGroup(items).map(({ group, items: its }) => (
        <div key={group}>
          <div className="adm-snav-group">{group}</div>
          {its.map((it) => (
            <Link key={it.href} href={it.href} aria-current={isActive(it.href, pathname) ? "page" : undefined}>{it.label}</Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Меню админки на телефоне (шаг 4.8): кнопка «☰ Разделы» со списком по группам, крупные пункты под палец;
 * после перехода список сам закрывается. На компьютере — список слева (AdminSideNav).
 */
export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  const current = items.find((i) => isActive(i.href, pathname));
  return (
    <details className="adm-mnav" ref={menu}>
      <summary>☰ {current?.label ?? "Разделы"}</summary>
      <div className="adm-mnav-list">
        {byGroup(items).map(({ group, items: its }) => (
          <div key={group}>
            <div className="adm-mnav-group">{group}</div>
            {its.map((it) => (
              <Link key={it.href} href={it.href} aria-current={isActive(it.href, pathname) ? "page" : undefined}>{it.label}</Link>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
