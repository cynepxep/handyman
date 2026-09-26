# Handyman — переписывание на новый стек (Next.js + PostgreSQL)

Это **новая версия** магазина электроинструмента Handyman (Одесса), пишется с нуля
по расширенному ТЗ. Старая рабочая версия — в соседней папке `..\handyman`
(Node.js без зависимостей, `node:sqlite`) — **не трогать и не ломать**, она
продолжает работать, пока эта версия не будет готова к переключению.

## Первым делом

1. Прочитай `docs/PLAN-TO-LAUNCH.md` (план и текущий этап), `docs/CHANGELOG.md` (что сделано и **что не проверено**),
   `docs/QUESTIONS-TO-OWNER.md`; по задаче — `docs/CATALOG-IMPORT.md` (каталог), `docs/MIGRATION-NOTES.md` (схема БД), `docs/SITE-CONTENT.md` (раздел «Сайт»).
   Бизнес-логика и история — `..\handyman\docs\00-HANDOFF.md` + `..\handyman\docs\04-BUSINESS-RULES.md` (только на компьютере владельца).
2. ТЗ владельца — `C:\Users\Дима\Desktop\Site\Handyman — ТЗ интернет-магазина.pdf` (этапы 0–8).
3. Перед работой `pnpm test` и `pnpm typecheck` должны быть зелёными. На компьютере владельца сначала `pnpm infra:up`.
   **Облачный чат Claude** (claude.ai/code): всё поднимает `.claude/hooks/session-start.sh` сам — Postgres, Meilisearch, базы, пробный каталог
   (19 товаров из образца фида), `.env` из шаблона. Настоящих данных и ключей там нет.

**Навыки проекта** (`.claude/skills/`) — вызывай, когда задача их касается:
`windows-env` — любые команды на компьютере владельца (Docker, PowerShell, запуск/остановка сайта, диск C:);
`browser-check` — проверка в браузере, вход в админку без пароля, уборка тестовых данных, e2e, Lighthouse;
`db-migration` — любая правка `schema.prisma`.

## Стройка до запуска (с 2026-09-26) — текущий режим работы

Владелец решил достроить сайт по ТЗ целиком: **этапы 4 → 5 → 3 → 6 → 7 → 8**, план с шагами — **`docs/PLAN-TO-LAUNCH.md`** (одобрен один раз).
Не останавливаться на вопросах: неясное — разумный вариант из ТЗ/прототипа + строка в **`docs/QUESTIONS-TO-OWNER.md`**. Правки владельца — **после** прогона
до Этапа 8 (тогда же домен и хостинг). После каждого шага: тесты, проверка в браузере, запись в CHANGELOG, коммит только своих файлов.
Дизайн: витрина — «Мастерская» (жёлтый + графит, шрифты Roboto Condensed + Roboto) + мягкий стиль (`docs/stage2/03-DESIGN-SYSTEM.md`); админка — свой стиль `admin.css`.

