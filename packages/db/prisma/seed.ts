// Стартовые данные для чистой базы: категории, бренды, роли/права, шаблоны сообщений,
// страницы, склад по умолчанию и учётная запись владельца.
// Соответствует сидированию старого src/db.js — см. docs/MIGRATION-NOTES.md.

import { PrismaClient } from "../generated/client";
import { DEFAULT_ROLES, expandRolePermissions, hashPassword } from "@handyman/core";

const prisma = new PrismaClient();

const CATEGORIES: Array<[string, string, string, number]> = [
  ["ak", "Акумуляторний інструмент", "Аккумуляторный инструмент", 0],
  ["el", "Електроінструмент", "Электроинструмент", 1],
  ["gr", "Садова техніка", "Садовая техника", 2],
  ["hand", "Ручний інструмент", "Ручной инструмент", 3],
  ["acc", "Аксесуари та витратні матеріали", "Аксессуары и расходники", 4],
  ["bld", "Будівельне обладнання", "Строительное оборудование", 5],
  ["pw", "Силова техніка", "Силовая техника", 6],
];

const BRANDS = ["Milwaukee", "DeWalt", "Makita", "Bosch"];

const TEMPLATES: Array<[string, string, string, string, string, boolean]> = [
  ["NEW", "Заказ принят", "Вітаємо, {name}! Замовлення №{no} прийнято. Очікуємо оплату.", "Здравствуйте, {name}! Заказ №{no} принят. Ждём оплату.", "", false],
  ["PAID", "Оплата получена", "Дякуємо, {name}! Оплату замовлення №{no} отримано. Скоро зберемо його.", "Спасибо, {name}! Оплату заказа №{no} получили. Скоро соберём его.", "", true],
  ["PAID", "Напоминание об остатке", "Нагадуємо: залишок суми за замовлення №{no} сплачується при отриманні.", "Напоминаем: остаток суммы за заказ №{no} оплачивается при получении.", "", false],
  ["PACKED", "Заказ собран", "Замовлення №{no} зібрано й чекає відправлення.", "Заказ №{no} собран и ждёт отправки.", "", false],
  ["SHIPPED", "Отправлен + ТТН", "Замовлення №{no} відправлено! ТТН Нової пошти: {ttn}. Відстежити можна в додатку НП.", "Заказ №{no} отправлен! ТТН Новой почты: {ttn}. Отследить можно в приложении НП.", "", false],
  ["SHIPPED", "Курьер выехал (по Одессе)", "Кур'єр вже їде з замовленням №{no}. Будь ласка, тримайте телефон поруч.", "Курьер уже едет с заказом №{no}. Пожалуйста, держите телефон рядом.", "", false],
  ["DONE", "Спасибо за покупку", "Замовлення №{no} доставлено. Дякуємо, що обрали Handyman!", "Заказ №{no} доставлен. Спасибо, что выбрали Handyman!", "", false],
  ["CANCELLED", "Заказ отменён", "Замовлення №{no} скасовано. Якщо це помилка, напишіть нам.", "Заказ №{no} отменён. Если это ошибка, напишите нам.", "", false],
];
// [status, title(для справки), text_uk, text_ru, (не используется), auto]

const PAGES: Array<[string, string, string, string, string, boolean, number, boolean]> = [
  [
    "delivery",
    "Доставка і оплата",
    "Доставка и оплата",
    "Нова пошта: доставка по Україні за тарифом перевізника.\nКур'єр по Одесі: безкоштовно за повної оплати (онлайн на сайті або одразу переказом на картку). При передоплаті доставку кур'єру оплачуєте окремо.\n\nОплата: передплата, повна оплата онлайн або переказ на картку магазину.",
    "Новая почта: доставка по Украине по тарифу перевозчика.\nКурьер по Одессе: бесплатно при полной оплате (онлайн на сайте или сразу переводом на карту). При предоплате доставку курьеру оплачиваете отдельно.\n\nОплата: предоплата, полная оплата онлайн или перевод на карту магазина.",
    true,
    1,
    true,
  ],
  ["offer", "Публічна оферта", "Публичная оферта", "Тут буде текст публічної оферти. Замініть його вашим договором в адмінці (розділ «Сайт»).", "Здесь будет текст публичной оферты. Замените его вашим договором в админке (раздел «Сайт»).", true, 2, false],
  ["about", "Про магазин", "О магазине", "Розкажіть про ваш магазин.", "Расскажите о вашем магазине.", true, 3, false],
  ["contacts", "Контакти", "Контакты", "", "", true, 4, true],
];

async function main() {
  await prisma.category.createMany({
    data: CATEGORIES.map(([id, nameUk, nameRu, sort]) => ({ id, nameUk, nameRu, sort })),
    skipDuplicates: true,
  });

  await prisma.brand.createMany({
    data: BRANDS.map((name, sort) => ({ name, sort })),
    skipDuplicates: true,
  });

  await prisma.warehouse.upsert({
    where: { id: "default" },
    create: { id: "default", name: "Одеса (основний склад)", isDefault: true },
    update: {},
  });

  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      create: { key: role.key, title: role.title, builtin: role.builtin },
      update: { title: role.title },
    });
    const perms = expandRolePermissions(role);
    await prisma.rolePermission.deleteMany({ where: { roleKey: role.key } });
    if (perms.length) {
      await prisma.rolePermission.createMany({
        data: perms.map((permission) => ({ roleKey: role.key, permission })),
        skipDuplicates: true,
      });
    }
  }

  const existingTemplates = await prisma.orderStatusTemplate.count();
  if (existingTemplates === 0) {
    await prisma.orderStatusTemplate.createMany({
      data: TEMPLATES.map(([status, title, textUk, textRu, , autoSend]) => ({
        status: status as any,
        titleUk: title,
        titleRu: title,
        textUk,
        textRu,
        autoSend,
      })),
    });
  }

  for (const [slug, titleUk, titleRu, bodyUk, bodyRu, inMenu, sort, visible] of PAGES) {
    await prisma.page.upsert({
      where: { slug },
      create: { slug, titleUk, titleRu, bodyUk, bodyRu, inMenu, sort, visible },
      update: {},
    });
  }

  const adminToken = process.env.ADMIN_TOKEN;
  const ownerExists = await prisma.staff.findUnique({ where: { username: "owner" } });
  if (!ownerExists) {
    const { salt, hash } = hashPassword(adminToken && adminToken !== "change-me" ? adminToken : "change-me");
    await prisma.staff.create({
      data: {
        username: "owner",
        name: "Владелец",
        roleKey: "owner",
        passwordSalt: salt,
        passwordHash: hash,
      },
    });
    console.log(
      adminToken && adminToken !== "change-me"
        ? "Создана учётная запись owner с паролем из ADMIN_TOKEN."
        : "ВНИМАНИЕ: создана учётная запись owner с паролем по умолчанию (change-me). Впишите свой ADMIN_TOKEN в .env и пересидируйте.",
    );
  }

  console.log("Сидирование завершено.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
