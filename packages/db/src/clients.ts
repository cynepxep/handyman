// Клиенты (единый покупатель по телефону): список и карточка в админке, правки с журналом, сумма покупок и уровень.
// Правила уровней и скидок — чистые функции в @handyman/core/shop (loyalty.ts); здесь — база.
// Сумма покупок = выполненные (DONE) НЕтестовые заказы; пересчитывается при смене статуса заказа.

import { prisma, type Prisma, type ClientTier } from "./client";
import {
  TIER_KEYS, TIER_RU, clientDiscountPct, nextStoredTier, normalizeLoyalty, normalizePhone, tierProgress,
  type ClientEditInput, type LoyaltySettings, type TierKey,
} from "@handyman/core/shop";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
export const LOYALTY_SETTING_KEY = "shop.loyalty";

// ---------- настройки уровней ----------

export async function loadLoyalty(): Promise<LoyaltySettings> {
  const row = await prisma.setting.findUnique({ where: { key: LOYALTY_SETTING_KEY } });
  return normalizeLoyalty(row?.value);
}

/** Сохранить настройки уровней и пересчитать уровни всех клиентов (пороги могли измениться). */
export async function saveLoyalty(raw: unknown, who: string): Promise<LoyaltySettings> {
  const value = normalizeLoyalty(raw);
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: LOYALTY_SETTING_KEY }, update: { value: json(value) }, create: { key: LOYALTY_SETTING_KEY, value: json(value) } }),
    prisma.auditLog.create({ data: { who, action: "shop.loyalty.edit", details: json(value) } }),
  ]);
  await recalcAllClients(value);
  return value;
}

// ---------- сумма покупок и уровень ----------

/** Пересчитать сумму покупок и уровень одного клиента (внутри транзакции смены статуса заказа). */
export async function recalcClient(tx: Prisma.TransactionClient, clientId: string, s?: LoyaltySettings): Promise<void> {
  s ??= normalizeLoyalty((await tx.setting.findUnique({ where: { key: LOYALTY_SETTING_KEY } }))?.value);
  const [agg, c] = await Promise.all([
    tx.order.aggregate({ where: { clientId, status: "DONE", isTest: false }, _sum: { total: true } }),
    tx.client.findUnique({ where: { id: clientId }, select: { tier: true } }),
  ]);
  if (!c) return;
  const spent = agg._sum.total?.toNumber() ?? 0;
  await tx.client.update({ where: { id: clientId }, data: { spent, tier: nextStoredTier(c.tier as TierKey, spent, s) as ClientTier } });
}

export async function recalcAllClients(s?: LoyaltySettings): Promise<number> {
  s ??= await loadLoyalty();
  const ids = await prisma.client.findMany({ select: { id: true } });
  for (const { id } of ids) await prisma.$transaction((tx) => recalcClient(tx, id, s));
  return ids.length;
}

// ---------- список ----------

export type ClientSort = "recent" | "spent" | "orders" | "name";

export async function listClients(opts: { q?: string; tier?: string; sort?: string; page?: number; perPage?: number } = {}) {
  const perPage = opts.perPage ?? 40;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim() ?? "";
  const phone = q ? normalizePhone(q) : null;
  const digits = q.replace(/\D/g, "");
  const where: Prisma.ClientWhereInput = {
    ...(opts.tier && (TIER_KEYS as string[]).includes(opts.tier) ? { tier: opts.tier as ClientTier } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q.toLowerCase() } },
            { username: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
            ...(phone ? [{ phone }] : digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : {}),
  };
  const sort = (["recent", "spent", "orders", "name"] as const).includes(opts.sort as ClientSort) ? (opts.sort as ClientSort) : "recent";
  const orderBy: Prisma.ClientOrderByWithRelationInput[] =
    sort === "spent" ? [{ spent: "desc" }] : sort === "orders" ? [{ orders: { _count: "desc" } }] : sort === "name" ? [{ name: "asc" }] : [{ createdAt: "desc" }];
  const [total, rows] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where, orderBy, skip: (page - 1) * perPage, take: perPage,
      select: {
        id: true, name: true, phone: true, email: true, username: true, tgId: true, tier: true, spent: true, manualDiscountPct: true, createdAt: true, note: true,
        _count: { select: { orders: true } },
        orders: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, no: true } },
      },
    }),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / perPage)), sort, rows };
}

