// Блок «Нова Пошта» в карточке заказа (шаг 3.4): отделение получателя (исправить), ТТН кнопкой (вес, места, кто платит доставку,
// наложенный платёж), печать наклейки, статус посылки, удаление, номер вручную; тестовые статусы, пока НП не подключена.
import Link from "next/link";
import { NP_STATE_RU, PAY_MODE_RU, defaultTtnForm, senderMissing, type NpSettings, type NpState } from "@handyman/core/shop";
import type { NpMode } from "@handyman/db/np-shipments";
import { money } from "@/lib/catalog";
import { SubmitButton } from "../../import/client-bits";
import { createTtnAction, deleteTtnAction, manualTtnAction, refreshShipmentAction, setNpPointAction, stubTrackAction } from "../np-actions";
import { CopyButton } from "./status-form";

type Dec = { toNumber(): number };
type Shipment = {
  id: string; ttn: string; ref: string | null; manual: boolean; stub: boolean; active: boolean; payer: string; cost: Dec | null; cod: Dec;
  weight: number | null; seats: number; estDate: Date | null; state: string; statusText: string | null; checkedAt: Date | null; createdBy: string; createdAt: Date;
};
type Order = {
  id: string; delivery: string; status: string; payMode: string; total: Dec; dueNow: Dec; paidAmount: Dec; npFreeShipping: boolean;
  city: string | null; npWarehouseRef: string | null; npCityRef: string | null; npPointRef: string | null; deliveryType: string | null;
  client: { blacklisted: boolean; npRefusals: number; blacklistNote: string | null };
};

const when = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });
const day = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv", day: "numeric", month: "long" });
const chip = (s: string) => (s === "received" ? "adm-chip ok" : s === "refused" || s === "unknown" ? "adm-chip bad" : s === "arrived" ? "adm-chip warn" : "adm-chip");

