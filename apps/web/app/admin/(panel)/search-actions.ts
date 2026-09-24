"use server";

import { redirect } from "next/navigation";
import { reindexAll } from "@handyman/db/catalog-search";
import { requirePermission } from "@/lib/auth";

/** Полная пересборка поискового индекса из базы (то же, что команда pnpm search:reindex). */
export async function rebuildSearchAction(): Promise<void> {
  await requirePermission("products.edit");
  let query: string;
  try {
    const { indexed } = await reindexAll();
    query = `ok=${encodeURIComponent(`Поиск пересобран: ${indexed} товаров.`)}`;
  } catch (e) {
    console.error("[search]", e);
    query = `error=${encodeURIComponent("Не удалось пересобрать поиск. Проверьте, что запущен Meilisearch (pnpm infra:up).")}`;
  }
  redirect(`/admin?${query}`);
}
