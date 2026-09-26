// Задачи-напоминания и гарантийные обращения (шаг 4.5б). Правила — @handyman/core/shop (service.ts).
// Напоминания в Telegram по сроку задачи — шаг 4.8 (фоновые задачи); здесь поле notifiedAt под это.

import { prisma, type Prisma } from "./client";
import { SERVICE_CLIENT_TEXT, SERVICE_STATUS_RU, SERVICE_RESOLUTIONS, normalizePhone, serviceNo, taskBucket, type ServiceStatus, type TaskBucket } from "@handyman/core/shop";
import { notifyClient, type NotifyResult } from "./notify";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

// ---------- задачи ----------

export async function createTask(v: { title: string; dueAt: Date | null; assignee: string | null; orderId?: string | null; clientId?: string | null }, who: string) {
  let clientId = v.clientId ?? null;
  if (!clientId && v.orderId) clientId = (await prisma.order.findUnique({ where: { id: v.orderId }, select: { clientId: true } }))?.clientId ?? null;
  const t = await prisma.task.create({ data: { title: v.title, dueAt: v.dueAt, assignee: v.assignee, orderId: v.orderId ?? null, clientId, who } });
  if (v.orderId) await prisma.orderHistory.create({ data: { orderId: v.orderId, text: `Задача: ${v.title}${v.dueAt ? ` (до ${v.dueAt.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" })})` : ""} — ${who}` } });
  return t;
}

export async function setTaskDone(id: string, done: boolean, who: string): Promise<void> {
  await prisma.task.update({ where: { id }, data: done ? { done: true, doneAt: new Date(), doneBy: who } : { done: false, doneAt: null, doneBy: null } });
}

export async function deleteTask(id: string, who: string): Promise<void> {
  const t = await prisma.task.findUnique({ where: { id } });
  if (!t) return;
  await prisma.$transaction([prisma.task.delete({ where: { id } }), prisma.auditLog.create({ data: { who, action: "task.delete", target: id, details: json({ title: t.title }) } })]);
}

export type TaskRow = Awaited<ReturnType<typeof listTasks>>["rows"][number];

/** Задачи: открытые (просроченные сверху, потом по сроку) или выполненные; фильтр по заказу/клиенту/исполнителю. */
export async function listTasks(opts: { orderId?: string; clientId?: string; assignee?: string; done?: boolean; limit?: number } = {}) {
  const where: Prisma.TaskWhereInput = {
    done: opts.done ?? false,
    ...(opts.orderId ? { orderId: opts.orderId } : {}),
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    ...(opts.assignee ? { OR: [{ assignee: opts.assignee }, { assignee: null }] } : {}),
  };
  const rows = await prisma.task.findMany({ where, orderBy: opts.done ? [{ doneAt: "desc" }] : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: opts.limit ?? 200 });
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => Boolean(x)))];
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => Boolean(x)))];
  const [orders, clients] = await Promise.all([
    orderIds.length ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, no: true } }) : [],
    clientIds.length ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, phone: true } }) : [],
  ]);
  const no = new Map(orders.map((o) => [o.id, o.no]));
  const cl = new Map(clients.map((c) => [c.id, c]));
  const now = new Date();
  const withMeta = rows.map((r) => ({ ...r, bucket: taskBucket(r.dueAt, now) as TaskBucket, orderNo: r.orderId ? no.get(r.orderId) ?? null : null, client: r.clientId ? cl.get(r.clientId) ?? null : null }));
  const counts = { overdue: withMeta.filter((r) => r.bucket === "overdue").length, today: withMeta.filter((r) => r.bucket === "today").length };
  return { rows: withMeta, counts };
}

/** Сколько открытых задач просрочено/на сегодня — для меню и главной админки. */
export async function taskCounts(assignee?: string) {
  const { counts } = await listTasks({ assignee, limit: 1000 });
  return counts;
}

// ---------- гарантия ----------

