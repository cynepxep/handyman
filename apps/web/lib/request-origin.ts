// Адрес сайта из текущего запроса (протокол + хост) — для ссылок, которые уходят наружу (возврат из банка после оплаты),
// пока в .env не задан PUBLIC_URL. На сервере с доменом PUBLIC_URL важнее (см. orderPageUrl в @handyman/db/payments).
import { headers } from "next/headers";

export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100").split(",")[0].trim();
  const local = host.startsWith("localhost") || host.startsWith("127.");
  const proto = (h.get("x-forwarded-proto") ?? (local ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