Готово: **Этапы 0–2** (основа, каталог, витрина — подробности в CHANGELOG), **Этап 4** целиком, **5.1–5.4**. Где что лежит:
- **4.1** «Клиенты» (`/admin/clients`, уровни скидок `/admin/clients/levels`; `core/src/shop/loyalty.ts`, `db/src/clients.ts`); **4.2** «Шаблоны» (`/admin/templates`) и сообщения покупателю из заказа (`db/src/messages.ts`, `notifyClient`);
- **4.3** фильтры заказов, «Заказ по звонку» (`/admin/orders/new`), причина отмены, печать счёта/комплектовочного листа (`/admin/orders/<id>/print`), реквизиты (`/admin/orders/seller`);
- **4.4** склад (`/admin/stock`: приход, инвентаризация, журнал; `db/src/stock.ts`): резерв под заказ, списание при «Отправлен/Выполнен»;
- **4.5** финансы (`/admin/finance`, право `finance.view` только у владельца; `db/src/finance.ts`); **4.5б** задачи (`/admin/tasks`) и гарантия (`/admin/service`; `db/src/service.ts`);
- **4.6** дашборд `/admin` и «Отчёты» (`/admin/reports`, CSV `/admin/reports/export`; `db/src/reports.ts`);
- **4.7** вход в 2 шага (`db/src/staff.ts`, `core/src/totp.ts`), «Мой аккаунт», «Сотрудники», «Журнал»;
- **4.8** фоновые задачи (`instrumentation.ts` → `lib/worker.ts` → `db/src/jobs.ts`, раз в минуту), «Уведомления» (`/admin/notifications`), меню на телефоне (`nav.tsx`, `group` в `SECTIONS`), `public/admin-manifest.json`;
- **5.1** бот без библиотек (`db/src/bot.ts`, `telegram.ts`; долгий опрос из `lib/worker.ts` с арендой в базе; вебхук `/api/telegram/webhook`), единый клиент по телефону (`linkTelegramPhone`);
- **5.2–5.3** вход покупателя (`db/src/client-auth.ts`, `lib/client-auth.ts`, кука `hm_client`): Telegram, SMS (заглушка в dev, в production без провайдера скрыт), Mini App (`/api/client/miniapp`, `miniapp-bridge.tsx`); кабинет `/account`; `?ref=` → кука `hm_ref` в `proxy.ts`;
- **5.4** скидка уровня и личная скидка в заказе вошедшего покупателя. Дальше — **5.5** (кабинет+) по плану.

## Git (история версий)

- Ветка `main`. Удалённый репозиторий — **приватный на GitHub-аккаунте владельца**. В облачном чате работай в выданной ветке `claude/…`.
- Автор коммитов задан локально в репозитории (`Дима`, почта владельца).
- **Коммить после каждого завершённого шага**, когда `pnpm typecheck` и `pnpm test` зелёные. Сообщение по-русски: что сделано и зачем (1–2 строки). Перед коммитом `git status`: в снимок не должны попадать `.env`, `.data/`, `node_modules/`, `generated/`.
- Перед любой отправкой на GitHub — проверка секретов: `git grep --cached -nEI "(BOT_TOKEN|MONO_TOKEN|KEYCRM_API_KEY|NOVAPOSHTA_KEY|ADMIN_TOKEN)\s*[:=]\s*['\"]?[A-Za-z0-9:_-]{12,}"` (в `.env.example` только шаблоны `change-me`).
- **Отправка (`git push`) — внешнее действие: только по просьбе владельца** (в облачном чате — в свою ветку `claude/…`). Не использовать `--force`, `--no-verify`. Пароли/токены GitHub не просить и не печатать.
- Откат ошибки: `git restore <файл>` (незакоммиченное), `git revert <коммит>` (закоммиченное). Не делай `git reset --hard` без явного согласия.
- **Старый проект `..\handyman` не под git** и содержит реальные данные клиентов (`data/handyman.db`) и `.env`: **никогда не публиковать**.

## Владелец — не программист (важно для общения)

