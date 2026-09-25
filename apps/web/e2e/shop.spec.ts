// Витрина на телефоне (Pixel 7, 412 px): главные сценарии покупателя. Данные — настоящий каталог из базы, поэтому проверяем
// устройство страниц, а не конкретные цены. Заказы не создаются.
import { expect, test, type Page } from "@playwright/test";

const SUB = "/catalog/ruchnyy-instrument/vykrutky-bity-shestyhrannyky";

test.beforeEach(async ({ context }) => {
  // «служебная» кука: поиски из тестов не попадают в подсказки для покупателей (logSearchSafely пропускает сотрудников)
  await context.addCookies([{ name: "hm_staff_session", value: "e2e", url: test.info().project.use.baseURL ?? "http://localhost:3100" }]);
});

/** Ошибки в консоли страницы, кроме недоступных фото поставщика (их сайт иногда не отвечает — это не ошибка нашего сайта). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/_next\/image|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll, "страница не должна прокручиваться вбок").toBeLessThanOrEqual(width + 1);
}

test("главная: заголовок, задачи, кнопки батарей читаемы, без прокрутки вбок и ошибок", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  expect(await page.locator(".hm-task, .hm-tasks a").count()).toBeGreaterThanOrEqual(4);
  const battery = page.locator(".hm-battery-btn").first();
  if (await battery.count()) {
    // текст на жёлтой кнопке — тёмный (был баг: почти белый на жёлтом)
    const [color, bg] = await battery.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
    expect(color).not.toBe(bg);
    expect(color).not.toBe("rgb(242, 242, 238)");
  }
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("каталог: все разделы свёрнуты, раскрываются нажатием", async ({ page }) => {
  await page.goto("/catalog");
  const groups = page.locator("details");
  expect(await groups.count()).toBeGreaterThan(3);
  expect(await page.locator("details[open]").count()).toBe(0);
  await groups.first().locator("summary").click();
  await expect(groups.first()).toHaveAttribute("open", "");
});

test("подраздел: порядок как в меню (сначала викрутки), чип «Біти» оставляет только біти", async ({ page }) => {
  await page.goto(SUB);
  await expect(page.locator(".hm-card-title").first()).toContainText(/Викрутк/i);
  const bits = page.locator(".hm-parts a", { hasText: /Біти/ }).first();
  await expect(bits).toBeVisible();
  await bits.click();
  await expect(page).toHaveURL(/part=/);
  await expect(page.locator(".hm-parts .is-on")).toContainText(/Біти/);
  await expect(page.locator(".hm-card-title").first()).toContainText(/Біт/i);
  await noHorizontalScroll(page);
});

test("поиск: подсказки при вводе, Enter — страница результатов", async ({ page }) => {
  await page.goto("/");
  const input = page.locator("input[type=search]").first();
  await input.fill("круг");
  await expect(page.locator(".hm-suggest-item").first()).toBeVisible();
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.locator(".hm-card-title").first()).toBeVisible(); // после загрузки результатов
});

test("корзина: первое «У кошик» — окно, дальше — круглая кнопка с числом; из неё — в оформление", async ({ page }) => {
  await page.goto(SUB);
  await page.evaluate(() => {
    localStorage.removeItem("hm.cart");
    sessionStorage.clear();
  });
  await page.reload();
  const add = page.locator(".hm-grid [data-action=add-to-cart]");
  await add.nth(0).click();
  const drawer = page.locator("dialog.hm-drawer");
  await expect(drawer).toHaveJSProperty("open", true);
  await drawer.locator("button[aria-label]").first().click(); // ✕
  await expect(drawer).toHaveJSProperty("open", false);
  await add.nth(1).click();
  const fab = page.locator(".hm-fab-cart");
  await expect(fab).toBeVisible();
  await expect(fab).toContainText("2");
  await expect(drawer).toHaveJSProperty("open", false);
  await fab.click();
  await expect(drawer).toHaveJSProperty("open", true);
  await drawer.locator("a[href$='/checkout']").click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.locator("form.hm-checkout")).toBeVisible();
});

test("оформление: пустая форма — понятные ошибки у полей, заказ не создаётся", async ({ page }) => {
  await page.goto(SUB);
  const sku = await page.locator(".hm-grid [data-action=add-to-cart]").first().getAttribute("data-sku");
  await page.evaluate((s) => localStorage.setItem("hm.cart", JSON.stringify([{ sku: s, qty: 1 }])), sku);
  await page.goto("/checkout");
  await page.locator("form.hm-checkout button[type=submit]").click();
  await expect(page.locator("form.hm-checkout [aria-invalid=true]").first()).toBeVisible();
  expect(await page.locator("form.hm-checkout .hm-field-error").count()).toBeGreaterThanOrEqual(3);
  await expect(page).toHaveURL(/\/checkout$/);
  await noHorizontalScroll(page);
});

test("оформление: Нова Пошта — город из списка, затем список відділень", async ({ page }) => {
  await page.goto(SUB);
  const sku = await page.locator(".hm-grid [data-action=add-to-cart]").first().getAttribute("data-sku");
  await page.evaluate((s) => {
    localStorage.setItem("hm.cart", JSON.stringify([{ sku: s, qty: 1 }]));
    localStorage.removeItem("hm.buyer");
  }, sku);
  await page.goto("/checkout");
  await expect(page.locator("form.hm-checkout")).toBeVisible(); // форма появляется, когда браузер прочитал корзину
  const np = page.locator("input[name=delivery][value=np]");
  if (!(await np.count())) test.skip(true, "Нова Пошта выключена в настройках оформления");
  await np.check();
  await page.locator("#co-city").fill("Оде");
  const city = page.locator("#co-city-list [role=option]").first();
  try {
    await city.waitFor({ timeout: 15_000 });
  } catch {
    test.skip(true, "справочник Новой Почты сейчас не отвечает");
  }
  await expect(city).toContainText(/Одеса/);
  await city.click();
  await page.locator("#co-point").click();
  await page.locator("#co-point").fill("1");
  await expect(page.locator("#co-point-list [role=option]").first()).toContainText(/№1/);
});

test("товар: заголовок, цена, фото, кнопка «У кошик»", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(SUB);
  await page.locator(".hm-card-title a").first().click();
  await expect(page).toHaveURL(/\/product\//);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator(".hm-price").first()).toBeVisible();
  await expect(page.locator("[data-action=add-to-cart]:visible").first()).toBeVisible(); // на телефоне — закреплённая внизу
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test("русская версия: язык страницы и ссылки остаются в /ru", async ({ page }) => {
  await page.goto("/ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  const href = await page.locator(".hm-logo").getAttribute("href");
  expect(href).toBe("/ru");
});

test("несуществующая страница — понятная 404 с поиском и каталогом", async ({ page }) => {
  const res = await page.goto("/catalog/takogo-nemaye-e2e");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toBeVisible();
});
