"use server";

import { redirect } from "next/navigation";
import { startInBackground } from "@handyman/db/backups";
import { prisma } from "@handyman/db";
import { requireOwner } from "@/lib/auth";

const back = (kind: "ok" | "error", text: string) => `/admin/backups?${kind}=${encodeURIComponent(text)}`;

/** «Сделать копию сейчас» / «Проверить восстановление»: в фоне, страница обновляется сама, пока идёт. */
async function start(what: "backup" | "check"): Promise<void> {
  const s = await requireOwner();
  const who = s.name || s.username;
  const started = await startInBackground(what, who);
  if (!started) redirect(back("error", "Уже идёт копирование или проверка — подождите, страница обновится сама."));
  await prisma.auditLog.create({ data: { who, action: what === "backup" ? "backup.create" : "backup.check" } });
  redirect(back("ok", what === "backup" ? "Копирование началось." : "Проверка началась: копия восстанавливается во временную базу (рабочую не трогает)."));
}

export async function backupNowAction(): Promise<void> {
  await start("backup");
}

export async function checkNowAction(): Promise<void> {
  await start("check");
}
