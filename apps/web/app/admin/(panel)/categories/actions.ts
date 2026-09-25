"use server";

import { redirect } from "next/navigation";
import { prisma } from "@handyman/db";
import { reindexAll, reindexSafely } from "@handyman/db/catalog-search";
import { requirePermission } from "@/lib/auth";
import { catalogChanged } from "@/lib/shop/cache";

export async function saveCategoryAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.edit");
  const id = String(formData.get("id"));
  const nameUk = String(formData.get("nameUk") ?? "").trim();
  const nameRu = String(formData.get("nameRu") ?? "").trim();
  const sort = Number(String(formData.get("sort") ?? "0").trim());
  let result: string;
  if (nameUk.length < 2 || nameRu.length < 2) result = "error=" + encodeURIComponent("Названия категории не могут быть пустыми.");
  else if (!Number.isInteger(sort)) result = "error=" + encodeURIComponent("Порядок должен быть целым числом.");
  else {
    const cat = await prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!cat) result = "error=" + encodeURIComponent("Категория не найдена.");
    else {
      await prisma.$transaction([
        prisma.category.update({ where: { id }, data: { nameUk, nameRu, sort } }),
        prisma.auditLog.create({ data: { who: session.username, action: "category.edit", target: id, details: { nameUk, nameRu, sort } } }),
      ]);
      await reindexSafely(() => reindexAll()); // названия категорий входят в индекс поиска
      catalogChanged(); // названия частей подраздела на сайте
      result = "ok=" + encodeURIComponent(`Категория «${nameUk}» сохранена.`);
    }
  }
  redirect(`/admin/categories?${result}`);
}
