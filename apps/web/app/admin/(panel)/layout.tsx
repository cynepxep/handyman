import type { Permission } from "@handyman/core";
import { requireStaff } from "@/lib/auth";
import { logoutAction } from "../actions";
import { AdminNav, type NavItem } from "./nav";
import "./admin.css";

const SECTIONS: Array<{ href: string; label: string; permission?: Permission }> = [
  { href: "/admin", label: "Главная" },
  { href: "/admin/import", label: "Импорт", permission: "import.run" },
  { href: "/admin/products", label: "Товары", permission: "products.view" },
  { href: "/admin/categories", label: "Категории", permission: "products.view" },
  { href: "/admin/site", label: "Сайт", permission: "texts.edit" },
  { href: "/admin/roles", label: "Роли и права", permission: "staff.manage" },
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();
  const items: NavItem[] = SECTIONS.filter((s) => !s.permission || session.permissions.includes(s.permission)).map(
    ({ href, label }) => ({ href, label }),
  );

  return (
    <div className="adm">
      <header className="adm-bar">
        <div className="adm-bar-in">
          <a className="adm-brand" href="/admin">
            Handyman
          </a>
          <AdminNav items={items} />
          <form action={logoutAction} className="adm-user">
            <span>
              {session.name} · {session.roleTitle}
            </span>
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
