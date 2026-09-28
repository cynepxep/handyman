"use server";

import { redirect } from "next/navigation";
import { closeErrors, reopenError } from "@handyman/db/errors";
import { requirePermission } from "@/lib/auth";

const back = (text: string, tab = "") => `/admin/errors?${tab ? `tab=${tab}&` : ""}ok=${encodeURIComponent(text)}`;

/** «Закрыть» одну группу (разобрались) — если ошибка повторится, группа откроется снова и придёт тревога. */
export async function closeErrorAction(fd: FormData): Promise<void> {
  const s = await requirePermission("errors.view");
  const id = String(fd.get("id") ?? "");
  const n = id ? await closeErrors([id], s.name || s.username) : 0;
  redirect(back(n ? "Закрыто. Если ошибка повторится — она снова появится в «Открытых»." : "Уже закрыто."));
}

export async function closeAllErrorsAction(): Promise<void> {
  const s = await requirePermission("errors.view");
  const n = await closeErrors("all", s.name || s.username);
  redirect(back(n ? `Закрыто групп: ${n}.` : "Открытых ошибок нет."));
}

export async function reopenErrorAction(fd: FormData): Promise<void> {
  const s = await requirePermission("errors.view");
  await reopenError(String(fd.get("id") ?? ""), s.name || s.username);
  redirect(back("Снова в «Открытых».", ""));
}