// ---------- карточка ----------

export async function getClientDetail(id: string) {
  const c = await prisma.client.findUnique({
    where: { id },
    include: {
      orders: { orderBy: { createdAt: "desc" }, take: 100, select: { id: true, no: true, status: true, total: true, isTest: true, createdAt: true, source: true, delivery: true, _count: { select: { items: true } } } },
      auditEntries: { orderBy: { ts: "desc" }, take: 100 },
    },
  });
  if (!c) return null;
  const s = await loadLoyalty();
  const real = c.orders.filter((o) => !o.isTest);
  const done = real.filter((o) => o.status === "DONE");
  const spent = c.spent.toNumber();
  return {
    client: c,
    loyalty: s,
    stats: {
      orders: real.length,
      done: done.length,
      cancelled: real.filter((o) => o.status === "CANCELLED" || o.status === "RETURNED").length,
      spent,
      avg: done.length ? Math.round((spent / done.length) * 100) / 100 : 0,
      first: real.at(-1)?.createdAt ?? null,
      last: real[0]?.createdAt ?? null,
    },
    discount: clientDiscountPct({ tier: c.tier as TierKey, manualDiscountPct: c.manualDiscountPct }, s),
    progress: tierProgress(spent, c.tier as TierKey, s),
  };
}

// ---------- правка ----------

const FIELD_RU: Record<string, string> = {
  name: "Имя", phone: "Телефон", email: "Почта", lang: "Язык", note: "Заметка", manualDiscountPct: "Личная скидка", tier: "Уровень",
};

const show = (field: string, v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (field === "lang") return v === "RU" ? "русский" : "украинский";
  if (field === "tier") return TIER_RU[v as TierKey] ?? String(v);
  if (field === "manualDiscountPct") return `${v} %`;
  return String(v);
};

/** Сохранить правку карточки клиента. Каждое изменённое поле — строка в журнале клиента (ClientAudit) и в общем журнале. */
export async function updateClient(id: string, v: ClientEditInput, who: string): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const cur = await prisma.client.findUnique({ where: { id } });
  if (!cur) return { ok: false, error: "Клиент не найден." };
  if (v.phone && v.phone !== cur.phone) {
    const taken = await prisma.client.findUnique({ where: { phone: v.phone }, select: { id: true, name: true } });
    if (taken) return { ok: false, error: `Этот телефон уже у другого клиента${taken.name ? ` (${taken.name})` : ""}. Объединение клиентов появится позже.` };
  }
  if (!v.phone && cur.phone) return { ok: false, error: "Телефон нельзя удалить: по нему клиент узнаётся на сайте и в Telegram." };
  if (v.email && v.email !== cur.email) {
    const taken = await prisma.client.findUnique({ where: { email: v.email }, select: { id: true } });
    if (taken) return { ok: false, error: "Эта почта уже у другого клиента." };
  }
  const s = await loadLoyalty();
  const tier: TierKey = v.wholesale ? "WHOLESALE" : cur.tier === "WHOLESALE" ? nextStoredTier("START", cur.spent.toNumber(), s) : (cur.tier as TierKey);
  const next = { name: v.name || null, phone: v.phone || null, email: v.email || null, lang: v.lang, note: v.note || null, manualDiscountPct: v.manualDiscountPct, tier };
  const diffs = (Object.keys(next) as Array<keyof typeof next>)
    .filter((k) => (cur[k] ?? null) !== (next[k] ?? null))
    .map((k) => ({ field: k, oldValue: show(k, cur[k]), newValue: show(k, next[k]) }));
  if (!diffs.length) return { ok: true, changed: 0 };
  await prisma.$transaction([
    prisma.client.update({ where: { id }, data: { ...next, tier: next.tier as ClientTier } }),
    prisma.clientAudit.createMany({ data: diffs.map((d) => ({ clientId: id, who, field: FIELD_RU[d.field] ?? d.field, oldValue: d.oldValue, newValue: d.newValue })) }),
    prisma.auditLog.create({ data: { who, action: "client.edit", target: id, details: json(diffs.map((d) => d.field)) } }),
  ]);
  return { ok: true, changed: diffs.length };
}
