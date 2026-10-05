// Выгрузка отчёта в CSV (открывается в Excel двойным щелчком). Деньги — только с правом «Финансы».
import { NextResponse, type NextRequest } from "next/server";
import { ordersReport, productsReport, salesReport } from "@handyman/db/reports";
import { DELIVERY_RU, METRIC_CHANNEL_RU, ORDER_SOURCE_RU, PAY_MODE_RU, periodRange, toCsv } from "@handyman/core/shop";
import { metricsReport } from "@handyman/db/metrics";
import { getStaffSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getStaffSession();
  if (!session || !session.permissions.includes("orders.view")) return new NextResponse("Нет доступа", { status: 403 });
  const fin = session.permissions.includes("finance.view");
  const q = Object.fromEntries(req.nextUrl.searchParams);
  const p = periodRange(q);
  const tab = q.tab === "products" || q.tab === "orders" || q.tab === "sales" ? q.tab : "metrics";
  let csv: string;
  if (tab === "metrics") {
    const m = await metricsReport(p);
    const row = (name: string, cur: number | null, prev: number | null, money = false) => (money && !fin ? null : { name, cur, prev });
    const c = m.cur;
    const v = m.prev;
    const rows = [
      row("Посетители", c.visitors, v.visitors),
      row("Добавили в корзину", c.cart, v.cart),
      row("Начали оформление", c.checkout, v.checkout),
      row("Заказали (сайт, 1 клик, Telegram)", c.online, v.online),
      row("Конверсия, %", c.conversion, v.conversion),
      row("Заказов всего (с звонками)", c.orders, v.orders),
      row("Выкупили, заказов", c.done, v.done),
      row("Выкупили, грн", c.doneSum, v.doneSum, true),
      row("Средний чек, грн", c.avg, v.avg, true),
      row("Валовая прибыль, грн", c.gross, v.gross, true),
      row("Расход на рекламу, грн", c.spend, v.spend, true),
      row("Новых покупателей", c.newClients, v.newClients),
      row("CAC, грн", c.cac, v.cac, true),
      row("Продажи с рекламы, грн", c.adRevenue, v.adRevenue, true),
      row("ROAS", c.roas, v.roas, true),
      row("Повторные покупатели, %", c.repeatShare, v.repeatShare),
      ...(fin ? c.channels.flatMap((r) => [
        row(`${METRIC_CHANNEL_RU[r.channel]}: посетители`, r.visitors, null),
        row(`${METRIC_CHANNEL_RU[r.channel]}: заказали`, r.orders, null),
        row(`${METRIC_CHANNEL_RU[r.channel]}: продажи, грн`, r.revenue, null),
        row(`${METRIC_CHANNEL_RU[r.channel]}: реклама, грн`, r.spend, null),
        row(`${METRIC_CHANNEL_RU[r.channel]}: ROAS`, r.roas, null),
      ]) : []),
    ].filter((r) => r != null);
    csv = toCsv([{ key: "name", title: "Метрика" }, { key: "cur", title: "За период" }, { key: "prev", title: "Прошлый период" }], rows);
  } else if (tab === "sales") {
    const s = await salesReport(p);
    const rows = [
      ...s.days.map((d) => ({ group: "По дням", key: d.day, count: d.orders, sum: d.revenue })),
      ...s.bySource.map((r) => ({ group: "Источник", key: ORDER_SOURCE_RU[r.key] ?? r.key, count: r.count, sum: r.sum })),
      ...s.byPay.map((r) => ({ group: "Оплата", key: PAY_MODE_RU[r.key] ?? r.key, count: r.count, sum: r.sum })),
      ...s.byDelivery.map((r) => ({ group: "Доставка", key: DELIVERY_RU[r.key] ?? r.key, count: r.count, sum: r.sum })),
      ...s.lostByReason.map((r) => ({ group: "Отмены: причина", key: r.key, count: r.count, sum: r.sum })),
    ];
    csv = toCsv([{ key: "group", title: "Раздел" }, { key: "key", title: "Что" }, { key: "count", title: "Заказов" }, ...(fin ? [{ key: "sum", title: "Сумма, грн" }] : [])], rows);
  } else if (tab === "products") {
    const r = await productsReport(p, { top: 1000 });
    csv = toCsv(
      [{ key: "sku", title: "Артикул" }, { key: "name", title: "Товар" }, { key: "qty", title: "Продано, шт" }, { key: "orders", title: "Заказов" }, ...(fin ? [{ key: "revenue", title: "Выручка, грн" }, { key: "cost", title: "Закупка, грн" }] : [])],
      r.byQty,
    );
  } else {
    const r = await ordersReport(p);
    csv = toCsv([{ key: "who", title: "Сотрудник" }, { key: "orders", title: "Заказов обработал" }, { key: "changes", title: "Действий" }], r.byWho);
  }
  const name = `handyman-${tab}-${p.fromYmd}_${p.toYmd}.csv`;
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
