"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { saveTextEdits, type TextEdit } from "@handyman/db/site-content";
import type { Lang } from "@handyman/core/site";
import { requirePermission } from "@/lib/auth";

const msg = (kind: "ok" | "error", text: string, group: string) =>
  `/admin/site/texts?${kind}=${encodeURIComponent(text)}${group ? `&group=${encodeURIComponent(group)}` : ""}`;

/** Сохраняет одну группу текстов. Кнопка «↺» рядом с полем (name=reset) возвращает стандартный текст этого поля. */
export async function saveTextsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("texts.edit");
  const group = String(formData.get("group") ?? "");
  const reset = String(formData.get("reset") ?? "");
  const edits: TextEdit[] = [];
  for (const [name, val] of formData.entries()) {
    if (typeof val !== "string") continue;
    const m = /^(uk|ru):(.+)$/.exec(name);
    if (!m) continue;
    const lang = m[1] as Lang;
    edits.push({ key: m[2], lang, value: reset === `${m[2]}|${lang}` ? "" : val });
  }
  const result = await saveTextEdits(edits, session.username);
  if (!result.ok) redirect(msg("error", result.error, group));
  revalidatePath("/", "layout");
  redirect(msg("ok", reset ? "Стандартный текст возвращён." : `Тексты группы «${group}» сохранены.`, group));
}
