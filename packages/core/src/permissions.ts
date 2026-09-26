// Единый список прав доступа (RBAC). Совпадает по смыслу со старым проектом
// (см. PERMS/DEFAULT_ROLES/PERM_RU в старом src/app.js и src/panel.html).

export const PERMISSIONS = [
  "orders.view",
  "orders.edit",
  "orders.history",
  "clients.view",
  "clients.edit",
  "products.view",
  "products.edit",
  "prices.view",
  "prices.edit",
  "import.run",
  "templates.edit",
  "managers.edit",
  "staff.manage",
  "settings.edit",
  "audit.view",
  "suppliers.edit",
  "texts.edit",
  "ads.edit",
  "stock.edit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS_RU: Record<Permission, string> = {
  "orders.view": "Заказы: просмотр",
  "orders.edit": "Заказы: изменение статуса, сообщения",
  "orders.history": "Заказы: подробная история и переписка",
  "clients.view": "Клиенты: просмотр",
  "clients.edit": "Клиенты: контакты, личная скидка",
  "products.view": "Товары: просмотр",
  "products.edit": "Товары: редактирование",
  "prices.view": "Цены: просмотр",
  "prices.edit": "Цены: изменение",
  "import.run": "Загрузка каталога",
  "templates.edit": "Шаблоны сообщений",
  "managers.edit": "Уведомления в Telegram",
  "staff.manage": "Сотрудники и роли",
  "settings.edit": "Настройки магазина",
  "audit.view": "Журнал действий",
  "suppliers.edit": "Поставщики и бренды",
  "texts.edit": "Тексты и страницы сайта",
  "ads.edit": "Реклама и баннеры",
  "stock.edit": "Склад: приход, инвентаризация, остатки",
};

interface RoleSeed {
  key: string;
  title: string;
  builtin: boolean;
  permissions: readonly Permission[] | "*";
}

// "*" у владельца — особый случай: имеет все права всегда, без обычной проверки по списку.
export const DEFAULT_ROLES: RoleSeed[] = [
  { key: "owner", title: "Владелец", builtin: true, permissions: "*" },
  {
    key: "admin",
    title: "Главный администратор",
    builtin: true,
    permissions: PERMISSIONS.filter((p) => p !== "staff.manage" && p !== "settings.edit"),
  },
  {
    key: "manager",
    title: "Менеджер",
    builtin: true,
    permissions: ["orders.view", "orders.edit", "clients.view", "products.view", "stock.edit"],
  },
  {
    key: "content",
    title: "Контент-менеджер",
    builtin: true,
    permissions: ["products.view", "products.edit", "prices.view", "prices.edit", "import.run"],
  },
];

export function expandRolePermissions(role: RoleSeed): Permission[] {
  return role.permissions === "*" ? [...PERMISSIONS] : [...role.permissions];
}
