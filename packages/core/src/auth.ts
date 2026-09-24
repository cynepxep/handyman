// Примитивы авторизации персонала: хеширование пароля (scrypt) и токены сессий.
// Тот же подход, что в старом проекте (src/app.js), просто вынесен в общий пакет.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const check = scryptSync(password, salt, KEY_LEN);
  const expected = Buffer.from(hash, "hex");
  if (check.length !== expected.length) return false;
  return timingSafeEqual(check, expected);
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов
export const CLIENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
