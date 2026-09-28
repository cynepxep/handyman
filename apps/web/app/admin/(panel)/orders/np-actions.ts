"use server";

// Нова Пошта в карточке заказа (шаг 3.4): создать / удалить ТТН, вписать номер вручную, обновить статус, исправить отделение получателя,
// тестовые статусы (НП не подключена). Ошибки — понятным текстом в верхней плашке заказа.
import { redirect } from "next/navigation";
import { NP_STUB_CODES, validateTtnForm } from "@handyman/core/shop";
import { NpError, createTtn, deleteTtn, refreshShipment, setManualTtn, setOrderNpPoint, stubTrack } from "@handyman/db/np-shipments";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";

const back = (id: string, kind: "ok" | "error", text: string) => `/admin/orders/${encodeURIComponent(id)}?${kind}=${encodeURIComponent(text)}#np`;
const npError = (e: unknown) => (e instanceof NpError ? e.message : "Не получилось — попробуйте ещё раз.");
const fields = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));

export async function createTtnAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const o = await prisma.order.findUnique({ where: { id }, select: { total: true } });
  if (!o) redirect("/admin/orders");
  const check = validateTtnForm(fields(formData), o.total.toNumber());
  if (!check.ok) redirect(back(id, "error", check.error));
  let text: string;
  try {
    const r = await createTtn(id, check.value, session.name || session.username);
    text = `ТТН ${r.ttn} создана${r.stub ? " (тестовая — Нова Пошта не подключена)" : ""}${r.cost != null ? `, доставка ${r.cost} ₴` : ""}. Распечатайте наклейку.`;
  } catch (e) {
    redirect(back(id, "error", npError(e)));
  }
  redirect(back(id, "ok", text));
}

export async function deleteTtnAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  try {
    await deleteTtn(String(formData.get("sh") ?? ""), session.name || session.username);
  } catch (e) {
    redirect(back(id, "error", npError(e)));
  }
  redirect(back(id, "ok", "ТТН удалена."));
}

/** Номер ТТН вручную (создана в кабинете или приложении НП). Пусто — убрать. */
export async function manualTtnAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const r = await setManualTtn(id, String(formData.get("ttn") ?? ""), session.name || session.username);
  redirect(back(id, r.ok ? "ok" : "error", r.ok ? "ТТН сохранена." : r.error));
}

export async function refreshShipmentAction(formData: FormData): Promise<void> {
  await requirePermission("orders.view");
  const id = String(formData.get("id") ?? "");
  let text: string;
  try {
    text = await refreshShipment(String(formData.get("sh") ?? ""));
  } catch (e) {
    redirect(back(id, "error", npError(e)));
  }
  redirect(back(id, "ok", text));
}

export async function setNpPointAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const kind = formData.get("kind") === "postomat" ? "postomat" : "warehouse";
  const r = await setOrderNpPoint(id, String(formData.get("city") ?? ""), String(formData.get("number") ?? ""), kind, session.name || session.username);
  redirect(back(id, r.ok ? "ok" : "error", r.ok ? "Отделение получателя сохранено." : r.error));
}

/** Тестовые статусы посылки (только тестовые ТТН). */
export async function stubTrackAction(formData: FormData): Promise<void> {
  await requirePermission("orders.edit");
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "") as keyof typeof NP_STUB_CODES;
  if (!(kind in NP_STUB_CODES)) redirect(back(id, "error", "Неизвестный тестовый статус."));
  const changed = await stubTrack(String(formData.get("sh") ?? ""), kind);
  redirect(back(id, "ok", changed ? `Тест: статус посылки — «${NP_STUB_CODES[kind].text}».` : "Статус не изменился."));
}
