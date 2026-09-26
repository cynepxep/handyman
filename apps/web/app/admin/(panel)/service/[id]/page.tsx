import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@handyman/db";
import { getServiceCase, serviceDraft } from "@handyman/db/service";
import { SERVICE_RESOLUTIONS, SERVICE_STATUS_RU, SERVICE_STATUSES, formatPhone, serviceNo, type ServiceStatus } from "@handyman/core/shop";
import { requirePermission } from "@/lib/auth";
import { updateServiceAction } from "../actions";
import { ServiceStatusForm } from "./service-form";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });

export default async function ServiceCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const session = await requirePermission("orders.view");
  const { id } = await params;
  const sp = await searchParams;
  const c = await getServiceCase(id);
  if (!c) notFound();
  const [order, client] = await Promise.all([
    c.orderId ? prisma.order.findUnique({ where: { id: c.orderId }, select: { id: true, no: true, lang: true } }) : null,
    c.clientId ? prisma.client.findUnique({ where: { id: c.clientId }, select: { id: true, lang: true, tgId: true } }) : null,
  ]);
  const lang = (order?.lang ?? client?.lang) === "RU" ? "ru" : "uk";
  const drafts = Object.fromEntries(SERVICE_STATUSES.map((s) => [s, serviceDraft(c, s, lang)]));

  return (
    <>
      <p><Link className="adm-link" href="/admin/service">← Гарантия</Link></p>
      <h1>
        {serviceNo(c.seq)} · {c.productName}{" "}
        <span className="adm-chip warn" style={{ fontSize: 14, verticalAlign: "middle" }}>{SERVICE_STATUS_RU[c.status as ServiceStatus] ?? c.status}</span>
      </h1>
      <p className="adm-muted">
        Принят {when(c.createdAt)} ({c.who}){c.serial ? ` · S/N ${c.serial}` : ""}
        {c.resolution && <> · итог: <b>{SERVICE_RESOLUTIONS[c.resolution]}</b></>}
      </p>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}
      <div className="adm-grid2">
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>Покупатель</h2>
          <p><b>{c.name ?? "—"}</b>{c.phone && <> · <a className="adm-link" href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a></>}</p>
          {order && <p>Заказ: <Link className="adm-link" href={`/admin/orders/${order.id}`}>{order.no}</Link></p>}
          {client && session.permissions.includes("clients.view") && <p><Link className="adm-link" href={`/admin/clients/${client.id}`}>Карточка клиента →</Link></p>}
          <p className="adm-muted">{client?.tgId != null ? "Подключил бота — сообщения придут в Telegram." : "Бот не подключён — сообщение сохранится для копирования в Viber/SMS."}</p>
        </section>
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>Неисправность</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.problem}</p>
        </section>
      </div>
      {session.permissions.includes("orders.edit") && (
        <ServiceStatusForm
          action={updateServiceAction} id={c.id} current={c.status} resolution={c.resolution}
          statuses={SERVICE_STATUSES.map((s) => ({ key: s, ru: SERVICE_STATUS_RU[s] }))} resolutions={SERVICE_RESOLUTIONS} drafts={drafts}
        />
      )}
      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>История</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {c.events.map((e) => <li key={e.id}><span className="adm-muted">{when(e.ts)} · {e.who}</span> — {e.text}</li>)}
        </ul>
      </section>
    </>
  );
}
