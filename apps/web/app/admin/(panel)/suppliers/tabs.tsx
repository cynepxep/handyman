"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Вкладки раздела «Поставщики и бренды». */
export function SupplierTabs() {
  const pathname = usePathname();
  const brands = pathname.startsWith("/admin/suppliers/brands");
  return (
    <nav className="adm-tabs" aria-label="Разделы «Поставщики и бренды»">
      <Link href="/admin/suppliers" aria-current={!brands ? "page" : undefined}>Поставщики</Link>
      <Link href="/admin/suppliers/brands" aria-current={brands ? "page" : undefined}>Бренды</Link>
    </nav>
  );
}
