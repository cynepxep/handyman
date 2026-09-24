import { prisma } from "@handyman/db";
import { PERMISSIONS, PERMISSION_LABELS_RU } from "@handyman/core";
import { requirePermission } from "@/lib/auth";
import { RoleMatrix } from "./role-matrix";
import { NewRoleForm } from "./new-role-form";

export default async function RolesPage() {
  await requirePermission("staff.manage");

  const roles = await prisma.role.findMany({
    include: { permissions: true, staff: { select: { id: true } } },
    orderBy: { key: "asc" },
  });

  const data = roles.map((r) => ({
    key: r.key,
    title: r.title,
    builtin: r.builtin,
    staffCount: r.staff.length,
    permissions: new Set(r.permissions.map((p) => p.permission)),
  }));

  return (
    <>
      <h1>Роли и права</h1>
      <p className="adm-lead">
        Отметьте, что может делать каждая роль. У «Владельца» права всегда полные и не
        редактируются.
      </p>
      <RoleMatrix
        roles={data}
        permissions={PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS_RU[p] }))}
      />
      <NewRoleForm />
    </>
  );
}
