import Link from "next/link";
import { loadCheckoutSettings } from "@handyman/db/orders";
import { loadTextOverrides } from "@handyman/db/site-content";
import { defaultTexts, toLang } from "@handyman/core/site";
import { requirePermission } from "@/lib/auth";
import { SubmitButton } from "../../import/client-bits";
import { saveCheckoutAction } from "./actions";

export const dynamic = "force-dynamic";

const PAY = [
  { key: "prepay", label: "Предоплата", hint: "покупатель платит сумму предоплаты, остальное — при получении" },
  { key: "full", label: "Полная оплата на сайте", hint: "пока без онлайн-оплаты: ссылку на оплату присылает менеджер (онлайн-оплата — Этап 3)" },
  { key: "card", label: "Оплата по реквизитам", hint: "перевод на карту/счёт магазина, реквизиты — ниже" },
] as const;
const DELIVERY = [
  { key: "np", label: "Нова Пошта", hint: "отделение или почтомат; город и отделение покупатель выбирает из списка НП (курьера НП оформляет сам в приложении НП)" },
  { key: "pickup", label: "Самовывоз из магазина", hint: "адрес берётся из «Контакты и график»" },
  { key: "courier", label: "Курьер по Одессе", hint: "условия — текст «Доставимо по Одесі…» во вкладке «Тексты»" },
] as const;

export default async function CheckoutSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePermission("settings.edit");
  const { ok, error } = await searchParams;
  const [s, overrides] = await Promise.all([loadCheckoutSettings(), loadTextOverrides()]);
  const req = (lang: "uk" | "ru") =>
    overrides.find((o) => o.key === "checkout.requisites" && toLang(o.lang) === lang)?.value ?? defaultTexts(lang)["checkout.requisites"];

  return (
    <>
      <h1>Оформление заказа</h1>
      <p className="adm-lead">
        Что покупатель видит на странице «Оформлення замовлення»: сумму предоплаты, какие способы доставки и оплаты можно выбрать, реквизиты для
        перевода. Все подписи и пояснения (например, «Кур’єр по Одесі», «Передплата») меняются во вкладке{" "}
        <Link href={`/admin/site/texts?group=${encodeURIComponent("Оформление заказа")}`}>Тексты → «Оформление заказа»</Link>.
      </p>
      {error && <p className="adm-flash err" role="alert">{error}</p>}
      {ok && <p className="adm-flash ok">{ok}</p>}

      <form action={saveCheckoutAction} className="adm-card">
        <h2 style={{ marginTop: 0 }}>Деньги</h2>
        <div className="adm-grid2">
          <div className="adm-field">
            <label htmlFor="prepayAmount">Сумма предоплаты, ₴</label>
            <input id="prepayAmount" name="prepayAmount" className="adm-input" inputMode="decimal" defaultValue={String(s.prepayAmount)} required />
            <span className="adm-muted">Если заказ дешевле — покупатель платит сумму заказа. 0 — без предоплаты (всё при получении).</span>
          </div>
          <div className="adm-field">
            <label htmlFor="fullPayDiscountPct">Скидка за полную оплату, %</label>
            <input id="fullPayDiscountPct" name="fullPayDiscountPct" className="adm-input" inputMode="decimal" defaultValue={String(s.fullPayDiscountPct)} />
            <span className="adm-muted">0 — без скидки (как вы решили). Действует для «полной оплаты» и «по реквизитам».</span>
          </div>
        </div>

        <h2>Способы доставки</h2>
        {DELIVERY.map((d) => (
          <label key={d.key} className="adm-check" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
            <input type="checkbox" name={`delivery.${d.key}`} defaultChecked={s.delivery[d.key]} />
            <span><b>{d.label}</b> <span className="adm-muted">— {d.hint}</span></span>
          </label>
        ))}

        <h2>Способы оплаты</h2>
        {PAY.map((p) => (
          <label key={p.key} className="adm-check" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
            <input type="checkbox" name={`pay.${p.key}`} defaultChecked={s.pay[p.key]} />
            <span><b>{p.label}</b> <span className="adm-muted">— {p.hint}</span></span>
          </label>
        ))}
        <p className="adm-muted">Хотя бы один способ доставки и один способ оплаты должен остаться включённым.</p>

        <h2>Реквизиты для оплаты по реквизитам</h2>
        <p className="adm-muted">
          Покупатель увидит их после заказа, если выбрал «по реквизитам». Впишите номер карты или IBAN и получателя. Пока здесь стандартный текст —
          на сайте написано, что реквизиты пришлёт менеджер.
        </p>
        <div className="adm-grid2">
          <div className="adm-field">
            <label htmlFor="req-uk">Реквізити (українською)</label>
            <textarea id="req-uk" name="requisites.uk" rows={4} className="adm-textarea" defaultValue={req("uk")} />
          </div>
          <div className="adm-field">
            <label htmlFor="req-ru">Реквизиты (по-русски)</label>
            <textarea id="req-ru" name="requisites.ru" rows={4} className="adm-textarea" defaultValue={req("ru")} />
          </div>
        </div>

        <div className="adm-sticky-save">
          <SubmitButton primary pendingText="Сохраняю…">Сохранить</SubmitButton>
        </div>
      </form>
    </>
  );
}
