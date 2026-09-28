// Адрес покупателя/сотрудника для лимитов (шаг 8.3). За прокси (Caddy на сервере, шаг 8.4) — первый адрес из X-Forwarded-For:
// Caddy сам ставит его и не пропускает поддельный из запроса. На ПК владельца без прокси адрес подделать можно — это только домашняя сеть.
import { headers } from "next/headers";

export function ipFrom(h: Headers): string {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 64) || "local";
}

export async function requestIp(): Promise<string> {
  return ipFrom(await headers());
}
