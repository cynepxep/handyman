"use server";

import { redirect } from "next/navigation";
import { parseGoogleVerification } from "@handyman/core/launch-check";
import { saveIndexing, saveSearchConsole } from "@handyman/db/launch-check";
import { requireOwner } from "@/lib/auth";
import { shopChanged } from "@/lib/shop/cache";

const back = (kind: "ok" | "error", text: string, at = "indexing") => `/admin/launch-check?${kind}=${encodeURIComponent(text)}#${at}`;

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

/** Код подтверждения Google Search Console (шаг Л1) и отметка «подтверждено» — только владелец. */
export async function saveSearchConsoleAction(form: FormData): Promise<void> {
  const s = await requireOwner();
  const code = parseGoogleVerification(String(form.get("code") ?? "").slice(0, 500));
  if (code === "invalid") {
    redirect(back("error", "Не похоже на код Google. Вставьте весь тег <meta name=\"google-site-verification\" …> из Search Console или только то, что в кавычках после content=.", "search-console"));
  }
  const verified = form.get("verified") === "yes";
  await saveSearchConsole({ code, verified }, s.name || s.username);
  shopChanged(); // мета-тег на главной
  redirect(back("ok", code ? (verified ? "Сохранено: сайт подтверждён в Search Console." : "Код сохранён — он уже на главной. Теперь нажмите «Подтвердить» в Search Console.") : "Сохранено.", "search-console"));
}
