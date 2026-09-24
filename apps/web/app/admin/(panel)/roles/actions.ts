"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@handyman/db";
import { PERMISSIONS, type Permission } from "@handyman/core";
import { requirePermission } from "@/lib/auth";

export async function togglePermission(
  roleKey: string,
  permission: Permission,
  enabled: boolean,
): Promise<void> {
  await requirePermission("staff.manage");

  if (roleKey === "owner") {
    // У владельца права всегда полные и не редактируются — старое правило "владелец = всё".
    return;
  }
  if (!PERMISSIONS.includes(permission)) return;

  if (enabled) {
    await prisma.rolePermission.upsert({
      where: { roleKey_permission: { roleKey, permission } },
      create: { roleKey, permission },
      update: {},
    });
  } else {
    await prisma.rolePermission.deleteMany({ where: { roleKey, permission } });
  }

  revalidatePath("/admin/roles");
}

export async function createRole(title: string): Promise<void> {
  await requirePermission("staff.manage");
  const trimmed = title.trim();
  if (!trimmed) return;

  const key = `r_${Math.random().toString(36).slice(2, 10)}`;
  await prisma.role.create({ data: { key, title: trimmed, builtin: false } });
  revalidatePath("/admin/roles");
}
