// Нова Пошта в оформлении — нажатиями пальцем, как на телефоне. Если справочник НП не отвечает — тесты пропускаются.
import { expect, test, type Page } from "@playwright/test";

async function openCheckout(page: Page) {
  await page.goto("/catalog/ruchnyy-instrument/vykrutky-bity-shestyhrannyky");
  const sku = await page.locator(".hm-grid [data-action=add-to-cart]").first().getAttribute("data-sku");
  await page.evaluate((s) => { localStorage.setItem("hm.cart", JSON.stringify([{ sku: s, qty: 1 }])); localStorage.removeItem("hm.buyer"); }, sku);
  await page.goto("/checkout");
  await expect(page.locator("form.hm-checkout")).toBeVisible();
  const np = page.locator("input[name=delivery][value=np]");
  if (!(await np.count())) test.skip(true, "Нова Пошта выключена в настройках оформления");
  await np.tap();
}

/** Список городов пришёл? Нет — справочник НП не отвечает, тест пропускаем. */
async function citiesOrSkip(page: Page) {
  try {
    await page.locator("#co-city-list [role=option]").first().waitFor({ timeout: 15_000 });
  } catch {
    test.skip(true, "справочник Новой Почты сейчас не отвечает");
  }
}

test("выбрал город из списка → сразу список відділень, выбор пальцем", async ({ page }) => {
  await openCheckout(page);
  await page.locator("#co-city").tap();
  await page.keyboard.type("Оде", { delay: 100 });
  await citiesOrSkip(page);
  await page.locator("#co-city-list [role=option]").first().tap();
  await expect(page.locator("#co-point")).toBeFocused();
  await expect(page.locator("#co-point-list [role=option]").first()).toBeVisible();
  await page.keyboard.type("12", { delay: 100 });
  const opt = page.locator("#co-point-list [role=option]").first();
  await expect(opt).toContainText("№12");
  await opt.tap();
  await expect(page.locator("#co-point")).toHaveValue(/№12.*: /);
  await expect(page.locator(".hm-combo.is-picked")).toHaveCount(2);
});

test("дописал город и ушёл из поля — город выбирается сам", async ({ page }) => {
  await openCheckout(page);
  await page.locator("#co-city").tap();
  await page.keyboard.type("Київ", { delay: 100 });
  await citiesOrSkip(page);
  await expect(page.locator("#co-city-list [role=option]").first()).toBeVisible();
  await page.locator("#co-first").tap(); // ушёл в другое поле
  await expect(page.locator("#co-city")).toHaveValue(/м\. Київ/);
  await expect(page.locator("#co-point")).toHaveAttribute("role", "combobox");
});

test("экран с клавиатурой (низкий): список помещается над клавиатурой", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 420 });
  await openCheckout(page);
  await page.locator("#co-city").tap();
  await page.keyboard.type("Оде", { delay: 100 });
  await citiesOrSkip(page);
  const list = page.locator("#co-city-list");
  await expect(list.locator("[role=option]").first()).toBeVisible();
  await page.waitForTimeout(800);
  const box = await list.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(420);
});
