"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPage, deletePage, savePage, type PageInput } from "@handyman/db/site-content";
import { requirePermission } from "@/lib/auth";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const input = (f: FormData): PageInput => ({
  titleUk: str(f, "titleUk"), titleRu: str(f, "titleRu"), bodyUk: str(f, "bodyUk"), bodyRu: str(f, "bodyRu"),
  inMenu: f.get("inMenu") === "on", visible: f.get("visible") === "on", sort: Number(str(f, "sort").trim() || "0"),
});
const back = (kind: "ok" | "error", text: string, slug?: string) =>
  `/admin/site/pages${slug ? `/${encodeURIComponent(slug)}` : ""}?${kind}=${encodeURIComponent(text)}`;

export async function savePageAction(formData: FormData): Promise<void> {
  const session = await requirePermission("texts.edit");
  const slug = str(formData, "slug");
  const r = await savePage(slug, input(formData), session.username);
  if (!r.ok) redirect(back("error", r.error, slug));
  revalidatePath("/", "layout");
  redirect(back("ok", "Страница сохранена.", slug));
}

export async function createPageAction(formData: FormData): Promise<void> {
  const session = await requirePermission("texts.edit");
  const slug = str(formData, "slug").toLowerCase().trim();
  const i = input(formData);
  const r = await createPage(slug, { ...i, inMenu: true, visible: true, sort: 50 }, session.username);
  if (!r.ok) redirect(back("error", r.error));
  revalidatePath("/", "layout");
  redirect(back("ok", "Страница создана. Допишите текст и сохраните.", slug));
}

export async function deletePageAction(formData: FormData): Promise<void> {
  const session = await requirePermission("texts.edit");
  const slug = str(formData, "slug");
  const r = await deletePage(slug, session.username);
  if (!r.ok) redirect(back("error", r.error, slug));
  revalidatePath("/", "layout");
  redirect(back("ok", "Страница удалена."));
}
