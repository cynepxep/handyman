// Шаблоны сообщений покупателю по статусам заказа (укр./рус.) — чистая логика без базы.
// Тексты по умолчанию — из прототипа (`..\handyman\src\db.js`, TEMPLATES) + новые статусы ТЗ (черновики, владелец правит в админке).

export type TemplateStatus = "NEW" | "NO_ANSWER" | "AWAITING_SUPPLIER" | "PAID" | "PACKED" | "SHIPPED" | "DONE" | "CANCELLED" | "RETURNED";

export type TemplateSeed = { status: TemplateStatus; titleRu: string; titleUk: string; textUk: string; textRu: string; autoSend: boolean };

/** Подстановки в тексте шаблона. */
export const TEMPLATE_VARS: Array<{ key: string; ru: string }> = [
  { key: "{name}", ru: "имя покупателя (без фамилии)" },
  { key: "{no}", ru: "номер заказа, например HM-1024" },
  { key: "{ttn}", ru: "номер накладной Новой Почты (ТТН)" },
  { key: "{sum}", ru: "сумма заказа, например 1 250 ₴" },
  { key: "{due}", ru: "сколько оплатить при получении" },
];

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  { status: "NEW", titleRu: "Заказ принят", titleUk: "Замовлення прийнято", textUk: "Вітаємо, {name}! Замовлення №{no} прийнято. Очікуємо оплату.", textRu: "Здравствуйте, {name}! Заказ №{no} принят. Ждём оплату.", autoSend: false },
  { status: "NO_ANSWER", titleRu: "Не дозвонились", titleUk: "Не додзвонилися", textUk: "{name}, не змогли до вас додзвонитися щодо замовлення №{no}. Передзвоніть нам, будь ласка, або напишіть сюди.", textRu: "{name}, не смогли до вас дозвониться по заказу №{no}. Перезвоните нам, пожалуйста, или напишите сюда.", autoSend: false },
  { status: "AWAITING_SUPPLIER", titleRu: "Ждём товар от поставщика", titleUk: "Чекаємо товар від постачальника", textUk: "Замовлення №{no}: чекаємо товар від постачальника, зазвичай це 1–3 дні. Щойно отримаємо — відправимо й напишемо вам.", textRu: "Заказ №{no}: ждём товар от поставщика, обычно это 1–3 дня. Как только получим — отправим и напишем вам.", autoSend: false },
  { status: "PAID", titleRu: "Оплата получена", titleUk: "Оплату отримано", textUk: "Дякуємо, {name}! Оплату замовлення №{no} отримано. Скоро зберемо його.", textRu: "Спасибо, {name}! Оплату заказа №{no} получили. Скоро соберём его.", autoSend: true },
  { status: "PAID", titleRu: "Напоминание об остатке", titleUk: "Нагадування про залишок", textUk: "Нагадуємо: залишок суми за замовлення №{no} ({due}) сплачується при отриманні.", textRu: "Напоминаем: остаток суммы за заказ №{no} ({due}) оплачивается при получении.", autoSend: false },
  { status: "PACKED", titleRu: "Заказ собран", titleUk: "Замовлення зібрано", textUk: "Замовлення №{no} зібрано й чекає відправлення.", textRu: "Заказ №{no} собран и ждёт отправки.", autoSend: false },
  { status: "SHIPPED", titleRu: "Отправлен + ТТН", titleUk: "Відправлено + ТТН", textUk: "Замовлення №{no} відправлено! ТТН Нової пошти: {ttn}. Відстежити можна в додатку НП.", textRu: "Заказ №{no} отправлен! ТТН Новой почты: {ttn}. Отследить можно в приложении НП.", autoSend: false },
  { status: "SHIPPED", titleRu: "Курьер выехал (по Одессе)", titleUk: "Кур’єр виїхав (по Одесі)", textUk: "Кур’єр вже їде з замовленням №{no}. Будь ласка, тримайте телефон поруч.", textRu: "Курьер уже едет с заказом №{no}. Пожалуйста, держите телефон рядом.", autoSend: false },
  { status: "DONE", titleRu: "Спасибо за покупку", titleUk: "Дякуємо за покупку", textUk: "Замовлення №{no} доставлено. Дякуємо, що обрали Handyman!", textRu: "Заказ №{no} доставлен. Спасибо, что выбрали Handyman!", autoSend: false },
  { status: "CANCELLED", titleRu: "Заказ отменён", titleUk: "Замовлення скасовано", textUk: "Замовлення №{no} скасовано. Якщо це помилка, напишіть нам.", textRu: "Заказ №{no} отменён. Если это ошибка, напишите нам.", autoSend: false },
  { status: "RETURNED", titleRu: "Возврат оформлен", titleUk: "Повернення оформлено", textUk: "Повернення за замовленням №{no} оформлено. Гроші повернемо тим самим способом, яким ви платили.", textRu: "Возврат по заказу №{no} оформлен. Деньги вернём тем же способом, которым вы платили.", autoSend: false },
];

