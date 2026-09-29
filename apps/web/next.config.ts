import { join } from "node:path";
import type { NextConfig } from "next";
import { IMAGE_HOSTS } from "./lib/image-hosts";
import { securityHeaders } from "./lib/security-headers";

// Шаг 8.4: сборка для сервера (Docker) — самодостаточная папка .next/standalone (запуск: node apps/web/server.js).
// Включается переменной NEXT_STANDALONE=1 (её ставит apps/web/Dockerfile); на ПК владельца сборка и next start — как раньше.
const standalone = process.env.NEXT_STANDALONE === "1";

const nextConfig: NextConfig = {
  transpilePackages: ["@handyman/db", "@handyman/core"],
  ...(standalone && {
    output: "standalone" as const,
    // монорепозиторий: пакеты packages/db и packages/core лежат выше папки сайта
    outputFileTracingRoot: join(__dirname, "..", ".."),
    turbopack: { root: join(__dirname, "..", "..") },
  }),
  // шаг 8.3: не сообщаем, на чём сделан сайт; заголовки безопасности — lib/security-headers.ts
  poweredByHeader: false,
  headers: async () => securityHeaders(process.env.NODE_ENV === "production"),
  // Фото товаров: свои копии (/media/…, скачиваются в админке «Фото товаров»), пока копии нет — с сайта поставщика.
  // В обоих случаях покупателю отдаются уменьшенные (WebP/AVIF) через наш сервер с кэшем.
  images: {
    // новый поставщик: добавьте его сайт в lib/image-hosts.ts (или просто скачайте его фото в «Фото товаров»)
    remotePatterns: IMAGE_HOSTS.map((hostname) => ({ protocol: "https" as const, hostname })),
    // свои копии фото (/media/… — маршрут app/media, файлы в MEDIA_DIR)
    localPatterns: [{ pathname: "/media/**" }],
    formats: ["image/avif", "image/webp"],
    qualities: [75],
    minimumCacheTTL: 60 * 60 * 24 * 7, // неделя: фото товаров меняются редко
  },
  // Режим разработки: разрешить открывать сайт с телефона по адресу компьютера в домашней сети (192.168.x.x).
  allowedDevOrigins: ["192.168.*.*"],
  experimental: {
    // Файл XML-фида поставщика (Vitals ≈ 14 МБ) загружается через форму в админке.
    serverActions: { bodySizeLimit: "60mb" },
    // Иначе proxy.ts молча обрезает тело запроса на 10 МБ, и файл фида приходит неполным.
    proxyClientMaxBodySize: "60mb",
    // У витрины, админки и стендов свои корневые layout: для незнакомых адресов нужна общая страница 404.
    globalNotFound: true,
  },
};

export default nextConfig;
