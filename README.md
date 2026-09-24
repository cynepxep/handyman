# Handyman — новая версия (в разработке)

Переписываемая на новый стек версия магазина. Рабочая версия, которой пользуется
владелец, находится в `..\handyman` — эта папка её не заменяет, пока не будет готова.

## Что нужно установить один раз

1. **Node.js** и **pnpm** (`corepack enable`, затем `corepack prepare pnpm@12.6.0 --activate`).
2. **Docker Desktop** (нужны Windows 10 сборки 19045.4000+ или Windows 11, включённые
   компоненты «Платформа виртуальной машины» и WSL, современный WSL 2.x).
3. Файл `.env`: скопировать `.env.example` в `.env`, вписать свой `ADMIN_TOKEN` (пароль владельца).

## Как запустить (ежедневная работа)

```bash
pnpm install
```

```bash
pnpm infra:up
```

Первый раз (создать таблицы и стартовые данные в базе):

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

Запуск сайта:

```bash
pnpm --filter web dev --port 3100
```

- Сайт: http://localhost:3100
- Админка: http://localhost:3100/admin/login (логин `owner`, пароль — `ADMIN_TOKEN` из `.env`)

Остановить сервисы Docker: `pnpm infra:down`. Данные базы сохраняются между запусками.

Если команда `docker` не находится — Docker Desktop поставился «для текущего пользователя»
и не прописался в PATH; полный путь: `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe`.

## Проверки без Docker

```bash
pnpm --filter web exec tsc --noEmit
```

```bash
pnpm --filter web build
```

## Структура

См. `CLAUDE.md` — карта репозитория и правила разработки.
