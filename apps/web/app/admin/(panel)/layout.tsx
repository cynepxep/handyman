import Link from "next/link";
import type { Permission } from "@handyman/core";
import { requireStaff } from "@/lib/auth";
import { logoutAction } from "../actions";
import { AdminNav, type NavItem } from "./nav";
import "./admin.css";

// group — раздел меню на телефоне (шаг 4.8)
const SECTIONS: Array<{ href: string; label: string; group: string; permission?: Permission }> = [
  { href: "/admin", label: "Главная", group: "Продажи" },
  { href: "/admin/orders", label: "Заказы", group: "Продажи", permission: "orders.view" },
  { href: "/admin/clients", label: "Клиенты", group: "Продажи", permission: "clients.view" },
  { href: "/admin/tasks", label: "Задачи", group: "Продажи", permission: "orders.view" },
  { href: "/admin/service", label: "Гарантия", group: "Продажи", permission: "orders.view" },
  { href: "/admin/templates", label: "Шаблоны", group: "Продажи", permission: "templates.edit" },
  { href: "/admin/stock", label: "Склад", group: "Склад и каталог", permission: "stock.edit" },
  { href: "/admin/reports", label: "Отчёты", group: "Деньги и отчёты", permission: "orders.view" },
  { href: "/admin/finance", label: "Финансы", group: "Деньги и отчёты", permission: "finance.view" },
  { href: "/admin/import", label: "Импорт", group: "Склад и каталог", permission: "import.run" },
  { href: "/admin/products", label: "Товары", group: "Склад и каталог", permission: "products.view" },
  { href: "/admin/categories", label: "Категории", group: "Склад и каталог", permission: "products.view" },
  { href: "/admin/site", label: "Сайт", group: "Сайт и реклама", permission: "texts.edit" },
  { href: "/admin/warehouses", label: "Магазины", group: "Сайт и реклама", permission: "settings.edit" },
  { href: "/admin/media", label: "Фото товаров", group: "Склад и каталог", permission: "import.run" },
  { href: "/admin/banners", label: "Реклама", group: "Сайт и реклама", permission: "ads.edit" },
  { href: "/admin/notifications", label: "Уведомления", group: "Настройки", permission: "managers.edit" },
  { href: "/admin/staff", label: "Сотрудники", group: "Настройки", permission: "staff.manage" },
  { href: "/admin/roles", label: "Роли и права", group: "Настройки", permission: "staff.manage" },
  { href: "/admin/audit", label: "Журнал", group: "Настройки", permission: "audit.view" },
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // общее меню — даже если нужно включить код из приложения (страницы сами отправят в «Мой аккаунт»)
  const session = await requireStaff({ allowWithout2fa: true });
  const items: NavItem[] = SECTIONS.filter((s) => !s.permission || session.permissions.includes(s.permission)).map(
    ({ href, label, group }) => ({ href, label, group }),
  );

  return (
    <div className="adm">
      <header className="adm-bar">
        <div className="adm-bar-in">
          <Link className="adm-brand" href="/admin">
            Handyman
          </Link>
          <AdminNav items={items} />
          <form action={logoutAction} className="adm-user">
            <Link href="/admin/account" title="Мой аккаунт: пароль, код из приложения, где я вошёл">
              <span>{session.name} · {session.roleTitle}</span> {session.hasTwoFactor ? "🔒" : "👤"}
            </Link>
            <button type="submit" className="adm-btn">
              Выйти
            </button>
          </form>
        </div>
      </header>
      <main className="adm-page">{children}</main>
    </div>
  );
}
