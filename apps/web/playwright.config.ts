// Тесты в браузере (шаг 2.8): витрина глазами покупателя на телефоне. Запуск: `pnpm test:e2e` (сайт должен работать или запустится сам).
// Браузер — установленный Google Chrome (ничего не скачивается). Заказы тесты НЕ создают (только проверка ошибок формы).
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
// Шаг 8.4: проверка боевой сборки в Docker — E2E_BASE_URL=https://localhost (у Caddy внутренний сертификат: не ругаться на него).
const ignoreHTTPSErrors = /^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL);
// Браузер: установленный Google Chrome; где его нет (облако) — путь к другому Chrome/Chromium в CHROME_PATH (как для Lighthouse).
const executablePath = process.env.CHROME_PATH?.trim() || undefined;
const channel = executablePath ? undefined : "chrome";

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
    channel,
    launchOptions: { executablePath },
    ignoreHTTPSErrors,
    locale: "uk-UA",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"], channel } }],
  // если сайт не запущен — запустить режим разработки
  webServer: {
    command: "pnpm dev --port 3100",
    url: `${baseURL}/checkout`,
    reuseExistingServer: true,
    ignoreHTTPSErrors,
    timeout: 180_000,
  },
});
