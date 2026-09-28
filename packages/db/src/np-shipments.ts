// Нова Пошта (шаг 3.4): ТТН кнопкой из заказа, номер вручную, статусы посылок и автостатусы заказа, сообщения покупателю,
// отказы и чёрный список, настройки отправителя, печать. Стоимость и срок доставки покупателю не считаем (решение владельца 2026-09-28).
// Ключ — только через secret("novaposhta.apiKey"). Без ключа: на компьютере разработки — тестовые ТТН (номер «99…», в НП не уходят;
// статусы — тестовыми кнопками в заказе), в production — ТТН только вручную (номер из кабинета НП).
// Правила (статусы, тело запроса, разбор ответов) — @handyman/core/shop (novaposhta.ts). Запросы — npRequest (novaposhta.ts), в тестах — setNovaPoshtaFetch.

import { prisma, Prisma } from "./client";
import {
  NP_SETTING_KEY, NP_STATE_RU, NP_STUB_CODES, autoOrderStatus, counterpartyProps, isStuck, npErrorText,
  npNextCheck, npPhone, npPrintUrl, npStateOf, npToday, parcelWeightKg, parseNpSettings, readCounterparty, readRefList,
  readTracking, readTtnSave, refusalStats, senderMissing, shouldBlacklist, ttnProps, weightKgFromAttr, firstNameOf,
  type NpParcelForm, type NpSettings, type NpState, type TtnForm,
} from "@handyman/core/shop";
import { fillText, resolveTexts } from "@handyman/core/site";
import { secret } from "./integrations";
import { npCities, npPoints, npRequest, type NpPointKind } from "./novaposhta";
import { loadTextOverrides } from "./site-content";
import { notifyManagers } from "./notify";
import { setOrderStatus } from "./orders";
import { sendAutoMessages, sendOrderMessages } from "./messages";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;
const money = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₴`;
const moneyUa = (n: number) => `${n.toLocaleString("uk-UA", { maximumFractionDigits: 2 }).replace(/ /g, " ")} ₴`;
const WHO = "Нова Пошта";

export class NpError extends Error {}

// ---------- режим и настройки ----------

export type NpMode = "live" | "stub" | "off";

/** live — есть ключ; stub — нет ключа, не production (тестовые ТТН); off — ТТН только вручную. */
export async function npMode(): Promise<NpMode> {
  if (await secret("novaposhta.apiKey")) return "live";
  return process.env.NODE_ENV === "production" ? "off" : "stub";
}

export async function loadNpSettings(): Promise<NpSettings> {
  return parseNpSettings((await prisma.setting.findUnique({ where: { key: NP_SETTING_KEY } }))?.value);
}

async function saveNpSettings(v: NpSettings, who: string, action: string) {
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: NP_SETTING_KEY }, update: { value: json(v) }, create: { key: NP_SETTING_KEY, value: json(v) } }),
    prisma.auditLog.create({ data: { who, action, details: json({ ...v }) } }),
  ]);
}

/** Посылка по умолчанию и правила (вес, места, наложенный платёж, автостатусы, чёрный список). */
export async function saveNpParcel(v: NpParcelForm, who: string): Promise<void> {
  await saveNpSettings({ ...(await loadNpSettings()), ...v }, who, "np.settings.parcel");
}

/** Отправители и контактные лица из кабинета НП (нужен ключ). */
export async function npSenderOptions(): Promise<
  { ok: true; senders: Array<{ ref: string; name: string; contacts: Array<{ ref: string; name: string; phone: string }> }> } | { ok: false; error: string }
> {
  if ((await npMode()) !== "live") return { ok: false, error: "Список отправителей появится, когда в «Интеграциях» будет вписан API-ключ Новой Почты." };
  const r = await npRequest("Counterparty", "getCounterparties", { CounterpartyProperty: "Sender", Page: "1" });
  if (!r.ok) return { ok: false, error: r.network ? "Нова Пошта не отвечает — попробуйте позже." : npErrorText(r.body) };
  const senders = readRefList(r.body).slice(0, 10);
  const out = [];
  for (const s of senders) {
    const c = await npRequest("Counterparty", "getCounterpartyContactPersons", { Ref: s.ref, Page: "1" });
    out.push({ ...s, contacts: c.ok ? readRefList(c.body).slice(0, 30) : [] });
  }
  return { ok: true, senders: out };
}

/** Выбрать отправителя и контактное лицо (проверяем по свежему списку из кабинета НП — имена и телефон берём оттуда). */
export async function saveNpSender(senderRef: string, contactRef: string, who: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const opts = await npSenderOptions();
  if (!opts.ok) return opts;
  const s = opts.senders.find((x) => x.ref === senderRef);
  const c = s?.contacts.find((x) => x.ref === contactRef);
  if (!s || !c) return { ok: false, error: "Выберите отправителя и контактное лицо из списка." };
  const phone = /^380\d{9}$/.test(c.phone) ? `+${c.phone}` : "";
  if (!phone) return { ok: false, error: "У контактного лица в кабинете НП нет мобильного телефона — добавьте его там и выберите снова." };
  await saveNpSettings({ ...(await loadNpSettings()), senderRef: s.ref, senderName: s.name, contactRef: c.ref, contactName: c.name, senderPhone: phone }, who, "np.settings.sender");
  return { ok: true };
}

/**
 * Город и отделение по тексту: «Одеса» + «12». Город — точное совпадение названия («м. Одеса, …») или единственный найденный;
 * отделение — по номеру. Работает и без ключа (справочник НП открыт).
 */
export async function resolveNpPoint(cityQuery: string, number: string, kind: NpPointKind = "warehouse"): Promise<
  { ok: true; cityRef: string; cityName: string; pointRef: string; pointName: string } | { ok: false; error: string }
> {
  const q = cityQuery.replace(/^(м\.|с\.|смт|село|місто)\s*/i, "").trim();
  const n = number.replace(/[^\d]/g, "");
  if (q.length < 2) return { ok: false, error: "Впишите город." };
  if (!n) return { ok: false, error: "Впишите номер отделения или почтомата." };
  const list = await npCities(q);
  if (list === null) return { ok: false, error: "Нова Пошта не отвечает — попробуйте позже." };
  const low = q.toLowerCase();
  const exact = list.filter((c) => c.name.toLowerCase().replace(/^(м\.|с\.|смт)\s*/, "").split(",")[0].trim() === low);
  const city = exact[0] ?? (list.length === 1 ? list[0] : null);
  if (!city) return { ok: false, error: list.length ? `Уточните город: ${list.slice(0, 4).map((c) => c.name).join("; ")}.` : "Такой город в справочнике НП не найден." };
  const points = await npPoints(city.ref, kind, n, 50);
  const p = points?.find((x) => x.number === n);
  if (!p) return { ok: false, error: `${kind === "postomat" ? "Почтомат" : "Отделение"} №${n} в городе «${city.name}» не найдено (или не работает).` };
  return { ok: true, cityRef: city.ref, cityName: city.name, pointRef: p.ref, pointName: p.uk };
}

/** Откуда отправляем: город и отделение (для ТТН и расчёта стоимости). */
export async function saveNpSenderPlace(cityQuery: string, number: string, who: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await resolveNpPoint(cityQuery, number, "warehouse");
  if (!r.ok) return r;
  await saveNpSettings({ ...(await loadNpSettings()), cityRef: r.cityRef, cityName: r.cityName, warehouseRef: r.pointRef, warehouseName: r.pointName }, who, "np.settings.place");
  return { ok: true };
}

/** Исправить отделение получателя в заказе (заказ по звонку, номер написан вручную, покупатель попросил другое). */
export async function setOrderNpPoint(orderId: string, cityQuery: string, number: string, kind: NpPointKind, who: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await resolveNpPoint(cityQuery, number, kind);
  if (!r.ok) return r;
  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { city: r.cityName, npCityRef: r.cityRef, npPointRef: r.pointRef, npWarehouseRef: r.pointName, deliveryType: kind } }),
    prisma.orderHistory.create({ data: { orderId, text: `Отделение НП: ${r.cityName}, ${r.pointName} (${who})` } }),
  ]);
  return { ok: true };
}

// ---------- вес ----------

/** Вес товаров из характеристик фида («Вага», «Маса»), кг; брутто важнее нетто. Нет — null. */
export async function productWeights(productIds: string[]): Promise<Map<string, number | null>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const rows = ids.length
    ? await prisma.productAttribute.findMany({
        where: { productId: { in: ids }, OR: [{ key: { startsWith: "Вага", mode: "insensitive" } }, { key: { startsWith: "Маса", mode: "insensitive" } }] },
        select: { productId: true, key: true, value: true },
      })
    : [];
  const out = new Map<string, number | null>(ids.map((id) => [id, null]));
  for (const r of rows.sort((a, b) => Number(/брутто/i.test(b.key)) - Number(/брутто/i.test(a.key)))) {
    if (out.get(r.productId) != null) continue;
    out.set(r.productId, weightKgFromAttr(r.key, r.value));
  }
  return out;
}

/** Вес посылки заказа (по характеристикам товаров, иначе — вес по умолчанию из настроек). */
export async function orderWeightKg(orderId: string, s?: NpSettings): Promise<number> {
  const settings = s ?? (await loadNpSettings());
  const items = await prisma.orderItem.findMany({ where: { orderId }, select: { productId: true, qty: true } });
  const w = await productWeights(items.map((i) => i.productId ?? ""));
  return parcelWeightKg(items.map((i) => ({ kg: i.productId ? w.get(i.productId) ?? null : null, qty: i.qty })), settings.weightKg);
}

// ---------- ТТН ----------

const orderForTtn = (id: string) =>
  prisma.order.findUnique({
    where: { id },
    include: { client: { select: { id: true, phone: true, name: true, blacklisted: true } }, shipments: { where: { active: true } } },
  });

let stubSeq = 0;
const stubTtn = () => `99${String(Date.now()).slice(-9)}${String(++stubSeq % 1000).padStart(3, "0")}`;

/** Создать ТТН кнопкой из заказа. Ошибки — NpError с понятным текстом для менеджера. */
export async function createTtn(orderId: string, form: TtnForm, who: string, now = new Date()): Promise<{ ttn: string; cost: number | null; stub: boolean }> {
  const o = await orderForTtn(orderId);
  if (!o) throw new NpError("Заказ не найден.");
  if (o.delivery !== "NOVA_POSHTA") throw new NpError("У заказа не выбрана доставка Новой Почтой.");
  if (["CANCELLED", "RETURNED"].includes(o.status)) throw new NpError("Заказ отменён — ТТН не нужна.");
  const own = o.shipments.find((sh) => !sh.manual && sh.state !== "deleted");
  if (own) throw new NpError(`У заказа уже есть ТТН ${own.ttn}. Если нужна новая — сначала удалите старую.`);
  const mode = await npMode();
  if (mode === "off") throw new NpError("Нова Пошта не подключена: впишите API-ключ в «Интеграциях» или создайте ТТН в кабинете НП и впишите номер вручную.");

  let made: { ref: string | null; ttn: string; cost: number | null; estDate: Date | null };
  if (mode === "stub") {
    made = { ref: null, ttn: stubTtn(), cost: Math.round(55 + form.weight * 12 + form.declared * 0.005), estDate: new Date(now.getTime() + 2 * 86400_000) };
  } else {
    const s = await loadNpSettings();
    const miss = senderMissing(s);
    if (miss.length) throw new NpError(`Заполните «Нова Пошта → Настройки»: ${miss.join(", ")}.`);
    if (!o.npCityRef || !o.npPointRef) throw new NpError("Отделение получателя не выбрано из справочника НП — укажите его в блоке «Нова Пошта» (город и номер).");
    const phone = o.recipientPhone ?? o.client.phone;
    if (!phone) throw new NpError("В заказе нет телефона получателя.");
    const cp = await npRequest("Counterparty", "save", counterpartyProps(o.recipientName || o.client.name, phone), 15_000);
    const who2 = cp.ok ? readCounterparty(cp.body) : null;
    if (!who2) throw new NpError(!cp.ok && cp.network ? "Нова Пошта не отвечает — попробуйте ещё раз через минуту." : npErrorText(cp.body));
    const res = await npRequest("InternetDocument", "save", ttnProps({
      s, form, date: npToday(now), orderNo: o.no,
      recipient: { ref: who2.ref, contactRef: who2.contactRef, phone, cityRef: o.npCityRef, pointRef: o.npPointRef },
    }), 20_000);
    const saved = res.ok ? readTtnSave(res.body) : null;
    if (!saved) throw new NpError(!res.ok && res.network ? "Нова Пошта не отвечает — ТТН не создана, попробуйте ещё раз." : npErrorText(res.body));
    made = saved;
  }

  await prisma.$transaction(async (tx) => {
    await tx.npShipment.updateMany({ where: { orderId, active: true }, data: { active: false, nextCheckAt: null } });
    await tx.npShipment.create({
      data: {
        orderId, ttn: made.ttn, ref: made.ref, stub: mode === "stub", payer: form.payer, cost: made.cost, cod: form.cod, declared: form.declared,
        weight: form.weight, seats: form.seats, estDate: made.estDate, state: "created", statusCode: "1", statusText: "Створено накладну",
        nextCheckAt: mode === "live" ? new Date(now.getTime() + 2 * 3600_000) : null, createdBy: who,
      },
    });
    const paysShop = form.payer === "Sender" && made.cost != null && o.shopDeliveryCost.toNumber() === 0;
    await tx.order.update({ where: { id: orderId }, data: { ttn: made.ttn, ...(paysShop ? { shopDeliveryCost: made.cost! } : {}) } });
    await tx.orderHistory.create({
      data: {
        orderId,
        text: `ТТН ${made.ttn} создана${mode === "stub" ? " (ТЕСТОВАЯ, в НП не отправлена)" : ""}: ${form.weight} кг, ${form.seats} м., доставку платит ${form.payer === "Sender" ? "магазин" : "получатель"}${made.cost != null ? ` (${money(made.cost)})` : ""}${form.cod > 0 ? `, наложенный платёж ${money(form.cod)}` : ""} (${who})`,
      },
    });
    await tx.auditLog.create({ data: { who, action: "np.ttn.create", target: orderId, details: json({ ttn: made.ttn, stub: mode === "stub" }) } });
  });
  return { ttn: made.ttn, cost: made.cost, stub: mode === "stub" };
}

/** Удалить ТТН (только пока посылку не сдали в НП). */
export async function deleteTtn(shipmentId: string, who: string): Promise<void> {
  const sh = await prisma.npShipment.findUnique({ where: { id: shipmentId }, include: { order: { select: { ttn: true, shopDeliveryCost: true } } } });
  if (!sh || !sh.active) return;
  if (sh.ref && !sh.stub) {
    if (sh.state !== "created" && sh.state !== "unknown") throw new NpError("Посылку уже передали Новой Почте — удалить ТТН нельзя (возврат или переадресация — в кабинете НП).");
    const r = await npRequest("InternetDocument", "delete", { DocumentRefs: sh.ref }, 15_000);
    if (!r.ok) throw new NpError(r.network ? "Нова Пошта не отвечает — ТТН не удалена." : npErrorText(r.body));
  }
  await prisma.$transaction([
    prisma.npShipment.update({ where: { id: sh.id }, data: { active: false, state: "deleted", nextCheckAt: null } }),
    prisma.order.update({
      where: { id: sh.orderId },
      data: {
        ...(sh.order.ttn === sh.ttn ? { ttn: null } : {}),
        ...(sh.payer === "Sender" && sh.cost && sh.order.shopDeliveryCost.equals(sh.cost) ? { shopDeliveryCost: 0 } : {}),
      },
    }),
    prisma.orderHistory.create({ data: { orderId: sh.orderId, text: `ТТН ${sh.ttn} ${sh.manual ? "убрана" : "удалена"} (${who})` } }),
    prisma.auditLog.create({ data: { who, action: "np.ttn.delete", target: sh.orderId, details: json({ ttn: sh.ttn }) } }),
  ]);
}

/** Номер ТТН вручную (создана в кабинете/приложении НП). Статус отслеживается так же, если НП подключена. Пусто — убрать. */
export async function setManualTtn(orderId: string, raw: string, who: string, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const ttn = raw.replace(/[\s-]/g, "");
  if (ttn && !/^\d{10,20}$/.test(ttn)) return { ok: false, error: "Номер ТТН — только цифры (обычно 14, например 20450000000000)." };
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, ttn: true, shipments: { where: { active: true } } } });
  if (!o) return { ok: false, error: "Заказ не найден." };
  if (ttn && o.shipments.some((s) => s.ttn === ttn)) return { ok: true };
  const mode = await npMode();
  await prisma.$transaction(async (tx) => {
    await tx.npShipment.updateMany({ where: { orderId, active: true }, data: { active: false, nextCheckAt: null } });
    if (ttn) {
      await tx.npShipment.create({
        data: { orderId, ttn, manual: true, stub: mode !== "live", state: "created", nextCheckAt: mode === "live" ? now : null, createdBy: who },
      });
    }
    await tx.order.update({ where: { id: orderId }, data: { ttn: ttn || null } });
    await tx.orderHistory.create({ data: { orderId, text: `ТТН: ${ttn || "—"} (вручную, ${who})` } });
  });
  return { ok: true };
}

// ---------- статусы посылок ----------

type TrackInput = { code: string; text: string; scheduled?: Date | null; cost?: number | null };

async function textsFor(lang: "uk" | "ru") {
  return resolveTexts(await loadTextOverrides(), lang);
}

/**
 * Применить статус посылки. Смена состояния (в пути → в отделении → получена / отказ) — строка в истории и последствия:
 * статус заказа («Отправлен», «Выполнен» + автоматические сообщения статуса), сообщение «в отделении», отказ → счётчик
 * отказов клиента, чёрный список, задача и тревога менеджерам. Одновременный повтор не сработает дважды (переход захватывается по старому коду).
 */
export async function applyTrack(shipmentId: string, t: TrackInput, now = new Date()): Promise<boolean> {
  const sh = await prisma.npShipment.findUnique({
    where: { id: shipmentId },
    include: { order: { select: { id: true, no: true, status: true, clientId: true, isTest: true, lang: true, recipientName: true, npWarehouseRef: true, client: { select: { name: true, lang: true } } } } },
  });
  if (!sh) return false;
  const state: NpState = npStateOf(t.code);
  const base = {
    statusCode: t.code, statusText: t.text || null, state, checkedAt: now,
    nextCheckAt: sh.stub || !sh.active ? null : npNextCheck(state, sh.createdAt, now),
    ...(t.scheduled ? { estDate: t.scheduled } : {}),
    ...(t.cost != null && sh.cost == null ? { cost: t.cost } : {}),
  };
  if (sh.statusCode === t.code) {
    await prisma.npShipment.update({ where: { id: sh.id }, data: { checkedAt: now, nextCheckAt: base.nextCheckAt } });
    return false;
  }
  const claim = await prisma.npShipment.updateMany({
    where: { id: sh.id, statusCode: sh.statusCode },
    data: {
      ...base,
      ...(state === "arrived" && !sh.arrivedAt ? { arrivedAt: now } : {}),
      ...(state === "received" && !sh.receivedAt ? { receivedAt: now } : {}),
      ...(state === "refused" && !sh.refusedAt ? { refusedAt: now } : {}),
      ...(state === "deleted" ? { active: false, nextCheckAt: null } : {}),
    },
  });
  if (!claim.count || sh.state === state) return claim.count > 0;

  const o = sh.order;
  await prisma.orderHistory.create({ data: { orderId: o.id, text: `Нова Пошта: ${t.text || NP_STATE_RU[state]} (ТТН ${sh.ttn}${sh.stub ? ", тест" : ""})` } });
  if (!sh.active) return true; // старая посылка заказа — только история
  const s = await loadNpSettings();

  if (state === "deleted") {
    await prisma.order.updateMany({ where: { id: o.id, ttn: sh.ttn }, data: { ttn: null } });
    await notifyManagers(`🗑 ТТН ${sh.ttn} по заказу ${o.no} удалена в Новой Почте.`, o.id).catch(() => undefined);
    return true;
  }

  const target = s.autoStatuses ? autoOrderStatus(state, o.status) : null;
  if (target) {
    const r = await setOrderStatus(o.id, target, WHO);
    if (r.ok) await sendAutoMessages(o.id, target, WHO).catch((e) => console.error("[np] сообщение статуса", e));
  }

  if (state === "arrived" && !sh.arrivedAt && s.arrivedMessage) {
    const lang = (o.lang ?? o.client.lang) === "RU" ? "ru" : "uk";
    const tx = await textsFor(lang);
    const cod = sh.cod.toNumber();
    const text = [
      fillText(tx["np.msg.arrived"] ?? "", { name: firstNameOf(o.recipientName || o.client.name, lang), no: o.no, point: o.npWarehouseRef ?? "", ttn: sh.ttn }),
      cod > 0 ? fillText(tx["np.msg.arrived.due"] ?? "", { sum: moneyUa(cod) }) : "",
    ].filter(Boolean).join(" ");
    await sendOrderMessages(o.id, { customText: text, customTitle: "посылка в отделении" }, WHO).catch((e) => console.error("[np] сообщение «в отделении»", e));
  }

  if (state === "refused" && !sh.refusedAt) {
    let listed = false;
    let count = 0;
    if (!o.isTest) {
      const c = await prisma.client.update({ where: { id: o.clientId }, data: { npRefusals: { increment: 1 } }, select: { npRefusals: true, blacklisted: true } });
      count = c.npRefusals;
      if (!c.blacklisted && shouldBlacklist(c.npRefusals, s.refusalsToBlacklist)) {
        listed = true;
        await prisma.$transaction([
          prisma.client.update({ where: { id: o.clientId }, data: { blacklisted: true, blacklistedAt: now, blacklistNote: `Автоматически: отказов от посылок — ${c.npRefusals} (последний — ${o.no})` } }),
          prisma.clientAudit.create({ data: { clientId: o.clientId, who: WHO, field: "Чёрный список", oldValue: "нет", newValue: `да (отказов: ${c.npRefusals})` } }),
        ]);
      }
    }
    await prisma.task.create({
      data: { title: `📦↩️ Отказ от посылки ${o.no} (ТТН ${sh.ttn}): дождаться возврата, принять товар и поставить «Возврат»`, orderId: o.id, clientId: o.clientId, dueAt: now, who: WHO },
    });
    await notifyManagers(
      [`📦↩️ Отказ от посылки ${o.no}, ТТН ${sh.ttn}: ${t.text || "покупатель не забрал"}.`, count > 1 ? `У покупателя уже ${count} отказ(а).` : "", listed ? "Покупатель добавлен в чёрный список — дальше только полная оплата." : ""].filter(Boolean).join(" "),
      o.id,
    ).catch(() => undefined);
  }
  return true;
}

/** Фоновая задача: спросить НП о посылках, которым пора (до 100 за раз), и напомнить о лежащих в отделении. */
export async function trackShipments(now = new Date()): Promise<number> {
  let changed = 0;
  if ((await npMode()) === "live") {
    const due = await prisma.npShipment.findMany({
      where: { active: true, stub: false, nextCheckAt: { lte: now } }, orderBy: { nextCheckAt: "asc" }, take: 100,
      include: { order: { select: { recipientPhone: true } } },
    });
    if (due.length) {
      const r = await npRequest("TrackingDocument", "getStatusDocuments", { Documents: due.map((d) => ({ DocumentNumber: d.ttn, Phone: d.order.recipientPhone ? npPhone(d.order.recipientPhone) : "" })) }, 20_000);
      if (!r.ok) {
        await prisma.npShipment.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { nextCheckAt: new Date(now.getTime() + 30 * 60_000) } });
      } else {
        const byTtn = new Map(readTracking(r.body).map((x) => [x.ttn, x]));
        for (const d of due) {
          const t = byTtn.get(d.ttn) ?? { code: "3", text: "Номер не знайдено", scheduled: null, cost: null };
          if (await applyTrack(d.id, t, now).catch((e) => (console.error("[np] статус", d.ttn, e), false))) changed++;
        }
      }
    }
  }
  await stuckAlerts(now);
  return changed;
}

/** Посылка лежит в отделении N дней — один раз сообщить менеджерам (покупатель может не забрать). */
async function stuckAlerts(now: Date) {
  const s = await loadNpSettings();
  if (!s.stuckDays) return;
  const rows = await prisma.npShipment.findMany({
    where: { active: true, state: "arrived", stuckAlertAt: null, arrivedAt: { lte: new Date(now.getTime() - s.stuckDays * 86400_000) } },
    include: { order: { select: { id: true, no: true, recipientName: true, recipientPhone: true } } }, take: 20,
  });
  for (const r of rows) {
    if (!isStuck(r.arrivedAt, s.stuckDays, now)) continue;
    const upd = await prisma.npShipment.updateMany({ where: { id: r.id, stuckAlertAt: null }, data: { stuckAlertAt: now } });
    if (!upd.count) continue;
    await notifyManagers(`⏳ Посылка ${r.order.no} (ТТН ${r.ttn}) лежит в отделении ${s.stuckDays}+ дн. — напомните покупателю: ${r.order.recipientName ?? ""} ${r.order.recipientPhone ?? ""}`.trim(), r.order.id).catch(() => undefined);
  }
}

/** Кнопка «Обновить статус» в заказе. */
export async function refreshShipment(shipmentId: string, now = new Date()): Promise<string> {
  const sh = await prisma.npShipment.findUnique({ where: { id: shipmentId }, include: { order: { select: { recipientPhone: true } } } });
  if (!sh) return "Посылка не найдена.";
  if (sh.stub) return "Тестовая ТТН — статус меняется тестовыми кнопками.";
  if ((await npMode()) !== "live") return "Нова Пошта не подключена (нет API-ключа).";
  const r = await npRequest("TrackingDocument", "getStatusDocuments", { Documents: [{ DocumentNumber: sh.ttn, Phone: sh.order.recipientPhone ? npPhone(sh.order.recipientPhone) : "" }] }, 15_000);
  if (!r.ok) throw new NpError(r.network ? "Нова Пошта не отвечает — попробуйте позже." : npErrorText(r.body));
  const t = readTracking(r.body)[0] ?? { code: "3", text: "Номер не знайдено", scheduled: null, cost: null };
  await applyTrack(sh.id, t, now);
  return `Статус: ${t.text || NP_STATE_RU[npStateOf(t.code)]}.`;
}

/** Тестовые кнопки (НП не подключена): «принята», «в отделении», «получена», «отказ». */
export async function stubTrack(shipmentId: string, kind: keyof typeof NP_STUB_CODES, now = new Date()): Promise<boolean> {
  const sh = await prisma.npShipment.findUnique({ where: { id: shipmentId }, select: { stub: true } });
  if (!sh?.stub || !NP_STUB_CODES[kind]) return false;
  return applyTrack(shipmentId, NP_STUB_CODES[kind], now);
}

// ---------- печать ----------

/** Адрес PDF наклейки/накладной у НП (с ключом — только для запроса с сервера). null — нельзя (тестовая или вписанная вручную ТТН). */
export async function npPrintTarget(shipmentId: string, kind: "label" | "document"): Promise<string | null> {
  const sh = await prisma.npShipment.findUnique({ where: { id: shipmentId }, select: { ref: true, stub: true } });
  const key = await secret("novaposhta.apiKey");
  if (!sh?.ref || sh.stub || !key) return null;
  const s = await loadNpSettings();
  return npPrintUrl({ base: process.env.NOVAPOSHTA_PRINT_BASE, kind, format: s.labelFormat, ref: sh.ref, apiKey: key });
}

// ---------- для админки ----------

export const orderShipments = (orderId: string) => prisma.npShipment.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });

/** Доска «Посылки»: активные в работе + последние полученные/отказы (30 дней). */
export async function shipmentsBoard(now = new Date()) {
  const include = { order: { select: { id: true, no: true, status: true, recipientName: true, recipientPhone: true, total: true, isTest: true } } } as const;
  const [live, done] = await Promise.all([
    prisma.npShipment.findMany({ where: { active: true, state: { in: ["created", "transit", "arrived", "unknown"] } }, orderBy: { createdAt: "asc" }, include, take: 300 }),
    prisma.npShipment.findMany({ where: { active: true, state: { in: ["received", "refused"] }, updatedAt: { gte: new Date(now.getTime() - 30 * 86400_000) } }, orderBy: { updatedAt: "desc" }, include, take: 50 }),
  ]);
  return { live, done };
}

/** Отчёт по отказам за период (по дате создания ТТН; тестовые заказы не считаются). */
export async function refusalReport(from: Date, to: Date) {
  const rows = await prisma.npShipment.findMany({
    where: { createdAt: { gte: from, lt: to }, order: { isTest: false }, OR: [{ active: true }, { refusedAt: { not: null } }] },
    include: { order: { select: { id: true, no: true, total: true, recipientName: true, recipientPhone: true, payMode: true, client: { select: { id: true, name: true, phone: true, npRefusals: true, blacklisted: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  const stats = refusalStats(rows);
  const refused = rows.filter((r) => r.state === "refused");
  const lostDelivery = Math.round(refused.reduce((a, r) => a + (r.cost?.toNumber() ?? 0), 0) * 100) / 100;
  const byClient = new Map<string, { client: (typeof refused)[number]["order"]["client"]; count: number }>();
  for (const r of refused) {
    const c = byClient.get(r.order.client.id) ?? { client: r.order.client, count: 0 };
    c.count++;
    byClient.set(r.order.client.id, c);
  }
  return { stats, refused, lostDelivery, repeat: [...byClient.values()].filter((x) => x.count > 1 || x.client.npRefusals > 1).sort((a, b) => b.client.npRefusals - a.client.npRefusals) };
}

// ---------- чёрный список ----------

export async function setBlacklist(clientId: string, on: boolean, note: string, who: string): Promise<void> {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { blacklisted: true, blacklistNote: true } });
  if (!c) return;
  const clean = note.replace(/\s+/g, " ").trim().slice(0, 300) || null;
  if (c.blacklisted === on && (c.blacklistNote ?? null) === clean) return;
  await prisma.$transaction([
    prisma.client.update({ where: { id: clientId }, data: { blacklisted: on, blacklistNote: on ? clean : null, blacklistedAt: on ? (c.blacklisted ? undefined : new Date()) : null } }),
    prisma.clientAudit.create({ data: { clientId, who, field: "Чёрный список", oldValue: c.blacklisted ? `да${c.blacklistNote ? ` (${c.blacklistNote})` : ""}` : "нет", newValue: on ? `да${clean ? ` (${clean})` : ""}` : "нет" } }),
  ]);
}

export const blacklistedClients = () =>
  prisma.client.findMany({ where: { blacklisted: true }, orderBy: { blacklistedAt: "desc" }, select: { id: true, name: true, phone: true, npRefusals: true, blacklistNote: true, blacklistedAt: true }, take: 500 });