/** Новое гарантийное обращение. Если указан номер заказа — привязываем заказ и клиента; товар — по артикулу из заказа. */
export async function createServiceCase(v: { productName: string; serial: string; problem: string; phone: string; name: string; orderNo: string; sku: string }, who: string): Promise<{ ok: true; id: string; seq: number } | { ok: false; error: string }> {
  let orderId: string | null = null;
  let clientId: string | null = null;
  let phone = v.phone ? normalizePhone(v.phone) : null;
  let name = v.name || null;
  if (v.orderNo) {
    const o = await prisma.order.findUnique({ where: { no: v.orderNo }, select: { id: true, clientId: true, recipientPhone: true, recipientName: true } });
    if (!o) return { ok: false, error: `Заказ ${v.orderNo} не найден.` };
    orderId = o.id;
    clientId = o.clientId;
    phone ??= o.recipientPhone;
    name ??= o.recipientName;
  }
  if (!clientId && phone) clientId = (await prisma.client.findUnique({ where: { phone }, select: { id: true } }))?.id ?? null;
  const productId = v.sku ? (await prisma.product.findUnique({ where: { sku: v.sku }, select: { id: true } }))?.id ?? null : null;
  // товар выбран из заказа — название берём из строки заказа (а не из подсказки формы)
  const fromOrder = orderId && v.sku ? await prisma.orderItem.findFirst({ where: { orderId, sku: v.sku }, select: { name: true } }) : null;
  const c = await prisma.serviceCase.create({
    data: {
      productName: fromOrder?.name ?? v.productName, serial: v.serial || null, problem: v.problem, phone, name, orderId, clientId, productId, who,
      events: { create: { who, text: `Обращение принято: ${v.problem.slice(0, 300)}` } },
    },
  });
  if (orderId) await prisma.orderHistory.create({ data: { orderId, text: `Гарантийное обращение ${serviceNo(c.seq)}: ${v.productName} (${who})` } });
  return { ok: true, id: c.id, seq: c.seq };
}

export async function listServiceCases(opts: { status?: string; open?: boolean; q?: string } = {}) {
  const q = opts.q?.trim();
  return prisma.serviceCase.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : opts.open ? { status: { notIn: ["CLOSED", "REJECTED"] } } : {}),
      ...(q ? { OR: [{ productName: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }, { serial: { contains: q } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export const getServiceCase = (id: string) => prisma.serviceCase.findUnique({ where: { id }, include: { events: { orderBy: { ts: "asc" } } } });

/**
 * Сменить статус обращения (+ итог, заметка) и при желании написать покупателю (Telegram, если подключён бот; иначе — «скопируйте текст»).
 * Сообщение пишется в историю обращения.
 */
export async function updateServiceCase(id: string, p: { status: ServiceStatus; resolution?: string; note?: string; message?: string }, who: string): Promise<{ ok: boolean; error?: string; sent?: NotifyResult }> {
  const c = await prisma.serviceCase.findUnique({ where: { id } });
  if (!c) return { ok: false, error: "Обращение не найдено." };
  const resolution = p.resolution && SERVICE_RESOLUTIONS[p.resolution] ? p.resolution : c.resolution;
  const parts = [
    c.status !== p.status ? `Статус: ${SERVICE_STATUS_RU[p.status]}` : null,
    resolution !== c.resolution && resolution ? `Итог: ${SERVICE_RESOLUTIONS[resolution]}` : null,
    p.note?.trim() ? p.note.trim().slice(0, 500) : null,
  ].filter(Boolean);
  await prisma.serviceCase.update({ where: { id }, data: { status: p.status, resolution } });
  if (parts.length) await prisma.serviceEvent.create({ data: { caseId: id, who, text: parts.join(" · ") } });
  let sent: NotifyResult | undefined;
  const msg = p.message?.trim();
  if (msg) {
    const client = c.clientId ? await prisma.client.findUnique({ where: { id: c.clientId }, select: { tgId: true } }) : null;
    sent = await notifyClient({ orderId: c.orderId, tgId: client?.tgId ?? null, text: msg, who });
    await prisma.serviceEvent.create({ data: { caseId: id, who, text: `Сообщение покупателю (${sent === "SENT" ? "отправлено в Telegram" : sent === "NO_CHANNEL" ? "без бота — скопируйте текст" : sent === "DEV" ? "бот не настроен" : "ошибка"}): ${msg.slice(0, 500)}` } });
  }
  return { ok: true, sent };
}

/** Черновик сообщения покупателю для статуса: {no}, {product} подставлены. */
export function serviceDraft(c: { seq: number; productName: string }, status: ServiceStatus, lang: "uk" | "ru"): string {
  return SERVICE_CLIENT_TEXT[status][lang].replaceAll("{no}", serviceNo(c.seq)).replaceAll("{product}", c.productName);
}
