"use server";

import { redirect } from "next/navigation";
import { saveContacts } from "@handyman/db/site-content";
import { validateContactsForm } from "@handyman/core/site";
import { requirePermission } from "@/lib/auth";
import { shopChanged } from "@/lib/shop/cache";

export async function saveContactsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("texts.edit");
  const input: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") input[k] = v;
  const r = validateContactsForm(input);
  if (!r.ok) redirect(`/admin/site/contacts?error=${encodeURIComponent(r.error)}`);
  await saveContacts(r.value, session.username);
  shopChanged();
  redirect(`/admin/site/contacts?ok=${encodeURIComponent("Контакты сохранены.")}`);
}
