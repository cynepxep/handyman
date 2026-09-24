# Соответствие старой схемы (SQLite) и новой (PostgreSQL/Prisma)

Старый проект: `../handyman` (Node.js без зависимостей, `node:sqlite`, два HTML-файла).
Новый: этот репозиторий (Next.js + PostgreSQL/Prisma), переписывается по этапам —
план и прогресс см. `docs/09-ROADMAP.md` в старом проекте и файл плана Этапа 0
(`C:\Users\Дима\.claude\plans\inherited-wibbling-teacup.md` на момент написания).

Старый проект **не трогается и продолжает работать**, пока новый не будет готов
к переключению (свой сервер, свои данные — скопированная копия `data/handyman.db`
использовалась только для проверки количества данных, миграция самих данных ещё
не выполнялась, см. ниже).

## Таблица соответствия

| Старое (SQLite, `src/db.js`) | Новое (Prisma, `packages/db/prisma/schema.prisma`) | Что изменилось |
|---|---|---|
| `categories` | `Category` | добавлено дерево подкатегорий (`parentId`) вместо текстового поля `products.sub` |
| `products` | `Product` + `ProductAttribute` + `ProductImage` + `ProductFieldLock` | `params`/`pictures`/`locked` (JSON-массивы) стали отдельными таблицами; `vendor` (текст) стал связью `brandId` |
| `feed_map` | `FeedCategoryMap` | без изменений по смыслу |
| `clients` | `Client` | **`phone` — основной идентификатор** (раньше это был `tg_id`); добавлено поле `tier` |
| `orders` | `Order` | добавлены статусы `NO_ANSWER`/`AWAITING_SUPPLIER`/`RETURNED`; номер `HM-####` теперь строится из поля `seq` (autoincrement) |
| `order_items` | `OrderItem` | без изменений по смыслу — `unitPrice` по-прежнему цена со скидкой, снимок на момент заказа |
| `order_history` | `OrderHistory` | без изменений |
| `recs` | `Recommendation` | без изменений |
| `templates` | `OrderStatusTemplate` | без изменений |
| `outbox` | `Outbox` | без изменений |
| `pending_notifs` | `PendingNotif` | без изменений |
| `sync_queue` | `SyncQueueJob` | на Этапе 0 — таблица; ожидается замена на очередь в Redis/BullMQ на этапе интеграций |
| `managers` | — | **пока не перенесено** (Telegram-подписчики уведомлений) — появится вместе с ботом |
| `invites` | `Invite` | без изменений |
| `staff` | `Staff` | без изменений |
| `sessions` | `StaffSession` | без изменений |
| `price_log` | `PriceLog` | без изменений |
| `audit` | `AuditLog` | `details` теперь `Json`, а не текст |
| `suppliers` | `Supplier` | переименовано поле `markup` → `markupPct` |
| `roles` + `perms` (JSON) | `Role` + `RolePermission` (таблица) | права стали отдельными строками вместо JSON-массива — проще матрица в админке |
| `client_sessions` | `ClientSession` | без изменений |
| `client_log` | `ClientAudit` | переименовано |
| `link_codes` | `LinkCode` | без изменений |
| `pages` | `Page` | без изменений |
| `texts` | `TextOverride` | переименовано |
| `brands` | `Brand` | без изменений |
| `payments` | `Payment` | без изменений |
| `webhook_log` | `WebhookLog` | добавлено поле `source` (раньше было только под KeyCRM) |
| — | `ProductPackaging`, `PriceBreak` | новое: упаковки и опт (ТЗ) |
| — | `CompatibilityGroup`, `ProductCompatibility` | новое: «подходит к моему инструменту» (ТЗ) |
| — | `Warehouse`, `StockItem`, `StockMovement` | новое: свой склад с резервом (ТЗ; в старом проекте остаток вообще не уменьшался при заказе — известный пробел) |
| — | `Banner`, `PromoCode`, `Partner`, `PartnerReferral` | новое: маркетинг (ТЗ) |

## Изменения схемы на Этапе 1 (каталог)

| Что | Зачем |
|---|---|
| `Product.supplierAvailable` | есть ли товар **у поставщика** (в фиде Vitals — только признак, не количество); собственный остаток — `StockItem` (Этап 4) |
| `Product.articleCode`, `Product.supplierUrl` | второй артикул и страница товара у поставщика (из фида) |
| `Product.missingFromFeedSince` | с какого импорта товара нет в фиде (товар остаётся на сайте как «Под заказ») |
| `ProductAttribute.sort` | порядок характеристик как в фиде |
| `Product.purchasePrice` | закупочная цена (наша), вводится вручную; импорт не трогает |
| Категория `unsorted` (запись в `Category`, создаётся кодом) | «Нераспределённые»: товары без категории в фиде; не показываются покупателям |
| `Supplier.feedUrl`, `Supplier.defaultBrand` | ссылка на фид; бренд для товаров, у которых в фиде нет `vendor` (у Vitals его нет вообще) |
| `FeedCategoryMap` | ключ теперь (`supplierId`, `path`); `categoryId` необязателен, добавлено `skip` («не загружать»). Действует самый длинный совпавший путь. В старом проекте карта была общей и без «пропуска» (там `'skip'` кодировался значением `our`) |
| `ImportRun` (новая таблица) + enum `ImportStatus` | журнал запусков импорта: статус, прогресс, счётчики (`summary`), отчёт (`report`), файл фида на диске |
| `Setting` `search.stale` | пометка «поисковый индекс отстаёт от каталога» |

Соответствие старого: `feed_map` → `FeedCategoryMap`, `price_conflict`/`supplier_price` → `Product.priceConflict`/`supplierPrice`
(логика — `docs/CATALOG-IMPORT.md`), `products.locked` (JSON) → `ProductFieldLock` (поля называются как в Prisma: `nameUk`, `price`…),
`products.sub` (одно значение) → дерево `Category` (до 2 уровней подкатегорий под нашей категорией).

## Что ещё не перенесено (появится на следующих этапах)

- Данные старой базы: 3 клиента и 5 заказов не переносились (малозначимы). Каталог **загружен из фида Vitals** импортом Этапа 1
  (1619 товаров вместо 1839 в старой базе: архив и стройхимия по умолчанию не загружаются).
- `managers` (подписчики уведомлений в Telegram) — появится с ботом.
- Бизнес-логика заказов (`createOrder`, расчёт скидок/уровней, синхронизация с KeyCRM/mono/Новой почтой) — Этапы 3–5.
  Импорт каталога, ручные правки и поиск перенесены на Этапе 1.
- Печать ценников (`price_log.tag_*`) и Excel/CSV-импорт других поставщиков — позже.
