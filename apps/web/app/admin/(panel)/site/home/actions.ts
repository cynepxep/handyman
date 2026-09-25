"use server";

import { redirect } from "next/navigation";
import { validateHomeForm } from "@handyman/core/site";
import { saveHomeSettings } from "@handyman/db/site-content";
import { requirePermission } from "@/lib/auth";
import { shopChanged } from "@/lib/shop/cache";

const back = (kind: "ok" | "error", text: string) => `/admin/site/home?${kind}=${encodeURIComponent(text)}`;

/** Порядок и включение блоков главной, баннер акции. */
export async function saveHomeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("texts.edit");
  const input: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") input[k] = v;
  const r = validateHomeForm(input);
  if (!r.ok) redirect(back("error", r.error));
  await saveHomeSettings(r.value, session.username);
  shopChanged();
  redirect(back("ok", "Главная сохранена — на сайте уже так."));
}
