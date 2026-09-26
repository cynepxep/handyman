import Link from "next/link";
import { loadSeller } from "@handyman/db/orders";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { saveSellerAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SellerPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("settings.edit");
  const { ok, error } = await searchParams;
  const s = await loadSeller();
  const field = (name: keyof typeof s, label: string, hint?: string) => (
    <div className="adm-field">
      <label htmlFor={`s-${name}`}>{label}</label>
      <input id={`s-${name}`} name={name} className="adm-input wide" defaultValue={s[name]} />
      {hint && <small className="adm-muted">{hint}</small>}
    </div>
  );
  return (
    <>
      <p><Link className="adm-link" href="/admin/orders">← Заказы</Link></p>
      <h1>Реквизиты для счёта</h1>
      <p className="adm-lead">
        Эти данные печатаются в счёте покупателю («🖨 Счёт» в карточке заказа). Пустые поля в счёт не попадают. Впишите данные так, как в выписке ФОП
        или договоре с банком — мы их не проверяем, только формат.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}
      <form action={saveSellerAction} className="adm-card">
        {field("name", "Продавец", "например: ФОП Іваненко Іван Іванович")}
        <div className="adm-grid2">
          {field("code", "Код ЄДРПОУ или ІПН", "8 или 10 цифр")}
          {field("iban", "IBAN", "UA и 27 цифр")}
        </div>
        <div className="adm-grid2">
          {field("bank", "Банк")}
          {field("address", "Адрес (если пусто — из «Контактов» сайта)")}
        </div>
        <div className="adm-field">
          <label htmlFor="s-note">Примечание внизу счёта</label>
          <textarea id="s-note" name="note" className="adm-textarea" rows={2} defaultValue={s.note} maxLength={500} placeholder="например, про НДС — уточните у бухгалтера" />
        </div>
        <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
      </form>
    </>
  );
}
