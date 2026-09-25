import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@handyman/db", "@handyman/core"],
  // Фото товаров: берём с сайта поставщика и отдаём покупателю уменьшенными (WebP/AVIF) через наш сервер с кэшем.
  // Своё хранилище фото — позже (вопрос Т1/В5 в docs/stage2/06-OPEN-QUESTIONS.md).
  images: {
    remotePatterns: [{ protocol: "https", hostname: "vitals.ua", pathname: "/image/**" }],
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
