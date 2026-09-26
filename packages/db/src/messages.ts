// Шаблоны сообщений покупателю (по статусам заказа) и отправка сообщений из карточки заказа (шаг 4.2).
// Правила подстановок и тексты по умолчанию — @handyman/core/shop (templates.ts). Язык сообщения — язык сайта, где оформлен заказ.

import { prisma, type OrderStatus, type Prisma } from "./client";
import { DEFAULT_TEMPLATES, firstNameOf, renderTemplate, type TemplateForm, type TemplateVars } from "@handyman/core/shop";
import { notifyClient, type NotifyResult } from "./notify";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

const SEEDED_KEY = "templates.seeded.v1";

/**
 * Один раз кладём тексты по умолчанию для статусов, у которых шаблонов нет (пустая база — все; база с шаблонами прототипа — только
 * новые статусы «Не дозвонились», «Ждём товар», «Возврат»). Отметка в Setting: удалённые владельцем шаблоны не возвращаются.
 */
export async function ensureDefaultTemplates(): Promise<void> {
  if (await prisma.setting.findUnique({ where: { key: SEEDED_KEY }, select: { key: true } })) return;
  const have = new Set((await prisma.orderStatusTemplate.findMany({ select: { status: true } })).map((t) => t.status));
  const add = DEFAULT_TEMPLATES.map((t, i) => ({ ...t, sort: i })).filter((t) => !have.has(t.status));
  await prisma.$transaction([
    ...(add.length ? [prisma.orderStatusTemplate.createMany({ data: add })] : []),
    prisma.setting.upsert({ where: { key: SEEDED_KEY }, update: {}, create: { key: SEEDED_KEY, value: json({ at: new Date().toISOString(), added: add.length }) } }),
  ]);
}

export async function listTemplates() {
  await ensureDefaultTemplates();
  return prisma.orderStatusTemplate.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] });
}

export async function saveTemplate(id: string | null, v: TemplateForm, who: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (id) {
    const cur = await prisma.orderStatusTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!cur) return { ok: false, error: "Шаблон не найден (возможно, его удалили)." };
    await prisma.$transaction([
      prisma.orderStatusTemplate.update({ where: { id }, data: v }),
      prisma.auditLog.create({ data: { who, action: "template.edit", target: id, details: json({ title: v.titleRu }) } }),
    ]);
    return { ok: true, id };
  }
  const last = await prisma.orderStatusTemplate.aggregate({ _max: { sort: true } });
  const t = await prisma.orderStatusTemplate.create({ data: { ...v, sort: (last._max.sort ?? 0) + 1 } });
  await prisma.auditLog.create({ data: { who, action: "template.create", target: t.id, details: json({ title: v.titleRu }) } });
  return { ok: true, id: t.id };
}

export async function deleteTemplate(id: string, who: string): Promise<void> {
  const t = await prisma.orderStatusTemplate.findUnique({ where: { id } });
  if (!t) return;
  await prisma.$transaction([
    prisma.orderStatusTemplate.delete({ where: { id } }),
    prisma.auditLog.create({ data: { who, action: "template.delete", target: id, details: json({ title: t.titleRu }) } }),
  ]);
}

// ---------- сообщения по заказу ----------

async function orderForMessages(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, no: true, ttn: true, total: true, dueNow: true, paidAmount: true, recipientName: true, lang: true, client: { select: { name: true, tgId: true, lang: true } } },
  });
}

type OrderForMessages = NonNullable<Awaited<ReturnType<typeof orderForMessages>>>;

const langOf = (o: OrderForMessages): "uk" | "ru" => ((o.lang ?? o.client.lang) === "RU" ? "ru" : "uk");

function varsOf(o: OrderForMessages): TemplateVars {
  const lang = langOf(o);
  const total = o.total.toNumber();
  const paid = Math.max(o.dueNow.toNumber(), o.paidAmount.toNumber());
  return { name: firstNameOf(o.recipientName || o.client.name, lang), no: o.no, ttn: o.ttn, sum: total, due: total - paid };
}

/** Шаблоны с готовым текстом для этого заказа (на языке покупателя) — для выбора в карточке заказа. */
export async function templatesForOrder(orderId: string) {
  const o = await orderForMessages(orderId);
  if (!o) return { lang: "uk" as const, hasTelegram: false, items: [] };
  const lang = langOf(o);
  const vars = varsOf(o);
  const items = (await listTemplates()).map((t) => ({
    id: t.id, status: t.status, title: t.titleRu, autoSend: t.autoSend, text: renderTemplate(lang === "ru" ? t.textRu : t.textUk, vars),
  }));
  return { lang, hasTelegram: o.client.tgId != null, items };
}

export type SendReport = { sent: number; noChannel: number; failed: number; dev: number };

/**
 * Отправить покупателю выбранные шаблоны и/или свой текст. Каждое сообщение — строка Outbox (audience=client) и запись в истории заказа.
 * ТТН и суммы подставляются на момент отправки (поэтому вызывать ПОСЛЕ сохранения статуса/ТТН).
 */
export async function sendOrderMessages(orderId: string, p: { templateIds?: string[]; customText?: string }, who: string): Promise<SendReport> {
  const report: SendReport = { sent: 0, noChannel: 0, failed: 0, dev: 0 };
  const o = await orderForMessages(orderId);
  if (!o) return report;
  const lang = langOf(o);
  const vars = varsOf(o);
  const ids = [...new Set(p.templateIds ?? [])];
  const tpls = ids.length ? await prisma.orderStatusTemplate.findMany({ where: { id: { in: ids } }, orderBy: [{ sort: "asc" }, { id: "asc" }] }) : [];
  const messages = tpls.map((t) => ({ title: t.titleRu, text: renderTemplate(lang === "ru" ? t.textRu : t.textUk, vars) }));
  const custom = p.customText?.trim().slice(0, 2000);
  if (custom) messages.push({ title: "свой текст", text: custom });
  for (const m of messages) {
    const r: NotifyResult = await notifyClient({ orderId, tgId: o.client.tgId, text: m.text, who });
    if (r === "SENT") report.sent++;
    else if (r === "NO_CHANNEL") report.noChannel++;
    else if (r === "DEV") report.dev++;
    else report.failed++;
    await prisma.orderHistory.create({
      data: { orderId, text: `Сообщение покупателю «${m.title}» (${who}): ${r === "SENT" ? "отправлено в Telegram" : r === "NO_CHANNEL" ? "покупатель ещё не подключил бота — скопируйте текст" : r === "DEV" ? "не отправлено: бот не настроен" : "ошибка отправки"}` },
    });
  }
  return report;
}

/** Автоматические сообщения статуса (флаг «отправлять автоматически») — для смены статуса без менеджера: оплата, Нова Пошта (Этап 3). */
export async function sendAutoMessages(orderId: string, status: OrderStatus, who: string): Promise<SendReport> {
  const ids = (await prisma.orderStatusTemplate.findMany({ where: { status, autoSend: true }, select: { id: true } })).map((t) => t.id);
  return sendOrderMessages(orderId, { templateIds: ids }, who);
}

/** Сообщения покупателю по заказу — для карточки заказа. */
export const clientMessagesOf = (orderId: string) =>
  prisma.outbox.findMany({ where: { orderId, audience: "client" }, orderBy: { createdAt: "asc" } });
