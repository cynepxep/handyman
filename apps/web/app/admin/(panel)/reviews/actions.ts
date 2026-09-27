"use server";

// Отзывы и вопросы (шаг 5.6): опубликовать, отклонить, ответить (ответ публикует и приходит автору в Telegram), удалить.
import { redirect } from "next/navigation";
import { PlusUserError, answerReview, deleteReview, moderateReview } from "@handyman/db/storefront-plus";
import { requirePermission } from "@/lib/auth";

const back = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/admin/reviews") ? b : "/admin/reviews";
};
const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

async function run(page: string, fn: () => Promise<string>): Promise<never> {
  let kind: "ok" | "error" = "ok";
  let message: string;
  try {
    message = await fn();
  } catch (e) {
    kind = "error";
    message = e instanceof PlusUserError ? e.message : `Непредвиденная ошибка: ${e instanceof Error ? e.message : String(e)}`;
    if (!(e instanceof PlusUserError)) console.error("[reviews]", e);
  }
  // сбросить старые ok/error в адресе
  const clean = page.replace(/([?&])(ok|error)=[^&]*/g, "$1").replace(/[?&]+$/, "").replace(/\?&/, "?");
  redirect(withParam(clean, kind, message));
}

export async function moderateAction(formData: FormData): Promise<void> {
  const s = await requirePermission("reviews.moderate");
  const action = formData.get("action") === "reject" ? "reject" : "publish";
  return run(back(formData), async () => {
    await moderateReview(String(formData.get("id")), action, s.username);
    return action === "publish" ? "Опубликовано на сайте." : "Отклонено: на сайте не показывается.";
  });
}

export async function answerAction(formData: FormData): Promise<void> {
  const s = await requirePermission("reviews.moderate");
  return run(back(formData), async () => {
    const r = await answerReview(String(formData.get("id")), formData.get("answer"), s.username);
    return r.notified ? "Ответ сохранён, опубликован и отправлен автору в Telegram." : "Ответ сохранён и опубликован на сайте.";
  });
}

export async function deleteAction(formData: FormData): Promise<void> {
  const s = await requirePermission("reviews.moderate");
  return run(back(formData), async () => {
    await deleteReview(String(formData.get("id")), s.username);
    return "Удалено.";
  });
}
