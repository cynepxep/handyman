---
name: windows-env
description: Работа на компьютере владельца (Windows, PowerShell 5.1) — запуск Docker, сайта на :3100, остановка next dev, пути с русскими буквами и скобками, SQL через psql, место на диске C:. Используй перед любыми командами PowerShell/Windows в этом проекте и когда что-то «странно не работает» локально.
---

# Окружение владельца: Windows / PowerShell 5.1 (уже наступали)

## Что где
- Docker Desktop установлен «для текущего пользователя», в PATH не прописан: вызывать по полному пути
  `C:\Users\Дима\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`.
- Git установлен в `D:\Git`. В долгих сессиях PATH может быть устаревшим — тогда `D:\Git\cmd\git.exe`.
- Диск C: почти полон (на конец Этапа 1 ~14 ГБ свободно), диск D: почти пустой (~290 ГБ). Образы Docker лежат на C:.
  Большие файлы сохраняй на D:, следи за местом (`Get-PSDrive C`).
- Схема работы: Postgres/Redis/Meilisearch — в Docker (`pnpm infra:up`), сайт — напрямую на Windows
  (`pnpm --filter web dev --port 3100`; порт 3100, чтобы не мешал старому магазину на :3000).
  Профиль `full` (web и bot в контейнерах) собран, но **не проверялся** (папку `.data/feeds` надо будет вынести в том).
- MinIO из compose убран (образ недоступен) — хранилище картинок выберем на этапе загрузки фото.
- Тестовая база создаётся один раз: `docker exec handyman-next-postgres-1 psql -U handyman -d postgres -c "CREATE DATABASE handyman_test"`
  (миграции тесты накатывают сами).

## Запуск и остановка сайта
- Инструмент предпросмотра (`preview_start`) может взять `.claude/launch.json` **старого** проекта (порт 3000, `..\handyman`) — сразу останови.
  Сайт новой версии: `pnpm --filter web dev --port 3100` в фоне, открывать `http://localhost:3100` через `navigate`.
- После проверок останови сервер на 3100 **целиком**: `next dev` — это несколько процессов node (pnpm, dotenv, next, рабочий процесс).
  Остановка одного слушателя порта оставляет остальные, и они держат `query_engine-windows.dll.node` — тогда `pnpm db:generate` / миграция
  падает с `EPERM ... rename`. Останови по командной строке (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` → `Stop-Process`
  только своих), потом проверь `Get-Process node`. Перед миграцией сайт останови (Prisma на Windows не перезапишет занятый файл движка).
- Чужой `next dev` на :3100 без разрешения владельца не останавливать; своя копия для проверки — `pnpm build` + `next start -p 3200`.

## PowerShell
- `Set-Location` с сокращённым (8.3) путём во временную папку с русской буквой **молча не срабатывает**, и следующая команда (`npm i`)
  выполнится в старой папке проекта (однажды это записало лишнюю зависимость в `package.json` старого проекта). Всегда полный путь,
  проверяй `Get-Location` перед `npm`/`pnpm`. Временные файлы — в `C:\Users\Public\...`, потом удалить.
- Папки со скобками (`app/[lang]`, `[slug]`, `[...rest]`) PowerShell понимает как шаблон: `Resolve-Path`/`Set-Location` без `-LiteralPath`
  ломаются. Такие файлы правь инструментом Edit/Write, а не скриптами PowerShell.
- SQL в `docker exec ... psql -c "..."` PowerShell портит кавычки: передавай запрос через ввод:
  `@'...'@ | docker.exe exec -i handyman-next-postgres-1 psql -U handyman -d handyman`.
- `Remove-Item` с подстановками и переменными из вывода команд может быть заблокирован: удаляй по точному имени, `-LiteralPath`.
- Скрипты с доступом к базе запускай `pnpm exec dotenv -e ../../.env -- tsx <файл>` из папки пакета (сам `.env` не читай).

## Правка файлов скриптами
- `node -e "…"` в Bash: обратные кавычки внутри двойных кавычек bash выполняет как команды и вырезает текст. Шаблонные строки JS и
  markdown с кодом правь инструментом Edit/Write.
- `node - <<'EOF'` (код из stdin) теряет обратные слэши в регулярках (`\s` → `s`). Скрипт — отдельным файлом (Write) и `node файл.cjs`, или сразу Edit.
