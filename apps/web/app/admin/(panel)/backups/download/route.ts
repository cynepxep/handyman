// «Скачать» в «Резервных копиях» (шаг 8.1): файл базы или ключ шифрования одной копии — только владельцу, каждое скачивание в журнале.
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@handyman/db";
import { backupFileFor } from "@handyman/db/backups";
import { loadSecurity } from "@handyman/db/staff";
import { getStaffSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getStaffSession();
  if (!session || session.roleKey !== "owner") return new NextResponse("Нет доступа", { status: 403 });
  if (!session.hasTwoFactor && (await loadSecurity()).require2fa) return new NextResponse("Сначала включите вход с кодом из приложения («Мой аккаунт»)", { status: 403 });
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const file = req.nextUrl.searchParams.get("file") === "key" ? "key" : "db";
  const path = backupFileFor(name, file);
  if (!path) return new NextResponse("Нет такой копии", { status: 404 });
  await prisma.auditLog.create({ data: { who: session.name || session.username, action: "backup.download", target: name, details: { file } } });
  const body = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ path)) as unknown as ReadableStream;
  const fileName = file === "key" ? `handyman-${name}-secrets.key` : `handyman-${name}.dump`;
  return new NextResponse(body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(statSync(/*turbopackIgnore: true*/ path).size),
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}
