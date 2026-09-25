"use server";

import { redirect } from "next/navigation";
import { startMediaSync, stopMediaSync } from "@handyman/db/media";
import { requirePermission } from "@/lib/auth";

const back = (kind: "ok" | "error", text: string) => `/admin/media?${kind}=${encodeURIComponent(text)}`;

/** «Скачать фото к себе» для одного поставщика (`none` — товары без поставщика). */
export async function startMediaAction(supplierId: string): Promise<void> {
  const session = await requirePermission("import.run");
  const r = await startMediaSync({ supplierId: supplierId === "none" ? null : supplierId }, session.username);
  redirect(r.total ? back("ok", `Скачиваю ${r.total} фото. Можно уйти со страницы — работа идёт на сервере.`) : back("ok", "Все фото этого поставщика уже у нас."));
}

export async function stopMediaAction(runId: string): Promise<void> {
  await requirePermission("import.run");
  await stopMediaSync(runId);
  redirect(back("ok", "Останавливаю: текущие фото докачаются, остальные — при следующем запуске."));
}
