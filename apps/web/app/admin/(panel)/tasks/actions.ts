"use server";

import { redirect } from "next/navigation";
import { createTask, deleteTask, setTaskDone } from "@handyman/db/service";
import { validateTask } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";

const who = (s: { name: string; username: string }) => s.name || s.username;
const go = (back: string, kind: "ok" | "error", text: string) => `${back}${back.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`;
const safeBack = (v: FormDataEntryValue | null) => (typeof v === "string" && v.startsWith("/admin") ? v : "/admin/tasks");

export async function createTaskAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const back = safeBack(formData.get("back"));
  const check = validateTask(Object.fromEntries(formData));
  if (!check.ok) redirect(go(back, "error", check.error));
  await createTask({ ...check.value, orderId: String(formData.get("orderId") ?? "") || null, clientId: String(formData.get("clientId") ?? "") || null }, who(session));
  redirect(go(back, "ok", "Задача добавлена."));
}

export async function toggleTaskAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const back = safeBack(formData.get("back"));
  await setTaskDone(String(formData.get("id") ?? ""), formData.get("done") === "1", who(session));
  redirect(back);
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const back = safeBack(formData.get("back"));
  await deleteTask(String(formData.get("id") ?? ""), who(session));
  redirect(go(back, "ok", "Задача удалена."));
}
