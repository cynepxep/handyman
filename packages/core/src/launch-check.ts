// «Проверка перед запуском» (шаг 8.3): список «готово / не готово» для владельца. Чистая логика без базы: факты собирает
// packages/db/src/launch-check.ts, показывает страница /admin/launch-check (только владелец). Предупреждения при старте сайта
// в production (опасные значения вроде change-me) — `dangerousEnv`, их пишет в журнал ошибок apps/web/instrumentation.ts.

/** ok — готово; fail — исправить до запуска; warn — желательно; info — не подключено, и это допустимо (заглушка). */
export type LaunchStatus = "ok" | "fail" | "warn" | "info";

export type LaunchItem = { id: string; group: string; title: string; status: LaunchStatus; detail: string; fix?: string };

export type LaunchFacts = {
  /** сайт запущен как на сервере (NODE_ENV=production) — тогда «на сервере обязательно» становится «не готово» */
  production: boolean;
  env: {
    ADMIN_TOKEN?: string; SECRETS_KEY?: string; MEILI_MASTER_KEY?: string; PUBLIC_URL?: string; DATABASE_URL?: string; HEALTH_KEY?: string;
    HM_TMP_LOGIN?: string;
  };
  owner: { exists: boolean; defaultPassword: boolean; passwordIsAdminToken: boolean; twoFactor: boolean };
  staff: { require2fa: boolean; activeWithout2fa: number };
  /** временные входы для проверок (учётная запись claude-test, адрес app/api/tmp-claude-login) */
  tmp: { route: boolean; account: boolean };
  backup: { lastOkAt: string | null; checkOk: boolean | null; checkAt: string | null; offsite: boolean };
  integrations: Array<{ id: string; title: string; configured: boolean; check: { ok: boolean; at: string } | null }>;
  openErrors: number;
  /** открыт ли сайт для поисковиков (переключатель владельца на этой же странице, шаг 8.5) */
  indexing: { open: boolean; at: string | null };
};

/** Шаблонные значения из .env.example — на сервере их быть не должно. */
export const isTemplateValue = (v: string | undefined): boolean => {
  const s = (v ?? "").trim().toLowerCase();
  return !s || s.startsWith("change-me");
};

const HOUR = 3600_000;
/** Копия старше — «давно не было» (ночная копия каждые сутки, запас 2 часа). */
export const BACKUP_FRESH_HOURS = 26;
/** Проверка восстановления старше — пора повторить (автоматически — раз в неделю). */
export const BACKUP_CHECK_DAYS = 8;

/** Пароль базы из DATABASE_URL (без логина и адреса) — только чтобы сравнить с шаблонным. */
function dbPassword(url: string | undefined): string {
  const m = /^postgres(?:ql)?:\/\/[^:/@]+:([^@]*)@/i.exec((url ?? "").trim());
  return m ? decodeURIComponent(m[1]) : "";
}

/** Для владельца: «на сервере обязательно» — на ПК это ещё предупреждение, в production — «не готово». */
const serverOnly = (production: boolean): LaunchStatus => (production ? "fail" : "warn");

