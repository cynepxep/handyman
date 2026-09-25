// Тесты в браузере (шаг 2.8): витрина глазами покупателя на телефоне. Запуск: `pnpm test:e2e` (сайт должен работать или запустится сам).
// Браузер — установленный Google Chrome (ничего не скачивается). Заказы тесты НЕ создают (только проверка ошибок формы).
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    channel: "chrome",
    locale: "uk-UA",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } }],
  // если сайт не запущен — запустить режим разработки
  webServer: {
    command: "pnpm dev --port 3100",
    url: `${baseURL}/checkout`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