export function NpBlock({ order: o, shipments, mode, settings, weightKg, canEdit, isOwner, canSettings }: {
  order: Order; shipments: Shipment[]; mode: NpMode; settings: NpSettings; weightKg: number; canEdit: boolean; isOwner: boolean; canSettings: boolean;
}) {
  const active = shipments.find((s) => s.active);
  const old = shipments.filter((s) => !s.active);
  const closed = ["CANCELLED", "RETURNED"].includes(o.status);
  const def = defaultTtnForm({ payMode: o.payMode, total: o.total.toNumber(), dueNow: o.dueNow.toNumber(), paidAmount: o.paidAmount.toNumber(), npFreeShipping: o.npFreeShipping }, settings, weightKg);
  const missing = mode === "live" ? senderMissing(settings) : [];
  const fromList = Boolean(o.npCityRef && o.npPointRef);

  return (
    <section className="adm-card" id="np">
      <h2 style={{ marginTop: 0 }}>Нова Пошта</h2>
      {o.client.blacklisted && (
        <p className="adm-flash err" style={{ margin: "0 0 8px" }}>
          ⛔ Покупатель в чёрном списке{o.client.blacklistNote ? `: ${o.client.blacklistNote}` : ""}. Не отправляйте с оплатой при получении — только после полной оплаты.
        </p>
      )}
      {!o.client.blacklisted && o.client.npRefusals > 0 && <p><span className="adm-chip warn">у покупателя уже был отказ от посылки: {o.client.npRefusals}</span></p>}

      <p style={{ margin: "0 0 6px" }}>
        Получатель: <b>{o.city || "город не указан"}</b>, {o.npWarehouseRef || "отделение не указано"}{" "}
        {fromList ? <span className="adm-chip ok">из справочника НП</span> : <span className="adm-chip warn">написано вручную — для ТТН выберите из справочника</span>}
      </p>
      {canEdit && !closed && (
        <details style={{ marginBottom: 10 }} open={!fromList && mode === "live" && !active}>
          <summary className="adm-link">{fromList ? "Изменить отделение…" : "Указать отделение из справочника…"}</summary>
          <form action={setNpPointAction} className="adm-row" style={{ marginTop: 6 }}>
            <input type="hidden" name="id" value={o.id} />
            <label htmlFor="np-city">Город</label>
            <input id="np-city" name="city" className="adm-input" style={{ width: 170 }} defaultValue={(o.city ?? "").replace(/^м\.\s*/, "").split(",")[0]} required />
            <select name="kind" className="adm-select" defaultValue={o.deliveryType === "postomat" ? "postomat" : "warehouse"} aria-label="Отделение или почтомат">
              <option value="warehouse">отделение №</option>
              <option value="postomat">почтомат №</option>
            </select>
            <input name="number" className="adm-input" style={{ width: 90 }} inputMode="numeric" aria-label="Номер" defaultValue={/\d+/.exec(o.npWarehouseRef ?? "")?.[0] ?? ""} required />
            <SubmitButton pendingText="Ищу…">Сохранить</SubmitButton>
          </form>
        </details>
      )}

      {active ? (
        <div className="adm-np-ttn">
          <div className="adm-row" style={{ alignItems: "baseline" }}>
            <span>ТТН</span> <b style={{ fontSize: 20, letterSpacing: 1 }}>{active.ttn}</b>
            <CopyButton text={active.ttn} />
            <span className={chip(active.state)}>{NP_STATE_RU[active.state as NpState] ?? active.state}</span>
            {active.stub && <span className="adm-chip">тестовая</span>}
            {active.manual && <span className="adm-chip">вписана вручную</span>}
          </div>
          {active.statusText && <p className="adm-muted" style={{ margin: "4px 0 0" }}>НП: {active.statusText}{active.checkedAt ? ` · проверено ${when(active.checkedAt)}` : ""}</p>}
          <p style={{ margin: "4px 0 0" }}>
            {active.estDate && <>Доставка ориентировочно <b>{day(active.estDate)}</b>. </>}
            {active.cost && <>Стоимость доставки {money(active.cost)} — платит {active.payer === "Sender" ? <b>магазин</b> : "получатель"}. </>}
            {active.cod.toNumber() > 0 && <>Наложенный платёж: <b>{money(active.cod)}</b>. </>}
            {active.weight ? <>{active.weight} кг, мест: {active.seats}.</> : null}
          </p>
          <div className="adm-row" style={{ marginTop: 8 }}>
            {!active.manual && active.ref && !active.stub ? (
              <>
                <a className="adm-btn" href={`/admin/orders/${o.id}/np-print?sh=${active.id}&kind=label`} target="_blank" rel="noopener">🖨 Наклейка</a>
                <a className="adm-btn" href={`/admin/orders/${o.id}/np-print?sh=${active.id}&kind=document`} target="_blank" rel="noopener">🖨 Накладная A4</a>
              </>
            ) : (
              <Link className="adm-btn" href={`/admin/orders/${o.id}/print?doc=label`} target="_blank">🖨 Наклейка{active.stub || active.manual ? " (наша)" : ""}</Link>
            )}
            {!active.stub && <a className="adm-link" href={`https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(active.ttn)}`} target="_blank" rel="noopener">Отследить на сайте НП</a>}
            {mode === "live" && !active.stub && (
              <form action={refreshShipmentAction}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="sh" value={active.id} />
                <SubmitButton pendingText="Спрашиваю НП…">Обновить статус</SubmitButton>
              </form>
            )}
          </div>
          {canEdit && active.stub && (
            <div className="adm-row" style={{ marginTop: 8 }}>
              <span className="adm-muted" style={{ fontSize: 13 }}>🧪 Тест (НП не подключена):</span>
              {(["transit", "arrived", "received", "refused"] as const).map((k) => (
                <form key={k} action={stubTrackAction}>
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="sh" value={active.id} />
                  <input type="hidden" name="kind" value={k} />
                  <SubmitButton pendingText="…">{{ transit: "сдана в НП", arrived: "в отделении", received: "получена", refused: "отказ" }[k]}</SubmitButton>
                </form>
              ))}
            </div>
          )}
          {canEdit && (active.state === "created" || active.state === "unknown" || active.stub || active.manual) && (
            <details style={{ marginTop: 8 }}>
              <summary className="adm-link">{active.manual ? "Убрать номер…" : "Удалить ТТН…"}</summary>
              <form action={deleteTtnAction} className="adm-row" style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="sh" value={active.id} />
                <label className="adm-check"><input type="checkbox" required /> {active.manual || active.stub ? "Убрать номер из заказа" : "Удалить накладную в Новой Почте"}</label>
                <SubmitButton pendingText="Удаляю…">Удалить</SubmitButton>
              </form>
            </details>
          )}
          {mode === "live" && !active.stub && <p className="adm-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>Сайт сам спрашивает НП о посылке (в пути — раз в час) и ставит «Отправлен» / «Выполнен».</p>}
        </div>
      ) : o.delivery !== "NOVA_POSHTA" ? (
        <p className="adm-muted">Доставка не Новой Почтой — ТТН не нужна (если всё же отправляете НП, впишите номер ниже).</p>
      ) : closed ? (
        <p className="adm-muted">Заказ закрыт — ТТН не создаётся.</p>
      ) : mode === "off" ? (
        <p className="adm-muted">
          Нова Пошта не подключена: впишите API-ключ в {isOwner ? <Link className="adm-link" href="/admin/integrations">«Интеграциях»</Link> : "«Интеграциях» (владелец)"}.
          Пока создавайте ТТН в кабинете НП и вписывайте номер ниже.
        </p>
      ) : canEdit ? (
        <form action={createTtnAction} className="adm-np-form">
          <input type="hidden" name="id" value={o.id} />
          {mode === "stub" && <p className="adm-muted" style={{ margin: "0 0 8px" }}>🧪 Нова Пошта не подключена — ТТН будет тестовой (в НП не уходит, номер «99…»). На сервере (production) её не будет.</p>}
          {missing.length > 0 && (
            <p className="adm-flash err" style={{ margin: "0 0 8px" }}>
              Чтобы создавать ТТН, заполните {canSettings ? <Link className="adm-link" href="/admin/np?tab=settings">«Нова Пошта → Настройки»</Link> : "«Нова Пошта → Настройки»"}: {missing.join(", ")}.
            </p>
          )}
          <div className="adm-row">
            <label>Вес, кг <input name="weight" className="adm-input" style={{ width: 80 }} inputMode="decimal" defaultValue={String(def.weight)} required /></label>
            <label>Мест <input name="seats" className="adm-input" style={{ width: 60 }} inputMode="numeric" defaultValue={String(def.seats)} required /></label>
            <span>Габариты, см
              <input name="dimL" className="adm-input" style={{ width: 60 }} inputMode="numeric" aria-label="Длина" placeholder="Д" defaultValue={def.dims?.l ?? ""} />
              <input name="dimW" className="adm-input" style={{ width: 60 }} inputMode="numeric" aria-label="Ширина" placeholder="Ш" defaultValue={def.dims?.w ?? ""} />
              <input name="dimH" className="adm-input" style={{ width: 60 }} inputMode="numeric" aria-label="Высота" placeholder="В" defaultValue={def.dims?.h ?? ""} />
            </span>
          </div>
          <div className="adm-row" style={{ marginTop: 8 }}>
            <label>Оценочная стоимость, ₴ <input name="declared" className="adm-input" style={{ width: 100 }} inputMode="decimal" defaultValue={String(def.declared)} required /></label>
            <label>Доставку платит{" "}
              <select name="payer" className="adm-select" defaultValue={def.payer}>
                <option value="Recipient">получатель</option>
                <option value="Sender">магазин</option>
              </select>
            </label>
            <label>Наложенный платёж, ₴ <input name="cod" className="adm-input" style={{ width: 100 }} inputMode="decimal" defaultValue={String(def.cod)} /></label>
          </div>
          <div className="adm-row" style={{ marginTop: 8 }}>
            <label style={{ flex: "1 1 260px" }}>Что в посылке <input name="description" className="adm-input" style={{ width: "100%" }} defaultValue={def.description} maxLength={100} required /></label>
            <SubmitButton pendingText="Создаю ТТН…">Создать ТТН</SubmitButton>
          </div>
          <p className="adm-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {o.npFreeShipping && <>Сумма заказа дошла до бесплатной доставки — доставку платит магазин. </>}
            Оплата: {PAY_MODE_RU[o.payMode] ?? o.payMode}; наложенный платёж — {settings.codKind === "control" ? "«Контроль оплати» (деньги на счёт)" : "денежный перевод"}, при 0 — без него.
            {o.client.blacklisted && def.cod > 0 && <b> Покупатель в чёрном списке — поставьте 0 и возьмите полную оплату заранее.</b>}
          </p>
        </form>
      ) : (
        <p className="adm-muted">ТТН ещё нет.</p>
      )}

      {canEdit && (
        <details style={{ marginTop: 10 }}>
          <summary className="adm-link">{active ? "Вписать другой номер ТТН…" : "Уже создали ТТН в кабинете НП? Вписать номер…"}</summary>
          <form action={manualTtnAction} className="adm-row" style={{ marginTop: 6 }}>
            <input type="hidden" name="id" value={o.id} />
            <label htmlFor="ttn">ТТН</label>
            <input id="ttn" name="ttn" className="adm-input" inputMode="numeric" placeholder="20450000000000" defaultValue={active?.manual ? active.ttn : ""} />
            <SubmitButton pendingText="…">Сохранить</SubmitButton>
          </form>
        </details>
      )}

      {old.length > 0 && (
        <p className="adm-muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
          Прежние ТТН: {old.map((s) => `${s.ttn} (${NP_STATE_RU[s.state as NpState] ?? s.state}, ${when(s.createdAt)})`).join("; ")}
        </p>
      )}
    </section>
  );
}
