// «Нова Пошта» (шаг 3.4): посылки в работе, отчёт по отказам, чёрный список, настройки отправителя и посылки.
import Link from "next/link";
import { NP_STATE_RU, formatPhone, periodRange, senderMissing, type NpState } from "@handyman/core/shop";
import { blacklistedClients, loadNpSettings, npMode, npSenderOptions, refusalReport, shipmentsBoard } from "@handyman/db/np-shipments";
import { prisma } from "@handyman/db";
import { requirePermission } from "@/lib/auth";
import { money } from "@/lib/catalog";
import { SubmitButton } from "../import/client-bits";
import { PeriodPicker, Stat } from "../reports/bits";
import { saveNpParcelAction, saveNpPlaceAction, saveNpSenderAction, unblacklistAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { tab?: string; period?: string; from?: string; to?: string; ok?: string; error?: string };
const TABS: Array<[string, string]> = [["board", "Посылки"], ["refusals", "Отказы"], ["blacklist", "Чёрный список"], ["settings", "Настройки"]];
const day = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv", day: "numeric", month: "short" });
const daysAgo = (d: Date | null) => (d ? Math.floor((Date.now() - d.getTime()) / 86400_000) : 0);

export default async function NpPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePermission("orders.view");
  const sp = await searchParams;
  const canSettings = session.permissions.includes("settings.edit");
  const tab = TABS.some(([k]) => k === sp.tab) && (sp.tab !== "settings" || canSettings) ? sp.tab! : "board";
  const mode = await npMode();
  return (
    <>
      <h1>Нова Пошта</h1>
      <p className="adm-lead">
        ТТН создаётся кнопкой в карточке заказа; статусы посылок сайт узнаёт сам (в пути — раз в час) и ставит заказу «Отправлен» / «Выполнен».
        {mode === "stub" && " 🧪 Сейчас ключа НП нет — ТТН тестовые, статусы — тестовыми кнопками в заказе."}
        {mode === "off" && " Ключа НП нет — ТТН вписываются вручную, статусы не отслеживаются."}
      </p>
      <nav className="adm-tabs" aria-label="Раздел">
        {TABS.filter(([k]) => k !== "settings" || canSettings).map(([k, l]) => <Link key={k} href={`/admin/np?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      {sp.error && <p className="adm-flash err" role="alert">{sp.error}</p>}
      {sp.ok && <p className="adm-flash ok">{sp.ok}</p>}
      {tab === "board" && <Board />}
      {tab === "refusals" && <Refusals sp={sp} />}
      {tab === "blacklist" && <Blacklist canEdit={session.permissions.includes("clients.edit")} canClients={session.permissions.includes("clients.view")} />}
      {tab === "settings" && <Settings isOwner={session.roleKey === "owner"} mode={mode} />}
    </>
  );
}

async function Board() {
  const { live, done } = await shipmentsBoard();
  const groups: Array<[string, typeof live]> = [
    ["В отделении — ждут покупателя", live.filter((s) => s.state === "arrived")],
    ["В пути", live.filter((s) => s.state === "transit")],
    ["Созданы, ещё не сданы в НП", live.filter((s) => s.state === "created")],
    ["Номер не найден в НП", live.filter((s) => s.state === "unknown")],
  ];
  return (
    <>
      <div className="adm-grid">
        {groups.map(([l, rows]) => <Stat key={l} value={rows.length} label={l.toLowerCase()} tone={l.startsWith("В отделении") && rows.length ? "warn" : ""} />)}
      </div>
      {groups.filter(([, rows]) => rows.length).map(([l, rows]) => (
        <section key={l} className="adm-card">
          <h2 style={{ marginTop: 0 }}>{l}</h2>
          <ShipTable rows={rows} showDays={l.startsWith("В отделении")} />
        </section>
      ))}
      {!live.length && <p className="adm-muted">Посылок в работе нет.</p>}
      {done.length > 0 && (
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>Получены и отказы за 30 дней</h2>
          <ShipTable rows={done} />
        </section>
      )}
    </>
  );
}

type Row = Awaited<ReturnType<typeof shipmentsBoard>>["live"][number];
function ShipTable({ rows, showDays }: { rows: Row[]; showDays?: boolean }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead><tr><th>Заказ</th><th>ТТН</th><th>Получатель</th><th>Статус НП</th>{showDays && <th className="num">В отделении</th>}</tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td><Link className="adm-link" href={`/admin/orders/${s.order.id}#np`}>{s.order.no}</Link>{s.order.isTest && <span className="adm-chip">тест</span>}</td>
              <td>{s.ttn}{s.stub && <span className="adm-chip">тестовая</span>}</td>
              <td>{s.order.recipientName ?? "—"}{s.order.recipientPhone && <div className="adm-muted">{formatPhone(s.order.recipientPhone)}</div>}</td>
              <td>
                <span className={s.state === "refused" ? "adm-chip bad" : s.state === "received" ? "adm-chip ok" : "adm-chip"}>{NP_STATE_RU[s.state as NpState] ?? s.state}</span>
                {s.statusText && <div className="adm-muted" style={{ fontSize: 13 }}>{s.statusText}</div>}
                {s.estDate && s.state !== "received" && <div className="adm-muted" style={{ fontSize: 13 }}>ориентировочно {day(s.estDate)}</div>}
              </td>
              {showDays && <td className="num">{daysAgo(s.arrivedAt)} дн.</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Refusals({ sp }: { sp: SP }) {
  const p = periodRange({ period: sp.period ?? "30d", from: sp.from, to: sp.to });
  const r = await refusalReport(p.from, p.to);
  return (
    <>
      <PeriodPicker base="/admin/np" p={p} extra={{ tab: "refusals" }} />
      <div className="adm-grid">
        <Stat value={r.stats.total} label="посылок отправлено" />
        <Stat value={r.stats.received} label="получено" tone="ok" />
        <Stat value={r.stats.refused} label="отказов / не забрали" tone={r.stats.refused ? "warn" : ""} />
        <Stat value={`${r.stats.refusedPct}%`} label="доля отказов (от завершённых)" tone={r.stats.refusedPct >= 10 ? "warn" : ""} />
        <Stat value={r.stats.inWork} label="ещё в пути" />
        {r.lostDelivery > 0 && <Stat value={money(r.lostDelivery)} label="стоимость доставки отказов (туда; обратно — примерно столько же)" />}
      </div>
      <p className="adm-muted">По дате создания ТТН; тестовые заказы не считаются. Отказ — покупатель отказался или не забрал посылку со склада НП.</p>
      {r.refused.length > 0 ? (
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>Отказы</h2>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Заказ</th><th>Покупатель</th><th className="num">Сумма</th><th>Когда</th><th>Статус НП</th></tr></thead>
              <tbody>
                {r.refused.map((s) => (
                  <tr key={s.id}>
                    <td><Link className="adm-link" href={`/admin/orders/${s.order.id}#np`}>{s.order.no}</Link></td>
                    <td>
                      {s.order.recipientName ?? s.order.client.name ?? "—"}{s.order.recipientPhone && <div className="adm-muted">{formatPhone(s.order.recipientPhone)}</div>}
                      {s.order.client.blacklisted && <span className="adm-chip bad">чёрный список</span>}
                      {s.order.client.npRefusals > 1 && <span className="adm-chip warn">отказов: {s.order.client.npRefusals}</span>}
                    </td>
                    <td className="num">{money(s.order.total)}</td>
                    <td>{s.refusedAt ? day(s.refusedAt) : "—"}</td>
                    <td className="adm-muted" style={{ fontSize: 13 }}>{s.statusText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : <p className="adm-muted">Отказов за период нет.</p>}
      {r.repeat.length > 0 && (
        <section className="adm-card">
          <h2 style={{ marginTop: 0 }}>Повторные отказы</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {r.repeat.map((x) => (
              <li key={x.client.id}>
                <Link className="adm-link" href={`/admin/clients/${x.client.id}`}>{x.client.name || (x.client.phone ? formatPhone(x.client.phone) : "без имени")}</Link>
                {" "}— всего отказов {x.client.npRefusals}{x.client.blacklisted ? " · в чёрном списке" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function Blacklist({ canEdit, canClients }: { canEdit: boolean; canClients: boolean }) {
  const rows = await blacklistedClients();
  const s = await loadNpSettings();
  return (
    <>
      <p className="adm-lead">
        Покупателям из чёрного списка сайт разрешает только <b>полную оплату</b> (онлайн или на карту) — без оплаты при получении.
        {s.refusalsToBlacklist > 0 ? ` Попадают сюда сами после ${s.refusalsToBlacklist} отказ(а) от посылки` : " Автоматически сюда не попадают (выключено в настройках)"};
        добавить или убрать вручную — в карточке клиента.
      </p>
      {rows.length ? (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Покупатель</th><th className="num">Отказов</th><th>Почему</th><th>С</th>{canEdit && <th></th>}</tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    {canClients ? <Link className="adm-link" href={`/admin/clients/${c.id}`}>{c.name || "без имени"}</Link> : c.name || "без имени"}
                    {c.phone && <div className="adm-muted">{formatPhone(c.phone)}</div>}
                  </td>
                  <td className="num">{c.npRefusals}</td>
                  <td>{c.blacklistNote ?? "—"}</td>
                  <td>{c.blacklistedAt ? day(c.blacklistedAt) : "—"}</td>
                  {canEdit && (
                    <td>
                      <form action={unblacklistAction}>
                        <input type="hidden" name="client" value={c.id} />
                        <SubmitButton pendingText="…">Убрать</SubmitButton>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="adm-muted">Чёрный список пуст.</p>}
    </>
  );
}

async function Settings({ isOwner, mode }: { isOwner: boolean; mode: Awaited<ReturnType<typeof npMode>> }) {
  const s = await loadNpSettings();
  const miss = senderMissing(s);
  const opts = mode === "live" ? await npSenderOptions() : null;
  const auto = await prisma.orderStatusTemplate.findMany({ where: { status: { in: ["SHIPPED", "DONE"] }, autoSend: true }, select: { status: true, titleRu: true } });
  const autoOf = (st: string) => auto.filter((x) => x.status === st).map((x) => `«${x.titleRu}»`).join(", ") || "нет";
  return (
    <>
      <section className="adm-card">
        <h2 style={{ marginTop: 0 }}>Отправитель</h2>
        {miss.length ? <p className="adm-chip warn">для ТТН кнопкой не хватает: {miss.join(", ")}</p> : <p className="adm-chip ok">всё заполнено — ТТН создаются кнопкой</p>}
        <p style={{ margin: "8px 0" }}>
          Сейчас: <b>{s.senderName || "не выбран"}</b>{s.contactName && <>, контакт — {s.contactName}{s.senderPhone ? `, ${formatPhone(s.senderPhone)}` : ""}</>}
        </p>
        {mode !== "live" ? (
          <p className="adm-muted">
            Отправитель и контактное лицо выбираются из вашего кабинета НП — после того как {isOwner ? <Link className="adm-link" href="/admin/integrations">в «Интеграциях»</Link> : "владелец в «Интеграциях»"} будет вписан API-ключ.
          </p>
        ) : opts && !opts.ok ? (
          <p className="adm-flash err">{opts.error}</p>
        ) : opts && opts.ok ? (
          <form action={saveNpSenderAction} className="adm-row">
            <select name="contact" className="adm-select" defaultValue={s.senderRef && s.contactRef ? `${s.senderRef}|${s.contactRef}` : ""} aria-label="Отправитель и контактное лицо" required>
              <option value="" disabled>Отправитель — контактное лицо…</option>
              {opts.senders.map((x) => (
                <optgroup key={x.ref} label={x.name}>
                  {x.contacts.map((c) => <option key={c.ref} value={`${x.ref}|${c.ref}`}>{c.name}{c.phone ? ` (+${c.phone})` : " — нет телефона"}</option>)}
                </optgroup>
              ))}
            </select>
            <SubmitButton pendingText="…">Сохранить</SubmitButton>
          </form>
        ) : null}
        <h3>Откуда отправляем</h3>
        <p style={{ margin: "0 0 8px" }}>{s.cityName ? <>{s.cityName}, {s.warehouseName}</> : <span className="adm-muted">не указано</span>}</p>
        <form action={saveNpPlaceAction} className="adm-row">
          <label htmlFor="np-scity">Город</label>
          <input id="np-scity" name="city" className="adm-input" style={{ width: 170 }} defaultValue={s.cityName.replace(/^м\.\s*/, "").split(",")[0] || "Одеса"} required />
          <label htmlFor="np-snum">Отделение №</label>
          <input id="np-snum" name="number" className="adm-input" style={{ width: 90 }} inputMode="numeric" defaultValue={/\d+/.exec(s.warehouseName)?.[0] ?? ""} required />
          <SubmitButton pendingText="Ищу…">Сохранить</SubmitButton>
        </form>
      </section>

      <form action={saveNpParcelAction} className="adm-card">
        <h2 style={{ marginTop: 0 }}>Посылка по умолчанию и правила</h2>
        <div className="adm-row">
          <label>Вес, кг <input name="weightKg" className="adm-input" style={{ width: 80 }} inputMode="decimal" defaultValue={String(s.weightKg)} required /></label>
          <label>Мест <input name="seats" className="adm-input" style={{ width: 60 }} inputMode="numeric" defaultValue={String(s.seats)} required /></label>
          <span>Коробка, см
            <input name="dimL" className="adm-input" style={{ width: 60 }} inputMode="numeric" aria-label="Длина" placeholder="Д" defaultValue={s.dims?.l ?? ""} />
            <input name="dimW" className="adm-input" style={{ width: 60 }} inputMode="numeric" aria-label="Ширина" placeholder="Ш" defaultValue={s.dims?.w ?? ""} />
            <input name="dimH" className="adm-input" style={{ width: 60 }} inputMode="numeric" aria-label="Высота" placeholder="В" defaultValue={s.dims?.h ?? ""} />
          </span>
        </div>
        <p className="adm-muted" style={{ fontSize: 13 }}>Вес подставляется из характеристик товаров («Вага»), если они есть; иначе — этот. Коробку можно не указывать.</p>
        <div className="adm-row" style={{ marginTop: 8 }}>
          <label style={{ flex: "1 1 260px" }}>Что в посылке <input name="description" className="adm-input" style={{ width: "100%" }} defaultValue={s.description} maxLength={100} required /></label>
        </div>
        <div className="adm-row" style={{ marginTop: 8 }}>
          <label>Оплата при получении{" "}
            <select name="codKind" className="adm-select" defaultValue={s.codKind}>
              <option value="money">наложенный платёж (денежный перевод)</option>
              <option value="control">«Контроль оплати» (нужен договор с НП)</option>
            </select>
          </label>
          <label>Когда доставку платит магазин{" "}
            <select name="senderPayMethod" className="adm-select" defaultValue={s.senderPayMethod}>
              <option value="Cash">наличными при сдаче</option>
              <option value="NonCash">безнал по договору</option>
            </select>
          </label>
          <label>Наклейка{" "}
            <select name="labelFormat" className="adm-select" defaultValue={s.labelFormat}>
              <option value="100x100">100×100 мм (термопринтер)</option>
              <option value="85x85">85×85 мм</option>
              <option value="a4">накладная A4 (обычный принтер)</option>
            </select>
          </label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: "10px 0 0" }}>
          <label className="adm-check"><input type="checkbox" name="autoStatuses" defaultChecked={s.autoStatuses} /> Менять статус заказа по посылке: сдали в НП → «Отправлен», получили → «Выполнен» (+ сообщения статуса с галочкой «автоматически» в «Шаблонах»)</label><br />
          <label className="adm-check"><input type="checkbox" name="arrivedMessage" defaultChecked={s.arrivedMessage} /> Сообщать покупателю в Telegram, что посылка в отделении (текст — «Сайт → Тексты → Доставка»)</label>
        </fieldset>
        <p className="adm-muted" style={{ fontSize: 13 }}>
          Сейчас автоматически уходит покупателю: при «Отправлен» — {autoOf("SHIPPED")}; при «Выполнен» — {autoOf("DONE")}.
          Включить или выключить — галочка «автоматически» в <Link className="adm-link" href="/admin/templates">«Шаблонах»</Link>.
        </p>
        <div className="adm-row" style={{ marginTop: 8 }}>
          <label>Напомнить менеджерам, если посылка лежит в отделении, дней <input name="stuckDays" className="adm-input" style={{ width: 60 }} inputMode="numeric" defaultValue={String(s.stuckDays)} /></label>
          <label>В чёрный список после отказов <input name="refusalsToBlacklist" className="adm-input" style={{ width: 60 }} inputMode="numeric" defaultValue={String(s.refusalsToBlacklist)} /></label>
        </div>
        <p className="adm-muted" style={{ fontSize: 13 }}>0 — не напоминать / не добавлять автоматически. Бесплатная доставка от суммы — в «Сайт → Оформление заказа».</p>
        <SubmitButton pendingText="Сохраняю…">Сохранить</SubmitButton>
      </form>
    </>
  );
}
