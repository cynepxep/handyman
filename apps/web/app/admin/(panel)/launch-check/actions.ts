"use server";

import { redirect } from "next/navigation";
import { saveIndexing } from "@handyman/db/launch-check";
import { requireOwner } from "@/lib/auth";
import { shopChanged } from "@/lib/shop/cache";

const back = (kind: "ok" | "error", text: string) => `/admin/launch-check?${kind}=${encodeURIComponent(text)}#indexing`;

/** Открыть сайт для Google (шаг 8.5) — только владелец и только с галочкой «понимаю». */
export async function openIndexingAction(form: FormData): Promise<void> {
  const s = await requireOwner();
  if (form.get("confirm") !== "yes") redirect(back("error", "Поставьте галочку «Понимаю…» — без неё сайт не открывается."));
  await saveIndexing(true, s.name || s.username);
  shopChanged();
  redirect(back("ok", "Сайт открыт для поисковиков. Google начнёт заходить сам в течение нескольких дней."));
}

export async function closeIndexingAction(): Promise<void> {
  const s = await requireOwner();
  await saveIndexing(false, s.name || s.username);
  shopChanged();
  redirect(back("ok", "Сайт снова закрыт от поисковиков."));
}
