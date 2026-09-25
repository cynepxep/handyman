"use server";

import { redirect } from "next/navigation";
import { validateBannerForm } from "@handyman/core/site";
import { deleteBanner, saveBanner, setBannerActive } from "@handyman/db/banners";
import { loadMenuConfig } from "@handyman/db/site-content";
import { requirePermission } from "@/lib/auth";
import { shopChanged } from "@/lib/shop/cache";

const back = (kind: "ok" | "error", text: string, path = "/admin/banners") => `${path}?${kind}=${encodeURIComponent(text)}`;

/** Сохранить баннер: поле id пустое — новый. */
export async function saveBannerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("ads.edit");
  const input: Record<string, string | string[]> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string") continue;
    if (k === "groups") input.groups = [...((input.groups as string[] | undefined) ?? []), v];
    else input[k] = v;
  }
  const id = typeof input.id === "string" && input.id ? input.id : null;
  const menu = await loadMenuConfig();
  const r = validateBannerForm(input, menu.groups.map((g) => g.id));
  if (!r.ok) redirect(back("error", r.error, `/admin/banners/${id ?? "new"}`));
  await saveBanner(id, r.value, session.username);
  shopChanged();
  redirect(back("ok", id ? "Баннер сохранён — на сайте уже видно." : "Баннер добавлен."));
}

export async function toggleBannerAction(id: string, active: boolean): Promise<void> {
  const session = await requirePermission("ads.edit");
  await setBannerActive(id, active, session.username);
  shopChanged();
  redirect(back("ok", active ? "Баннер включён." : "Баннер выключен."));
}

export async function deleteBannerAction(id: string): Promise<void> {
  const session = await requirePermission("ads.edit");
  await deleteBanner(id, session.username);
  shopChanged();
  redirect(back("ok", "Баннер удалён."));
}
