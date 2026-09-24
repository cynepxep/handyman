import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@handyman/db", "@handyman/core"],
  experimental: {
    // Файл XML-фида поставщика (Vitals ≈ 14 МБ) загружается через форму в админке.
    serverActions: { bodySizeLimit: "60mb" },
    // Иначе proxy.ts молча обрезает тело запроса на 10 МБ, и файл фида приходит неполным.
    proxyClientMaxBodySize: "60mb",
  },
};

export default nextConfig;
