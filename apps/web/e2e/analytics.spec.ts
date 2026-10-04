// Аналитика (шаг А1): события в window.dataLayer глазами покупателя на телефоне. Нужна включённая аналитика
// («Интеграции → Аналитика и реклама»: ID контейнера и «Включить»), иначе тесты пропускаются. Скрипт Google Tag Manager
// подменяется пустым (в Google ничего не уходит). Заказы не создаются — покупка проверяется в интеграционных тестах базы.
import { expect, test, type Page } from "@playwright/test";

type Entry = Record<string, unknown> & { event?: string; ecommerce?: { items?: Array<Record<string, unknown>>; value?: number; currency?: string } | null };

test.beforeEach(async ({ context, page }) => {
  // «служебная» кука, как в shop.spec: поиски из тестов не попадают в подсказки. Сессии за ней нет — для сайта это покупатель.
  await context.addCookies([{ name: "hm_staff_session", value: "e2e", url: test.info().project.use.baseURL ?? "http://localhost:3100" }]);
  await page.route("**/gtm.js*", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* GTM в тесте */" }));
});

const dataLayer = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [])) as Entry[]);
const events = async (page: Page, name: string) => (await dataLayer(page)).filter((e) => e.event === name);
async function waitEvent(page: Page, name: string, n = 1): Promise<Entry[]> {
  await expect.poll(async () => (await events(page, name)).length, { message: `событие ${name}` }).toBeGreaterThanOrEqual(n);
  return events(page, name);
}

/** Аналитика включена на этом сайте? (скрипт до загрузки страницы ставит признак) */
async function analyticsOn(page: Page) {
  await page.goto("/search?q=%D0%B4%D1%80%D0%B8%D0%BB%D1%8C");
  return page.evaluate(() => (window as unknown as { __hmA?: number }).__hmA === 1);
}

test("поиск и список: hm_config до gtm.js, search, view_item_list с товарами, select_item по нажатию", async ({ page }) => {
  test.skip(!(await analyticsOn(page)), "аналитика выключена — включите её в «Интеграциях» с любым ID контейнера");
  const dl = await dataLayer(page);
  const cfg = dl.findIndex((e) => e.event === "hm_config");
  const start = dl.findIndex((e) => e.event === "gtm.js");
  expect(cfg).toBeGreaterThanOrEqual(0);
  expect(start).toBeGreaterThan(cfg);
  expect(dl[cfg].channel).toBe("web");
  const [s] = await waitEvent(page, "search");
  expect(s.search_term).toBe("дриль");
  const [list] = await waitEvent(page, "view_item_list");
  const items = list.ecommerce!.items!;
  expect(items.length).toBeGreaterThan(0);
  expect(items.length).toBeLessThanOrEqual(20);
  expect(items[0]).toMatchObject({ item_list_id: "search", quantity: 1 });
  expect(typeof items[0].price).toBe("number");
  // перед e-commerce событием — сброс ecommerce: null
  const all = await dataLayer(page);
  const at = all.findIndex((e) => e.event === "view_item_list");
  expect(all[at - 1]).toEqual({ ecommerce: null });
  const firstSku = String(items[0].item_id);
  await page.locator(`.hm-card[data-sku="${firstSku}"] a[href*="/product/"]`).first().click();
  await expect(page).toHaveURL(/\/product\//);
  const [sel] = await waitEvent(page, "select_item");
  expect(sel.ecommerce!.items![0]).toMatchObject({ item_id: firstSku, item_list_id: "search" });
  // карточка товара: view_item с ценой как на странице
  const [view] = await waitEvent(page, "view_item");
  expect(view.ecommerce!.currency).toBe("UAH");
  expect(view.ecommerce!.items![0].item_id).toBe(firstSku);
  expect(view.ecommerce!.value).toBe(view.ecommerce!.items![0].price);
});

test("корзина и оформление: add_to_cart (цена с сервера), +/−, remove_from_cart, begin_checkout со всей корзиной", async ({ page }) => {
  test.skip(!(await analyticsOn(page)), "аналитика выключена");
  const card = page.locator(".hm-card").first();
  const sku = (await card.getAttribute("data-sku"))!;
  await card.locator('[data-action="add-to-cart"]').click();
  const [add] = await waitEvent(page, "add_to_cart");
  expect(add.ecommerce!.items![0]).toMatchObject({ item_id: sku, quantity: 1 });
  expect(add.ecommerce!.items![0].price as number).toBeGreaterThan(0);
  expect(add.ecommerce!.value).toBe(add.ecommerce!.items![0].price);
  // мини-корзина открылась: «+» — ещё add_to_cart на 1 шт., «−» — remove_from_cart на 1 шт., «✕» — remove_from_cart всего
  const drawer = page.locator("dialog.hm-drawer");
  await expect(drawer).toBeVisible();
  await drawer.locator(".hm-stepper button").last().click();
  await waitEvent(page, "add_to_cart", 2);
  await drawer.locator(".hm-stepper button").first().click();
  const [minus] = await waitEvent(page, "remove_from_cart");
  expect(minus.ecommerce!.items![0]).toMatchObject({ item_id: sku, quantity: 1 });
  // оформление: begin_checkout один раз со всей корзиной
  await page.goto("/checkout");
  const [bc] = await waitEvent(page, "begin_checkout");
  expect(bc.ecommerce!.items!.map((i) => i.item_id)).toEqual([sku]);
  expect(bc.ecommerce!.value).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  expect((await events(page, "begin_checkout")).length).toBe(1);
  // убрать товар из корзины на странице корзины
  await page.goto("/cart");
  await page.locator(".hm-cart-remove").first().click();
  const removed = await waitEvent(page, "remove_from_cart");
  expect(removed.at(-1)!.ecommerce!.items![0]).toMatchObject({ item_id: sku, quantity: 1 });
});

test("обране и контакты: add_to_wishlist при включении сердечка; телефон и Telegram — phone_click / telegram_click", async ({ page }) => {
  test.skip(!(await analyticsOn(page)), "аналитика выключена");
  const card = page.locator(".hm-card").first();
  const sku = (await card.getAttribute("data-sku"))!;
  await card.locator('[data-action="favorite"]').click();
  const [w] = await waitEvent(page, "add_to_wishlist");
  expect(w.ecommerce!.items![0].item_id).toBe(sku);
  await card.locator('[data-action="favorite"]').click(); // выключили — событие не повторяется
  await page.waitForTimeout(500);
  expect((await events(page, "add_to_wishlist")).length).toBe(1);

  // ссылки-контакты: настоящие, если владелец заполнил контакты, иначе — тестовые на странице (переход не нужен)
  await page.evaluate(() => {
    for (const href of ["tel:+380000000000", "https://t.me/handyman_test", "viber://chat?number=%2B380000000000"]) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = href;
      a.addEventListener("click", (e) => e.preventDefault());
      document.querySelector("main")!.appendChild(a);
    }
  });
  await page.locator('main a[href^="tel:+380000000000"]').click();
  const [ph] = await waitEvent(page, "phone_click");
  expect(ph).toMatchObject({ click_location: "page", page_type: "search" });
  await page.locator('main a[href="https://t.me/handyman_test"]').click();
  await page.locator('main a[href^="viber:"]').click();
  const tg = await waitEvent(page, "telegram_click", 2);
  expect(tg.map((e) => e.messenger)).toEqual(["telegram", "viber"]);
});