export function launchChecklist(f: LaunchFacts, now: Date = new Date()): LaunchItem[] {
  const out: LaunchItem[] = [];
  const add = (i: LaunchItem) => out.push(i);
  const S = "Вход и пароли";
  const K = "Ключи и настройки сервера";
  const B = "Резервные копии";
  const I = "Интеграции";
  const E = "Работа сайта";

  // --- вход и пароли
  const token = f.env.ADMIN_TOKEN?.trim() ?? "";
  add({
    id: "admin-token", group: S, title: "Пароль первого входа (ADMIN_TOKEN) заменён",
    status: isTemplateValue(token) ? "fail" : token.length < 12 ? "warn" : "ok",
    detail: isTemplateValue(token) ? "В файле .env стоит шаблон «change-me» или пусто." : token.length < 12 ? "Задан, но короче 12 символов." : "Задан свой.",
    fix: "В .env впишите ADMIN_TOKEN — длинный случайный пароль (от 12 символов). Он нужен только при самом первом запуске на новом сервере.",
  });
  add({
    id: "owner-password", group: S, title: "Пароль владельца (owner) сменён",
    status: !f.owner.exists || f.owner.defaultPassword ? "fail" : f.owner.passwordIsAdminToken ? "warn" : "ok",
    detail: !f.owner.exists ? "Учётной записи owner нет." : f.owner.defaultPassword ? "Пароль owner — «change-me»." : f.owner.passwordIsAdminToken ? "Пароль owner совпадает с ADMIN_TOKEN из .env (не менялся после первого входа)." : "Свой пароль.",
    fix: "«Мой аккаунт» → «Сменить пароль».",
  });
  add({
    id: "owner-2fa", group: S, title: "У владельца включён код из приложения",
    status: f.owner.twoFactor ? "ok" : "fail",
    detail: f.owner.twoFactor ? "Вход владельца — пароль + код из Google Authenticator." : "Вход владельца только по паролю.",
    fix: "«Мой аккаунт» → «Включить код из приложения» (Google Authenticator или аналог).",
  });
  add({
    id: "staff-2fa", group: S, title: "Код из приложения у сотрудников",
    status: f.staff.require2fa || f.staff.activeWithout2fa === 0 ? "ok" : "warn",
    detail: f.staff.require2fa ? "Код обязателен для всех сотрудников." : f.staff.activeWithout2fa === 0 ? "У всех сотрудников код включён." : `Без кода: ${f.staff.activeWithout2fa} сотр.`,
    fix: "«Сотрудники» → «Код из приложения обязателен для всех».",
  });
  const tmpOn = Boolean(f.env.HM_TMP_LOGIN?.trim()) || f.tmp.route || f.tmp.account;
  add({
    id: "tmp-login", group: S, title: "Нет временных входов для проверок",
    status: tmpOn ? "fail" : "ok",
    detail: tmpOn
      ? [f.env.HM_TMP_LOGIN?.trim() && "в .env есть HM_TMP_LOGIN", f.tmp.route && "есть адрес app/api/tmp-claude-login", f.tmp.account && "есть учётная запись claude-test"].filter(Boolean).join("; ") + "."
      : "Временных входов нет.",
    fix: "Удалить HM_TMP_LOGIN из .env, папку app/api/tmp-claude-login и сотрудника claude-test.",
  });

  // --- ключи и настройки сервера
  add({
    id: "node-env", group: K, title: "Сайт запущен в рабочем режиме (production)",
    status: f.production ? "ok" : "warn",
    detail: f.production ? "NODE_ENV=production." : "Сейчас режим разработки (ПК владельца) — на сервере будет production.",
  });
  add({
    id: "secrets-key", group: K, title: "Ключ шифрования задан в SECRETS_KEY",
    status: f.env.SECRETS_KEY?.trim() ? "ok" : serverOnly(f.production),
    detail: f.env.SECRETS_KEY?.trim() ? "Ключи «Интеграций» шифруются ключом из .env." : "Ключ лежит в файле .data/secrets.key (создан сам).",
    fix: "На сервере впишите в .env SECRETS_KEY — тот же ключ, что в файле .data/secrets.key на ПК (иначе ключи «Интеграций» не расшифровать).",
  });
  const meili = f.env.MEILI_MASTER_KEY?.trim() ?? "";
  add({
    id: "search-key", group: K, title: "Ключ поиска (Meilisearch) заменён",
    status: isTemplateValue(meili) || meili.length < 16 ? serverOnly(f.production) : "ok",
    detail: isTemplateValue(meili) ? "MEILI_MASTER_KEY — шаблон «change-me…»." : meili.length < 16 ? "MEILI_MASTER_KEY короче 16 символов." : "Свой ключ.",
    fix: "В .env — MEILI_MASTER_KEY от 16 случайных символов (тот же — в настройке контейнера поиска).",
  });
  const dbPass = dbPassword(f.env.DATABASE_URL);
  add({
    id: "db-password", group: K, title: "Свой пароль базы данных",
    status: !dbPass || dbPass === "handyman" || isTemplateValue(dbPass) ? serverOnly(f.production) : "ok",
    detail: !dbPass || dbPass === "handyman" || isTemplateValue(dbPass) ? "Пароль базы — стандартный из примера." : "Свой пароль.",
    fix: "На сервере — свой пароль базы в .env (DATABASE_URL и пароль контейнера Postgres).",
  });
  const url = f.env.PUBLIC_URL?.trim() ?? "";
  add({
    id: "public-url", group: K, title: "Адрес сайта (PUBLIC_URL) — https",
    status: /^https:\/\/[^/\s]+/i.test(url) ? "ok" : serverOnly(f.production),
    detail: url ? (url.startsWith("https://") ? url : `${url} — не https.`) : "Не задан (домена ещё нет).",
    fix: "После покупки домена: PUBLIC_URL=https://ваш-домен в .env (для оплаты mono, бота, ссылок в сообщениях).",
  });
  add({
    id: "health-key", group: K, title: "Ключ «здоровья» сайта (HEALTH_KEY) для сторожа",
    status: (f.env.HEALTH_KEY?.trim().length ?? 0) >= 16 ? "ok" : "warn",
    detail: (f.env.HEALTH_KEY?.trim().length ?? 0) >= 16 ? "Задан." : "Не задан — подробности /api/health видны только вошедшим.",
    fix: "В .env — HEALTH_KEY (от 16 случайных символов), если внешнему сторожу нужны подробности.",
  });

  // --- резервные копии
  const lastAt = f.backup.lastOkAt ? Date.parse(f.backup.lastOkAt) : NaN;
  const fresh = Number.isFinite(lastAt) && now.getTime() - lastAt <= BACKUP_FRESH_HOURS * HOUR;
  add({
    id: "backup-fresh", group: B, title: "Есть свежая резервная копия",
    status: fresh ? "ok" : "fail",
    detail: !Number.isFinite(lastAt) ? "Копий ещё нет." : fresh ? "Последняя — меньше суток назад." : `Последняя — ${Math.floor((now.getTime() - lastAt) / HOUR)} ч назад.`,
    fix: "«Резервные копии» → «Сделать копию сейчас».",
  });
  const checkAt = f.backup.checkAt ? Date.parse(f.backup.checkAt) : NaN;
  const checkFresh = Number.isFinite(checkAt) && now.getTime() - checkAt <= BACKUP_CHECK_DAYS * 24 * HOUR;
  add({
    id: "backup-check", group: B, title: "Копия восстанавливается (проверено)",
    status: f.backup.checkOk === true && checkFresh ? "ok" : f.backup.checkOk === false ? "fail" : "warn",
    detail: f.backup.checkOk === null ? "Проверки ещё не было." : f.backup.checkOk ? (checkFresh ? "Последняя проверка прошла." : "Проверка прошла, но давно.") : "Последняя проверка не прошла.",
    fix: "«Резервные копии» → «Проверить восстановление».",
  });
  add({
    id: "backup-offsite", group: B, title: "Вторая копия — в облаке",
    status: f.backup.offsite ? "ok" : "warn",
    detail: f.backup.offsite ? "Облачное хранилище подключено." : "Копии только на этом компьютере/сервере.",
    fix: "«Интеграции» → «Резервные копии: второе хранилище».",
  });

  // --- интеграции: подключённые должны пройти «Проверить подключение»
  for (const it of f.integrations) {
    if (it.id === "backup") continue; // выше, в «Резервных копиях»
    const needed = it.id === "telegram"; // без бота менеджеры не узнают о заказах
    const st: LaunchStatus = !it.configured ? (needed ? "warn" : "info") : !it.check ? "warn" : it.check.ok ? "ok" : "fail";
    add({
      id: `integration-${it.id}`, group: I, title: it.title, status: st,
      detail: !it.configured ? (needed ? "Не подключён — сообщения о заказах никуда не уходят." : "Не подключено — работает заглушка.")
        : !it.check ? "Ключи вписаны, но «Проверить подключение» ещё не нажимали." : it.check.ok ? "Подключение проверено." : "Последняя проверка подключения не прошла.",
      fix: "«Интеграции» → «Проверить подключение».",
    });
  }

  // --- работа сайта
  add({
    id: "errors", group: E, title: "Нет открытых ошибок",
    status: f.openErrors === 0 ? "ok" : "warn",
    detail: f.openErrors === 0 ? "В журнале ошибок пусто." : `Открытых ошибок: ${f.openErrors}.`,
    fix: "«Ошибки» — разобрать и закрыть.",
  });
  const idxEarly = f.indexing.open && !(f.production && /^https:\/\//i.test(url));
  add({
    id: "indexing", group: E, title: "Сайт открыт для Google",
    status: !f.indexing.open ? "info" : idxEarly ? "warn" : "ok",
    detail: !f.indexing.open ? "Закрыт от поисковиков — так и должно быть до запуска." : idxEarly ? "Открыт, но сайт ещё не на сервере с https-адресом." : "Открыт: витрину видят поисковики, админка и корзина закрыты.",
    fix: "Открывать в день запуска, когда всё остальное «готово» — кнопка ниже на этой странице.",
  });
  return out;
}

// ---------- открытие сайта для поисковиков (шаг 8.5) ----------

/**
 * Служебные адреса, закрытые от поисковиков и после открытия: админка, стенд дизайна, API, корзина и оформление, «Дякуємо»,
 * кабинет, «Обране», сравнение, поиск. Витрина — укр. без приставки и рус. с /ru.
 */
const SHOP_PRIVATE = ["/cart", "/checkout", "/order/", "/account", "/favorites", "/compare", "/search"];
export const ROBOTS_PRIVATE_PATHS: readonly string[] = [
  "/admin", "/design", "/api/",
  ...SHOP_PRIVATE, ...SHOP_PRIVATE.map((p) => `/ru${p}`),
  // любые адреса с параметрами: фильтры, сортировка, ?ref=, ?k= (у разделов есть canonical без параметров;
  // посадочные страницы из фильтров — Этап 6)
  "/*?",
];

export type RobotsRule = { userAgent: string; allow?: string; disallow: string | string[] };

/** Правила robots.txt: до запуска закрыто всё; после — витрина открыта, служебное закрыто. */
export function robotsRules(open: boolean): RobotsRule[] {
  return open ? [{ userAgent: "*", allow: "/", disallow: [...ROBOTS_PRIVATE_PATHS] }] : [{ userAgent: "*", disallow: "/" }];
}

/** Закрыт ли адрес правилами robots (для проверки и тестов; «*» — любые символы, как у Google). */
export function robotsBlocks(open: boolean, pathWithQuery: string): boolean {
  if (!open) return true;
  return ROBOTS_PRIVATE_PATHS.some((rule) => {
    const re = new RegExp("^" + rule.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
    return re.test(pathWithQuery);
  });
}

export function launchSummary(items: LaunchItem[]): { ok: number; fail: number; warn: number; info: number; ready: boolean } {
  const n = (s: LaunchStatus) => items.filter((i) => i.status === s).length;
  return { ok: n("ok"), fail: n("fail"), warn: n("warn"), info: n("info"), ready: n("fail") === 0 };
}

/**
 * Опасные значения в .env на сервере (production) — сайт не падает, а пишет каждое в журнал ошибок при старте.
 * Возвращает понятные сообщения (без самих значений).
 */
export function dangerousEnv(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  if (isTemplateValue(env.ADMIN_TOKEN)) out.push("ADMIN_TOKEN — шаблон «change-me» или пусто: замените в .env");
  if (isTemplateValue(env.MEILI_MASTER_KEY)) out.push("MEILI_MASTER_KEY — шаблон «change-me…» или пусто: задайте свой ключ поиска");
  if (!env.SECRETS_KEY?.trim()) out.push("SECRETS_KEY не задан: ключ шифрования лежит только в файле .data/secrets.key");
  if (!/^https:\/\//i.test(env.PUBLIC_URL?.trim() ?? "")) out.push("PUBLIC_URL не https: ссылки для оплаты и бота будут неверными");
  if (env.HM_TMP_LOGIN?.trim()) out.push("HM_TMP_LOGIN включён: временный вход для проверок должен быть выключен на сервере");
  const p = dbPassword(env.DATABASE_URL);
  if (p === "handyman" || isTemplateValue(p)) out.push("пароль базы данных — стандартный из примера: задайте свой в DATABASE_URL");
  return out;
}
