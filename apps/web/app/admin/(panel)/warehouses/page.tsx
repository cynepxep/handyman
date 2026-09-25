// Магазины и склады: у каждой точки — город, адрес, график и «самовывоз здесь». Остатки товара по точкам — в карточке товара.
import Link from "next/link";
import { scheduleText } from "@handyman/core/site";
import { listWarehouses, type WarehouseRow } from "@handyman/db/warehouses";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../import/client-bits";
import { ScheduleFields } from "../schedule-fields";
import { deleteWarehouseAction, saveWarehouseAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WarehousesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("settings.edit");
  const { ok, error } = await searchParams;
  const rows = await listWarehouses();
  const pickups = rows.filter((w) => w.isPickup).length;

  return (
    <>
      <h1>Магазины и склады</h1>
      <p className="adm-lead">
        Каждая точка — магазин или склад со своим остатком товара. Если отмечено «Самовывоз», покупатель при оформлении может выбрать
        её и забрать заказ здесь (видит город, адрес и график). Сколько товара лежит в каждой точке — в карточке товара
        (<Link href="/admin/products?own=1">Товары</Link>). На сайте товар с остатком в любой точке — «В наявності», выше в списках.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      {pickups === 0 && <p className="adm-flash err">Нет ни одной точки самовывоза — покупатели не увидят адрес при выборе «Самовивіз».</p>}

      {rows.map((w) => <WarehouseForm key={w.id} w={w} />)}

      <details className="adm-card" id="new">
        <summary><b>+ Добавить магазин или склад</b></summary>
        <WarehouseForm />
      </details>
    </>
  );
}

function WarehouseForm({ w }: { w?: WarehouseRow }) {
  const idp = w ? `w${w.id}` : "wnew";
  return (
    <form action={saveWarehouseAction} className={w ? "adm-card" : undefined} id={w ? `w-${w.id}` : undefined}>
      <input type="hidden" name="id" value={w?.id ?? ""} />
      {w && (
        <h2 style={{ marginTop: 0 }}>
          {w.name}
          {w.isDefault && <span className="adm-chip" style={{ marginLeft: 8 }}>основной</span>}
          {w.isPickup && <span className="adm-chip ok" style={{ marginLeft: 8 }}>самовывоз</span>}
        </h2>
      )}
      {w && (
        <p className="adm-muted">
          На остатке: {w.stock.products} поз., {w.stock.pieces} шт.
          {w.isPickup && w.schedule ? <> · На сайте: {w.cityUk}, {w.addressUk} · {scheduleText(w.schedule, "uk")}</> : null}
        </p>
      )}
      <div className="adm-grid2">
        <div className="adm-field">
          <label htmlFor={`${idp}-name`}>Название (видите только вы)</label>
          <input id={`${idp}-name`} name="name" className="adm-input wide" defaultValue={w?.name ?? ""} placeholder="Магазин на Богданівській" required />
        </div>
        <div className="adm-field">
          <label htmlFor={`${idp}-sort`}>Порядок (меньше — выше в списке)</label>
          <input id={`${idp}-sort`} name="sort" className="adm-input" inputMode="numeric" defaultValue={String(w?.sort ?? 0)} style={{ width: 100 }} />
        </div>
        <div className="adm-field">
          <label htmlFor={`${idp}-cityUk`}>Місто (українською)</label>
          <input id={`${idp}-cityUk`} name="cityUk" className="adm-input wide" defaultValue={w?.cityUk ?? ""} placeholder="Одеса" />
        </div>
        <div className="adm-field">
          <label htmlFor={`${idp}-cityRu`}>Город (по-русски)</label>
          <input id={`${idp}-cityRu`} name="cityRu" className="adm-input wide" defaultValue={w?.cityRu ?? ""} placeholder="Одесса" />
        </div>
        <div className="adm-field">
          <label htmlFor={`${idp}-addressUk`}>Адреса (українською)</label>
          <input id={`${idp}-addressUk`} name="addressUk" className="adm-input wide" defaultValue={w?.addressUk ?? ""} placeholder="вул. Богданівська, 5" />
        </div>
        <div className="adm-field">
          <label htmlFor={`${idp}-addressRu`}>Адрес (по-русски)</label>
          <input id={`${idp}-addressRu`} name="addressRu" className="adm-input wide" defaultValue={w?.addressRu ?? ""} placeholder="ул. Богдановская, 5" />
        </div>
      </div>
      <label className="adm-check" style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 12px" }}>
        <input type="checkbox" name="isPickup" defaultChecked={w?.isPickup ?? true} />
        <span><b>Самовывоз</b> <span className="adm-muted">— покупатель может забрать заказ здесь</span></span>
      </label>
      <h3>График работы</h3>
      <ScheduleFields value={w?.schedule ?? null} idPrefix={idp} />
      <div className="adm-row" style={{ marginTop: 12 }}>
        <SubmitButton primary pendingText="Сохраняю…">{w ? "Сохранить" : "Добавить"}</SubmitButton>
        {w && !w.isDefault && (
          <SubmitButton formAction={deleteWarehouseAction.bind(null, w.id)} pendingText="Удаляю…">Удалить</SubmitButton>
        )}
      </div>
    </form>
  );
}
