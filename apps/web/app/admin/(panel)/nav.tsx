"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type NavItem = { href: string; label: string; group: string };

const isActive = (href: string, pathname: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

/**
 * Строка разделов на компьютере. Не помещается целиком — сдвигается мышью: колесом, перетаскиванием (зажать и потянуть)
 * или стрелками ‹ › по краям; открытый раздел сам прокручивается в видимую часть.
 */
function NavStrip({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const strip = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [dragging, setDragging] = useState(false);
  const dragged = useRef(false);

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    // колесо мыши двигает строку вбок, пока есть куда; дальше прокручивается страница, как обычно
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : 0;
      if (!delta || el.scrollWidth <= el.clientWidth) return;
      const atEnd = delta > 0 ? el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 : el.scrollLeft <= 0;
      if (atEnd) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [measure]);

  // открытый раздел — в видимую часть строки
  useEffect(() => {
    const el = strip.current;
    const active = el?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!el || !active) return;
    const left = active.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + active.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = left - (el.clientWidth - active.offsetWidth) / 2;
    }
    measure();
  }, [pathname, measure]);

  // перетаскивание мышью (палец и тачпад прокручивают строку сами)
  const onPointerDown = (e: React.PointerEvent) => {
    const el = strip.current;
    if (!el || e.pointerType !== "mouse" || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    const startX = e.clientX;
    const startLeft = el.scrollLeft;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!dragged.current && Math.abs(dx) < 5) return;
      if (!dragged.current) {
        dragged.current = true;
        setDragging(true);
      }
      el.scrollLeft = startLeft - dx;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const step = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.7, behavior: "smooth" });

  return (
    <div className="adm-nav-wrap">
      {edges.left && (
        <button type="button" className="adm-nav-arrow left" onClick={() => step(-1)} aria-label="Показать разделы левее" tabIndex={-1}>‹</button>
      )}
      <nav
        ref={strip}
        className={dragging ? "adm-nav dragging" : "adm-nav"}
        aria-label="Разделы админки"
        onScroll={measure}
        onPointerDown={onPointerDown}
        onDragStart={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          // после перетаскивания отпущенная кнопка мыши не открывает раздел
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        {items.map((it) => (
          <Link key={it.href} href={it.href} aria-current={isActive(it.href, pathname) ? "page" : undefined} draggable={false}>
            {it.label}
          </Link>
        ))}
      </nav>
      {edges.right && (
        <button type="button" className="adm-nav-arrow right" onClick={() => step(1)} aria-label="Показать разделы правее" tabIndex={-1}>›</button>
      )}
    </div>
  );
}

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
      <NavStrip items={items} pathname={pathname} />
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