Отвечай **по-русски, простым языком**, термины объясняй; инструкции — **пошагово для Windows**; секреты (`.env`) не читать и не
просить прислать; после изменений — что изменилось, где посмотреть, как проверить.
Владелец часто диктует голосом: опечатки распознавания понимай по смыслу. Всё, что можно проверить самому (тесты, браузер,
база), проверяй сам, а не проси его. Не выдумывай факты о внешних сервисах и юридические тексты: спрашивай или помечай как допущение.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm infra:up` / `infra:down` | Postgres, Redis, Meilisearch в Docker (компьютер владельца) |
| `pnpm db:migrate:dev --name <имя>` | новая миграция после правки `schema.prisma` (+ генерация клиента) — см. навык `db-migration` |
| `pnpm db:seed` | стартовые данные (осторожно: перезаписывает права ролей) |
| `pnpm test` | 243 проверки (core 155 + интеграционные db 88) на базе `handyman_test` и индексе `products_test`. Без Postgres/Meilisearch интеграционные **пропускаются** (`skipped`) |
| `pnpm typecheck` | `tsc` во всех пакетах (у сайта сначала `next typegen`) |
| `pnpm test:e2e` | тесты в браузере (Playwright, телефон 412 px), 13 сценариев витрины; сайт на :3100 должен работать (или запустится сам). Заказы не создают |
| `pnpm --filter web lint`, `pnpm build` | линтер, боевая сборка |
| `pnpm search:reindex` | полная пересборка поискового индекса |

## Стек

Next.js 16 (App Router) — сайт + Telegram Mini App (тот же сайт внутри Telegram) + админка, всё в одном приложении `apps/web`.
PostgreSQL + Prisma — база (`packages/db`). Meilisearch — поиск. `apps/bot` — пустая заглушка (бот живёт в `db/src/bot.ts` и `lib/worker.ts`).
Redis, MinIO — кодом пока не используются.

**Next.js 16** — API отличаются от обучающих данных модели. Перед незнакомым API читай `apps/web/node_modules/next/dist/docs/`. Уже наступали:
- `middleware.ts` → `proxy.ts` (экспорт `proxy`). Proxy **обрезает тело запроса на 10 МБ** без ошибки: в `next.config.ts` заданы
  `experimental.proxyClientMaxBodySize` и `experimental.serverActions.bodySizeLimit` = 60 МБ (загрузка XML-фида).
  Файлы в `public/` с расширением длиннее 8 букв не отдаются (правило `proxy.ts`).
- `params` и `searchParams` в страницах — `Promise` (`await`).
- `redirect()` бросает исключение: не оборачивай его в `try/catch` (см. шаблон `run()` в `import/actions.ts`).
- Глобальный тип `LayoutProps` создаёт `next typegen`; после переноса/удаления страниц удали `apps/web/.next/types` и запусти `next typegen`.
- **Несколько корневых layout**: `app/layout.tsx` нет; корни — `app/[lang]/layout.tsx` (витрина), `app/admin/layout.tsx`, `app/design/layout.tsx`.
  Переход между ними — полная перезагрузка страницы (так и задумано). Незнакомые служебные адреса — `app/global-not-found.tsx`.
- Внутренние ссылки — только `Link` из `next/link`: из-за `app/[lang]/[...rest]` линтер (`no-html-link-for-pages`) считает любой `<a href="/…">` страницей.
- Сборщик стилей (Turbopack/Lightning CSS) не понимает `::highlight()` — такое правило задаётся в компоненте (`<style>`), не в `shop.css`.
- В `fs`/`path` с путями, вычисляемыми при работе, — пометка `/*turbopackIgnore: true*/`, иначе сборка тащит в себя весь проект.
- Пакеты подключаются по подпутям: `@handyman/core/catalog`, `@handyman/db/catalog-import|catalog-products|catalog-search` и т. д.
  (в клиентские компоненты `@handyman/core/catalog` не импортировать: там серверный парсер). Модули с `node:crypto`
  (`core/src/shop/telegram-logic.ts`, `core/src/totp.ts`) **не экспортировать из `@handyman/core/shop`** — его импортирует корзина в браузере;
  у них свои входы (`@handyman/core/telegram`; корень `@handyman/core` в клиенте — только типы).

## Правила разработки

1. **Деньги только на сервере.** Цены/скидки/суммы считает только сервер, клиенту не доверять (логика заказа —
   `..\handyman\docs\04-BUSINESS-RULES.md`, `createOrder` в старом `src/app.js`).
2. **Права доступа**: список — `packages/core/src/permissions.ts` (единственный источник истины; владелец получает все права всегда — `lib/auth.ts`).
   Новое право — сначала здесь, потом сид роли в `packages/db/prisma/seed.ts`, потом `PERMISSION_LABELS_RU`; существующим ролям — миграцией `RolePermission`.
   Каждая админская страница/действие начинается с `requirePermission(...)`. `requireStaff()` при включённом «код обязателен» отправляет
   в `/admin/account` — страницы, доступные без кода, вызывают `requireStaff({ allowWithout2fa: true })`. Суммы в отчётах — только при `finance.view`.
3. **Новая таблица/поле** — навык `db-migration`. Только добавляющие миграции, запись в `docs/MIGRATION-NOTES.md`.
4. **Каталог**: чистая логика (разбор, категории, планировщик, фильтры) — `packages/core/src/catalog/` и тесты рядом без базы;
   запись в базу и поиск — `packages/db/src/catalog-*.ts`; страницы админки только вызывают их. Новое правило импорта — сначала
   тест на образце `packages/core/test/fixtures/vitals-sample.xml` (25 настоящих товаров), затем код, затем обнови `docs/CATALOG-IMPORT.md`.
   Новый фильтр — запись в `FACET_DEFS`, затем `pnpm search:reindex`. Файлы фидов — `apps/web/.data/feeds` (в `.gitignore`), хранятся последние 3.
5. Малые шаги: после каждой правки — `pnpm typecheck`, тесты; для страниц — проверка в браузере. Не «подгоняй» падающий тест, пойми причину.
6. Без новых зависимостей без явной необходимости (единственная добавленная — `fast-xml-parser` в `packages/core`).
7. Внешние сервисы (KeyCRM, mono, Новая почта, Telegram) закрыты своими модулями; без ключей — режим-заглушка; в тестах — локальные моки
   (Нова Пошта — `setNovaPoshtaFetch`). Старый прототип на том же боте одновременно не запускать (409).
8. Тестовые заказы (`is_test`) не уходят в KeyCRM и не влияют на статистику.
9. Сообщения об ошибках для пользователя — понятные, на языке интерфейса (админка — русский; тексты витрины — украинский по умолчанию + русский).
10. После значимых изменений обнови `docs/CHANGELOG.md` (что сделано, что проверено, **что не проверено**).

## Правила витрины (`app/[lang]`, `components/shop/`)

- **Ни одной строки текста в коде** — только ключ из реестра `packages/core/src/site/texts.ts` (новый ключ → `NEW_TEXTS`); контакты и меню —
  из `getShopContent(lang)` (`apps/web/lib/shop/content.ts`). Клиентским компонентам — тексты через `pickTexts`.
- Ссылки — только `shopHref(lang, paths.xxx())` (`packages/core/src/site/routes.ts`); фильтры в адресе — `packages/core/src/site/listing.ts`.
- Новые компоненты — в `components/shop/` на токенах `shop.css`. Стенд дизайн-системы — `/design` (закрыт от поиска).
- Системная категория `unsorted` («Нераспределённые») покупателям не показывается. Русского контента у товаров пока нет.
- **Наличие**: «доступно» = onHand − reserved — везде, где покупателю показывается наличие, считать через `availableQty` (не суммировать `onHand`).
- **Кэш витрины**: новое действие админки, после которого что-то меняется на сайте, обязано вызвать `shopChanged()` (контент) или
  `catalogChanged()` (товары/категории) из `@/lib/shop/cache` — иначе изменения видны только через 5–60 минут. В `cached()` результат хранится как JSON:
  без `Map`/`Date`/`Decimal`. Цены и наличие не кэшировать. Ключ кэша контента — с версией реестра текстов.
  `export const dynamic = "force-dynamic"` в `app/[lang]/layout.tsx` (свежие цены после импорта).
- **Фото товаров** — свои копии в `MEDIA_DIR` (`packages/db/src/media.ts`): везде, где читаются фото, брать `pickImage(img, await photoStyleOn())`
  (`@handyman/db/photo-choice`): стиль → своя копия → поставщик. `next/image` — с `unoptimized={!optimizable(src)}` (`lib/image-hosts.ts`),
  иначе фото с незнакомого сайта ломает страницу.

## Карта репозитория

- `apps/web` — сайт + Mini App + админка + API (Next.js, App Router).
  - `app/admin/login` — вход; `app/admin/(panel)/` — всё остальное под общим меню (`layout.tsx`, `admin.css`, `nav.tsx`):
    `page.tsx` (дашборд), `orders/`, `clients/`, `templates/`, `stock/`, `warehouses/`, `finance/`, `tasks/`, `service/`, `reports/`, `notifications/`,
    `account/` (Мой аккаунт), `staff/`, `audit/` (журнал), `banners/`, `media/` (фото товаров),
    `import/` (`page`, `views`, `actions`, `client-bits`), `products/`, `categories/`, `roles/`, `site/` (`home`, `texts`, `contacts`, `pages`, `menu`, `checkout`; вкладки `tabs.tsx`).
  - `app/[lang]/` — **витрина** (укр. без приставки, рус. `/ru`): `layout.tsx` (шапка, подвал, нижняя панель), `page.tsx` (главная), `catalog/` (+`[group]/`,
    `[group]/[sub]/`), `task/[slug]/`, `product/[sku]/[[...slug]]/`, `search/`, `info/[slug]/`, `cart/`, `checkout/`, `order/[no]/` («Дякуємо»), `account/`,
    `listing-actions.ts`, `cart-actions.ts` (цены корзины, заказ, «1 клік»), `text-edit-actions.ts`, `not-found.tsx`, `error.tsx`, `[...rest]/` (→ 404).
    `proxy.ts` — языки, вход в админку, куки.
  - `components/shop/` — дизайн-система витрины: `shop.css` (токены), `ui.tsx`, `product-card.tsx` (подписи — `cardLabels(t)`), `tiles.tsx`, `site-chrome.tsx`,
    `listing.tsx` + `listing-client.tsx`, `cart/` (`store`, `cart-context`, `cart-view`, `cart-buttons`, `checkout-form`, `phone-input`), `text-editor.tsx`,
    `gallery.tsx`, `search-box.tsx`, `viewed.tsx`, `client-bits.tsx`, `icons.tsx`, `format.ts`.
    `lib/shop/` — данные витрины (`content.ts`, `catalog.ts`, `listing.ts`, `product.ts`, `cache.ts`, `search-hints.ts`).
  - `app/design/` — стенд дизайн-системы; `app/api/catalog/search|suggest` — публичный поиск; `app/api/telegram/webhook`; `app/api/client/miniapp`.
  - `lib/auth.ts`, `lib/client-auth.ts`, `lib/catalog.ts`, `lib/worker.ts`, `instrumentation.ts`, `next.config.ts`; `e2e/` — тесты в браузере.
- `packages/core` — чистая логика без базы: права, авторизация, `totp.ts`; `src/catalog/` (фид, категории, планировщик, фильтры, меню витрины `storefront-menu.ts`);
  `src/site/` (тексты, контакты, адреса, главная, график); `src/shop/` (наличие, оформление, расчёт заказа, уровни скидок, Telegram-логика); `test/`.
- `packages/db` — Prisma-схема, сид, клиент; `src/*.ts` — работа с базой по разделам (каталог, заказы, клиенты, склад, финансы, отчёты, сотрудники,
  задачи, бот, вход покупателя, Нова Пошта, фото); `test/` (интеграционные); `scripts/` (`reindex.ts`, `demo-catalog.ts` — пробный каталог для облака).
- `.claude/` — `hooks/session-start.sh` (запуск облачного чата), `skills/` (навыки проекта), `settings.json`.
- `docker-compose.yml` — Postgres/Redis/Meilisearch (+ профиль `full`: web/bot, не проверялся).
- `docs/` — `PLAN-TO-LAUNCH.md`, `CHANGELOG.md`, `QUESTIONS-TO-OWNER.md`, `CATALOG-IMPORT.md`, `MIGRATION-NOTES.md`, `SITE-CONTENT.md`, `stage2/` (пакет дизайна Этапа 2).