/**
 * Имя для обращения: в заказе хранится «Прізвище Ім'я» (оформление) или то, что человек написал сам («1 клік»).
 * Из двух и более слов берём второе (имя после фамилии), из одного — его же; пусто — «друже»/«друг».
 */
export function firstNameOf(full: string | null | undefined, lang: "uk" | "ru"): string {
  const words = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  return words[1] ?? words[0] ?? (lang === "ru" ? "друг" : "друже");
}

const moneyUa = (n: number) => `${n.toLocaleString("uk-UA", { maximumFractionDigits: 2 }).replace(/ /g, " ")} ₴`;

export type TemplateVars = { name: string; no: string; ttn?: string | null; sum: number; due: number };

/** Подставить значения в текст. Неизвестные {…} остаются как есть — их видно в предпросмотре. */
export function renderTemplate(text: string, v: TemplateVars): string {
  return text
    .replaceAll("{name}", v.name)
    .replaceAll("{no}", v.no)
    .replaceAll("{ttn}", v.ttn?.trim() || "—")
    .replaceAll("{sum}", moneyUa(v.sum))
    .replaceAll("{due}", moneyUa(Math.max(0, v.due)));
}

/** Подстановки, которых нет в списке (опечатки вроде {nmae}) — чтобы предупредить в админке. */
export function unknownVars(text: string): string[] {
  const known = new Set(TEMPLATE_VARS.map((x) => x.key));
  return [...new Set(text.match(/\{[^{}\s]{1,20}\}/g) ?? [])].filter((k) => !known.has(k));
}

export type TemplateForm = { status: TemplateStatus; titleRu: string; titleUk: string; textUk: string; textRu: string; autoSend: boolean };

export function validateTemplateForm(raw: Record<string, unknown>, statuses: readonly string[]): { ok: true; value: TemplateForm } | { ok: false; error: string } {
  const s = (k: string, max: number) => String(raw[k] ?? "").trim().slice(0, max);
  const status = s("status", 40);
  if (!statuses.includes(status)) return { ok: false, error: "Выберите статус заказа." };
  const titleRu = s("titleRu", 80);
  if (!titleRu) return { ok: false, error: "Укажите название шаблона (его видят только сотрудники)." };
  const textUk = s("textUk", 1500);
  const textRu = s("textRu", 1500);
  if (!textUk || !textRu) return { ok: false, error: "Нужен текст на обоих языках: покупатель получает сообщение на языке сайта, где оформил заказ." };
  const bad = unknownVars(`${textUk} ${textRu}`);
  if (bad.length) return { ok: false, error: `Неизвестная подстановка ${bad.join(", ")}. Можно: ${TEMPLATE_VARS.map((x) => x.key).join(" ")}.` };
  return { ok: true, value: { status: status as TemplateStatus, titleRu, titleUk: s("titleUk", 80) || titleRu, textUk, textRu, autoSend: raw.autoSend === "on" || raw.autoSend === true } };
}
