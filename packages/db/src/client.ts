// Один экземпляр PrismaClient на процесс (в dev-режиме Next.js модуль
// переимпортируется при каждом горячем перезапуске — без этого плодились бы
// лишние подключения к базе).
import { PrismaClient } from "../generated/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "../generated/client";
