// Наклейка / накладная A4 от Новой Почты (PDF) для ТТН, созданной кнопкой (шаг 3.4). Адрес PDF у НП содержит API-ключ,
// поэтому браузер его не видит: сервер скачивает PDF и отдаёт сотруднику (право «Заказы: просмотр»).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@handyman/db";
import { npPrintTarget } from "@handyman/db/np-shipments";
import { getStaffSession } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  if (!session || !session.permissions.includes("orders.view")) return new NextResponse("Нет доступа", { status: 403 });
  const { id } = await params;
  const shId = req.nextUrl.searchParams.get("sh") ?? "";
  const kind = req.nextUrl.searchParams.get("kind") === "document" ? "document" : "label";
  const sh = await prisma.npShipment.findFirst({ where: { id: shId, orderId: id }, select: { id: true, ttn: true } });
  const url = sh ? await npPrintTarget(sh.id, kind) : null;
  if (!sh || !url) return new NextResponse("Эту ТТН нельзя распечатать из Новой Почты (тестовая или вписана вручную) — используйте «Наклейка (наша)».", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("pdf")) {
      return new NextResponse("Нова Пошта не отдала PDF — попробуйте ещё раз или распечатайте наклейку в кабинете НП.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new NextResponse(res.body, {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${kind === "label" ? "nakleika" : "nakladna"}-${sh.ttn}.pdf"`, "cache-control": "no-store" },
    });
  } catch {
    return new NextResponse("Нова Пошта не отвечает — попробуйте позже.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
