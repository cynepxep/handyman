"use server";

import { redirect } from "next/navigation";
import { ORDER_STATUSES } from "@handyman/db/orders";
import { deleteTemplate, saveTemplate } from "@handyman/db/messages";
import { validateTemplateForm } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";

const back = (kind: "ok" | "error", text: string, anchor = "") => `/admin/templates?${kind}=${encodeURIComponent(text)}${anchor ? `#${anchor}` : ""}`;

export async function saveTemplateAction(formData: FormData): Promise<void> {
  const session = await requirePermission("templates.edit");
  const id = String(formData.get("id") ?? "") || null;
  const check = validateTemplateForm(Object.fromEntries(formData), ORDER_STATUSES);
  if (!check.ok) redirect(back("error", check.error, id ? `t-${id}` : "new"));
  const r = await saveTemplate(id, check.value, session.name || session.username);
  if (!r.ok) redirect(back("error", r.error));
  redirect(back("ok", id ? "Шаблон сохранён." : "Шаблон добавлен.", `t-${r.id}`));
}

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  const session = await requirePermission("templates.edit");
  await deleteTemplate(String(formData.get("id") ?? ""), session.name || session.username);
  redirect(back("ok", "Шаблон удалён."));
}
