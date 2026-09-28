import { SubmitButton } from "../import/client-bits";

type Supplier = {
  id: string;
  name: string;
  contact: string | null;
  note: string | null;
  feedUrl: string | null;
  defaultBrand: string | null;
  markupPct: number | null;
  active: boolean;
  brands: { id: string }[];
};

/** Форма поставщика: новый (supplier не задан) или правка. Бренды — галочками. */
export function SupplierForm({
  supplier, brands, action,
}: {
  supplier?: Supplier;
  brands: { id: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
}) {
  const mine = new Set(supplier?.brands.map((b) => b.id) ?? []);
  return (
    <form action={action} className="adm-card">
      <input type="hidden" name="id" value={supplier?.id ?? ""} />
      <div className="adm-grid2">
        <div className="adm-field">
          <label htmlFor="s-name">Название</label>
          <input id="s-name" name="name" className="adm-input wide" defaultValue={supplier?.name ?? ""} placeholder="Milwaukee Україна" required />
        </div>
        <div className="adm-field">
          <label htmlFor="s-contact">Контакт (менеджер, телефон — видите только вы)</label>
          <input id="s-contact" name="contact" className="adm-input wide" defaultValue={supplier?.contact ?? ""} />
        </div>
        <div className="adm-field">
          <label htmlFor="s-url">Ссылка на XML-фид (подставляется при загрузке)</label>
          <input id="s-url" name="feedUrl" className="adm-input wide" defaultValue={supplier?.feedUrl ?? ""} placeholder="https://…" />
        </div>
        <div className="adm-field">
          <label htmlFor="s-markup">Наценка к цене фида, % (пусто — цена фида и есть цена на сайте)</label>
          <input id="s-markup" name="markupPct" className="adm-input" inputMode="decimal" defaultValue={supplier?.markupPct ?? ""} style={{ width: 120 }} />
        </div>
        <div className="adm-field">
          <label htmlFor="s-brand">Бренд для товаров, у которых в файле бренд не указан</label>
          <input id="s-brand" name="defaultBrand" className="adm-input" list="s-brand-list" defaultValue={supplier?.defaultBrand ?? ""} placeholder="Milwaukee" />
          <datalist id="s-brand-list">
            {brands.map((b) => <option key={b.id} value={b.name} />)}
          </datalist>
        </div>
        <div className="adm-field">
          <label htmlFor="s-note">Заметка</label>
          <input id="s-note" name="note" className="adm-input wide" defaultValue={supplier?.note ?? ""} />
        </div>
      </div>
      <fieldset className="adm-field" style={{ border: 0, padding: 0 }}>
        <legend><b>Бренды этого поставщика</b> <span className="adm-muted">(при загрузке каталога добавятся сами)</span></legend>
        <div className="adm-row" style={{ gap: 12, marginTop: 6 }}>
          {brands.map((b) => (
            <label key={b.id}>
              <input type="checkbox" name="brandIds" value={b.id} defaultChecked={mine.has(b.id)} /> {b.name}
            </label>
          ))}
          {!brands.length && <span className="adm-muted">Брендов пока нет — добавьте во вкладке «Бренды» или просто загрузите каталог.</span>}
        </div>
      </fieldset>
      {supplier && (
        <div className="adm-field">
          <label><input type="checkbox" name="active" defaultChecked={supplier.active} /> Работаем с ним (выключенный поставщик остаётся в списке, его товары не трогаются)</label>
        </div>
      )}
      <SubmitButton primary pendingText="Сохраняю…">{supplier ? "Сохранить" : "Добавить поставщика"}</SubmitButton>
    </form>
  );
}
