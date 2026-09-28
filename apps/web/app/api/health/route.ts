// «Здоровье» сайта (шаг 8.2) для внешнего сторожа (например, UptimeRobot, подключается на сервере — шаг 8.5).
// Без ключа — только {"status":"ok"} (200) или {"status":"error"} (503): наружу подробности не отдаём.
// Подробности (база, поиск, фоновые задачи, диск, копия, ошибки) — с ключом `?key=<HEALTH_KEY>` из .env или сотруднику с правом «Ошибки».
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { healthReport } from "@handyman/db/health";
import { getStaffSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function keyOk(given: string | null): boolean {
  const want = process.env.HEALTH_KEY?.trim() ?? "";
  if (want.length < 16 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const r = await healthReport();
  const code = r.status === "ok" ? 200 : 503;
  const headers = { "cache-control": "no-store" };
  let details = keyOk(req.nextUrl.searchParams.get("key") ?? req.headers.get("x-health-key"));
  if (!details && r.checks.some((c) => c.key === "db" && c.level === "ok")) {
    const s = await getStaffSession().catch(() => null);
    details = Boolean(s?.permissions.includes("errors.view"));
  }
  return NextResponse.json(details ? r : { status: r.status }, { status: code, headers });
}
