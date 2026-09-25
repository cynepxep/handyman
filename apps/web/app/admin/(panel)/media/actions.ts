"use server";

import { redirect } from "next/navigation";
import { setPhotoStyle, startMediaSync, startPhotoStyle, stopMediaSync } from "@handyman/db/media";
import { shopChanged } from "@/lib/shop/cache";
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

/** «Сделать стиль» (limit 0 — все недостающие) или «Проба на 40 фото» для поставщика. */
export async function startStyleAction(supplierId: string, limit: number): Promise<void> {
  const session = await requirePermission("import.run");
  const r = await startPhotoStyle({ supplierId: supplierId === "none" ? null : supplierId }, session.username, limit ? { limit } : {});
  redirect(r.total ? back("ok", `Делаю фирменный стиль для ${r.total} фото. Пример появится внизу страницы.`) : back("ok", "Все фото этого поставщика уже в стиле."));
}

/** Включить/выключить фирменный стиль фото на сайте (сразу; поиск обновляется). */
export async function togglePhotoStyleAction(on: boolean): Promise<void> {
  const session = await requirePermission("import.run");
  await setPhotoStyle(on, session.username);
  shopChanged();
  redirect(back("ok", on ? "Фирменный стиль фото включён — на сайте уже видно (где стиль ещё не сделан — обычное фото)." : "Фирменный стиль выключен — на сайте обычные фото."));
}
