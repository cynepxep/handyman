// «Скачать контейнер для Google Tag Manager» (шаг А2): тот же файл, что deploy/gtm-container.json, — импортируется в GTM
// («Админ → Импортировать контейнер»). ID кабинетов в нём нет (берутся с сайта), но раздел «Интеграции» — только владелец.
import { NextResponse } from "next/server";
import { GTM_CONTAINER_VERSION, gtmContainerJson } from "@handyman/core/gtm";
import { getStaffSession } from "@/lib/auth";

export async function GET() {
  const session = await getStaffSession();
  if (!session || session.roleKey !== "owner") return new NextResponse("Нет доступа", { status: 403 });
  return new NextResponse(gtmContainerJson(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="handyman-gtm-container-${GTM_CONTAINER_VERSION}.json"`,
      "cache-control": "no-store",
    },
  });
}
