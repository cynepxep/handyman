// Черновик страницы «Доставка і оплата» по тому, что уже настроено: способы доставки и оплаты («Сайт → Оформление заказа»),
// адрес и график («Контакты»), сроки (решение владельца: свой склад — быстро, у поставщика — 3–4 дня, под заказ — уточняет менеджер).
// Только факты из настроек, без юридических обещаний. Владелец читает, правит и сохраняет сам. Разметка — как в «Страницах» (## заголовок, - пункт).
import type { CheckoutSettings } from "../shop/checkout-settings";

export type DraftContacts = { addressUk: string; addressRu: string; hoursUk: string; hoursRu: string };

const money = (n: number) => `${Math.round(n).toLocaleString("uk-UA").replace(/ /g, " ")} ₴`;

type Words = {
  deliveryH: string; np: string; npWays: string; pickup: (addr: string, hours: string) => string; courier: string;
  termsH: string; local: string; supplier: string; order: string;
  payH: string; prepay: (sum: string) => string; prepayNone: string; full: string; card: string; fullDisc: (p: number) => string;
  after: string; unknown: string;
};

const UK: Words = {
  deliveryH: "## Доставка",
  np: "**Нова Пошта** — по всій Україні, за тарифами перевізника.",
  npWays: "Можна отримати у відділенні, поштоматі або кур’єром Нової Пошти на адресу.",
  pickup: (a, h) => `**Самовивіз з магазину** — ${a}.${h ? ` Графік: ${h}.` : ""} Зателефонуємо, коли замовлення буде готове.`,
  courier: "**Кур’єр по Одесі** — час і вартість доставки узгодить менеджер.",
  termsH: "## Терміни",
  local: "Товари з позначкою «В наявності в Одесі» — з нашого складу, відправляємо швидко.",
  supplier: "«Відправка за 3–4 дні» — замовляємо у постачальника й одразу відправляємо вам.",
  order: "«Під замовлення» — термін уточнить менеджер після оформлення.",
  payH: "## Оплата",
  prepay: (s) => `**Передплата ${s}** — решту сплачуєте при отриманні.`,
  prepayNone: "**Оплата при отриманні.**",
  full: "**Повна оплата** — посилання на оплату надішле менеджер після підтвердження замовлення.",
  card: "**Оплата за реквізитами** — переказ на рахунок магазину; реквізити покажемо після оформлення, оплату підтверджуємо вручну.",
  fullDisc: (p) => `При повній оплаті — знижка ${p}%.`,
  after: "Після оформлення менеджер зв’яжеться з вами, щоб підтвердити наявність, доставку й оплату.",
  unknown: "адреса уточнюється",
};

const RU: Words = {
  deliveryH: "## Доставка",
  np: "**Новая Почта** — по всей Украине, по тарифам перевозчика.",
  npWays: "Можно получить в отделении, почтомате или курьером Новой Почты на адрес.",
  pickup: (a, h) => `**Самовывоз из магазина** — ${a}.${h ? ` График: ${h}.` : ""} Позвоним, когда заказ будет готов.`,
  courier: "**Курьер по Одессе** — время и стоимость доставки согласует менеджер.",
  termsH: "## Сроки",
  local: "Товары с пометкой «В наличии в Одессе» — с нашего склада, отправляем быстро.",
  supplier: "«Отправка через 3–4 дня» — заказываем у поставщика и сразу отправляем вам.",
  order: "«Под заказ» — срок уточнит менеджер после оформления.",
  payH: "## Оплата",
  prepay: (s) => `**Предоплата ${s}** — остаток оплачиваете при получении.`,
  prepayNone: "**Оплата при получении.**",
  full: "**Полная оплата** — ссылку на оплату пришлёт менеджер после подтверждения заказа.",
  card: "**Оплата по реквизитам** — перевод на счёт магазина; реквизиты покажем после оформления, оплату подтверждаем вручную.",
  fullDisc: (p) => `При полной оплате — скидка ${p}%.`,
  after: "После оформления менеджер свяжется с вами, чтобы подтвердить наличие, доставку и оплату.",
  unknown: "адрес уточняется",
};

function build(w: Words, s: CheckoutSettings, address: string, hours: string): string {
  const out: string[] = [w.deliveryH, ""];
  if (s.delivery.np) out.push(`- ${w.np} ${w.npWays}`);
  if (s.delivery.pickup) out.push(`- ${w.pickup(address.trim() || w.unknown, hours.replace(/\s*\n\s*/g, "; ").trim())}`);
  if (s.delivery.courier) out.push(`- ${w.courier}`);
  out.push("", w.termsH, "", `- ${w.local}`, `- ${w.supplier}`, `- ${w.order}`, "", w.payH, "");
  if (s.pay.prepay) out.push(`- ${s.prepayAmount > 0 ? w.prepay(money(s.prepayAmount)) : w.prepayNone}`);
  if (s.pay.full) out.push(`- ${w.full}`);
  if (s.pay.card) out.push(`- ${w.card}`);
  if (s.fullPayDiscountPct > 0 && (s.pay.full || s.pay.card)) out.push("", w.fullDisc(s.fullPayDiscountPct));
  out.push("", w.after);
  return out.join("\n");
}

/** Черновик на двух языках. */
export function deliveryPageDraft(s: CheckoutSettings, c: DraftContacts): { uk: string; ru: string } {
  return {
    uk: build(UK, s, c.addressUk, c.hoursUk),
    ru: build(RU, s, c.addressRu || c.addressUk, c.hoursRu || c.hoursUk),
  };
}
