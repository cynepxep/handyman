# «Обновить сайт» — одна кнопка для владельца (Windows, PowerShell 5.1).
# Что делает: запускает Docker (база, поиск), останавливает сайт на :3100, скачивает свежую версию (git pull, ветка main),
# ставит зависимости, обновляет базу (миграции) и поиск, запускает сайт в отдельном окне и открывает админку в браузере.
# Старый магазин (соседняя папка, порт 3000) не трогает. Ничего не удаляет: если есть несохранённые правки — останавливается и объясняет.
# Запуск: двойной щелчок по «Обновить сайт.cmd» (в папке проекта или ярлык на рабочем столе — он создаётся сам при первом запуске).

$ErrorActionPreference = "Stop"
$selfHash = (Get-FileHash -LiteralPath $PSCommandPath).Hash
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$logDir = Join-Path $root ".data"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
try { Start-Transcript -Path (Join-Path $logDir "update-last.log") -Force | Out-Null } catch {}

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) {
  Write-Host ""
  Write-Host "НЕ ПОЛУЧИЛОСЬ: $text" -ForegroundColor Red
  Write-Host "Подробности — в файле .data\update-last.log в папке проекта (его можно показать Claude)." -ForegroundColor Yellow
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}
# Внешняя программа: вывод идёт в окно и в журнал; ненулевой код — понятная ошибка.
# (В PowerShell 5.1 при $ErrorActionPreference = "Stop" сообщения программ в stderr иначе обрывают скрипт.)
function Run($what, [scriptblock]$cmd) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $cmd | Out-Host } finally { $ErrorActionPreference = $old }
  if ($LASTEXITCODE -ne 0) { Fail "$what (код ошибки $LASTEXITCODE)." }
}
function DockerReady {
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & docker info *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false } finally { $ErrorActionPreference = $old }
}

# ---------- магазин переехал на сервер (шаг 8.5, docs/LAUNCH.md) ----------
# После переезда сайт на этом компьютере не запускаем: он читал бы того же бота и отправлял те же сводки и напоминания.
if (Test-Path -LiteralPath (Join-Path $root ".data\moved-to-server.txt")) {
  Fail "магазин переехал на сервер (файл .data\moved-to-server.txt), и запуск сайта на этом компьютере выключен. Обновление теперь — на сервере: bash deploy/update.sh. Вернуть сайт на компьютер — docs/LAUNCH.md, раздел «Откат»."
}

# ---------- ярлык на рабочем столе ----------
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $lnk = Join-Path $desktop "Обновить сайт.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $root "Обновить сайт.cmd"
  $s.WorkingDirectory = $root
  $s.Description = "Скачать свежую версию сайта Handyman и перезапустить его"
  $s.IconLocation = "$env:SystemRoot\System32\shell32.dll,238"
  $s.Save()
} catch { Write-Host "Ярлык на рабочем столе создать не удалось (не страшно): $($_.Exception.Message)" -ForegroundColor Yellow }

# ---------- программы ----------
Step "Проверяю программы"
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git -and (Test-Path "D:\Git\cmd\git.exe")) { $git = "D:\Git\cmd\git.exe" }
if (-not $git) { Fail "не найден Git." }
$dockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (Test-Path $dockerBin) { $env:Path = "$dockerBin;$env:Path" }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "не найден pnpm (обычно ставится вместе с Node.js: npm install -g pnpm)." }
if (-not (Test-Path (Join-Path $root ".env"))) { Fail "в папке проекта нет файла .env с настройками." }

# ---------- Docker: база и поиск ----------
Step "Запускаю базу и поиск (Docker)"
$dockerOk = DockerReady
if (-not $dockerOk) {
  $dd = @(
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
    "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $dd) { Fail "Docker Desktop не запущен и не найден. Запустите его вручную и нажмите «Обновить сайт» ещё раз." }
  Start-Process -FilePath $dd | Out-Null
  Write-Host "Жду, пока Docker запустится (до 3 минут)…"
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    if (DockerReady) { $dockerOk = $true; break }
  }
  if (-not $dockerOk) { Fail "Docker так и не запустился. Откройте Docker Desktop, дождитесь зелёного значка и нажмите «Обновить сайт» ещё раз." }
}
Run "не удалось запустить базу и поиск" { pnpm infra:up }

# Команда окна сайта (запуск — в конце). Передаётся закодированной: так пробелы, кавычки и русские буквы доходят без искажений.
$siteTitle = "Сайт Handyman — не закрывайте это окно"
$cmd = "`$host.UI.RawUI.WindowTitle = '$siteTitle'; Set-Location -LiteralPath '$root'; pnpm --filter web dev --port 3100"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))

# ---------- остановить сайт ----------
Step "Останавливаю сайт (если он запущен)"
$pattern = "*" + $root + "\*"
# процессы сайта: всё из папки проекта + сам pnpm, запущенный командой сайта (старый магазин на :3000 не трогаем)
function SiteProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like $pattern -or $_.CommandLine -like "*--filter web dev --port 3100*" }
}
$mine = SiteProcesses
foreach ($p in $mine) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {} }
# прежнее окно сайта: по заголовку или по той же закодированной команде
$winIds = @(Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq $siteTitle } | ForEach-Object { $_.Id })
$winIds += @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*$encoded*" } | ForEach-Object { $_.ProcessId })
foreach ($id in ($winIds | Select-Object -Unique)) { if ($id -ne $PID) { try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {} } }
Start-Sleep -Seconds 2
$left = SiteProcesses
if ($left) { Fail "сайт не остановился. Закройте окно сайта (или перезагрузите компьютер) и нажмите «Обновить сайт» ещё раз." }

# ---------- свежая версия ----------
Step "Скачиваю свежую версию с GitHub"
$dirty = & $git status --porcelain --untracked-files=no
if ($dirty) {
  Write-Host $dirty
  Fail "в папке проекта есть несохранённые изменения файлов (список выше). Ничего не трогаю — покажите это Claude."
}
$branch = (& $git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") {
  Write-Host "Сейчас открыта ветка $branch — переключаюсь на main."
  Run "не удалось переключиться на main" { & $git checkout main }
}
Run "не удалось скачать обновление: нет интернета, нужен вход в GitHub или на этом компьютере есть свои сохранения, которых нет на GitHub (покажите это Claude)" { & $git pull --ff-only origin main }
Write-Host ("Версия: " + (& $git log -1 --format="%h %s"))
# сама кнопка обновилась — дальше работает уже новая версия (второй раз скачивать нечего, поэтому повтора не будет)
if ((Get-FileHash -LiteralPath $PSCommandPath).Hash -ne $selfHash) {
  Write-Host "Кнопка «Обновить сайт» тоже обновилась — продолжаю в новой версии."
  try { Stop-Transcript | Out-Null } catch {}
  & powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
  exit $LASTEXITCODE
}

# ---------- зависимости, база, поиск ----------
Step "Устанавливаю зависимости"
Run "не удалось установить зависимости" { pnpm install --frozen-lockfile }
Step "Обновляю базу данных"
$old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
try { & pnpm db:migrate | Out-Host } finally { $ErrorActionPreference = $old }
if ($LASTEXITCODE -ne 0) {
  # Обновление базы споткнулось. Если для него есть ремонт (packages/db/prisma/repairs/<миграция>.sql) — чиним и повторяем.
  $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try {
    $failed = @(& docker exec handyman-next-postgres-1 psql -U handyman -d handyman -At -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL" 2>$null)
  } finally { $ErrorActionPreference = $old }
  $failed = @($failed | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
  if (-not $failed.Count) { Fail "не удалось обновить базу данных." }
  foreach ($name in $failed) {
    $repair = Join-Path $root "packages\db\prisma\repairs\$name.sql"
    if (-not (Test-Path -LiteralPath $repair)) { Fail "не удалось обновить базу данных (шаг $name), готового ремонта для него нет." }
    Write-Host "Чиню базу для шага $name (старые данные сохраняются в резервные таблицы)…" -ForegroundColor Yellow
    # без «--» в команде: у pnpm на Windows обёртка pnpm.ps1, и PowerShell выбрасывает «--», из-за чего аргументы не доходят до prisma
    Run "не удалось подготовить ремонт базы" { pnpm --filter @handyman/db run migrate:mark-rolled-back $name }
    Run "не удалось починить базу" { pnpm --filter @handyman/db run db:run-sql "prisma/repairs/$name.sql" }
  }
  Run "не удалось обновить базу данных после ремонта" { pnpm db:migrate }
}
Run "не удалось подготовить доступ к базе" { pnpm db:generate }
Step "Обновляю поиск"
$old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
try { & pnpm search:reindex | Out-Host } finally { $ErrorActionPreference = $old }
if ($LASTEXITCODE -ne 0) { Write-Host "Поиск обновить не удалось — сайт работает, поиск догонит позже (кнопка «Пересобрать поиск» на главной админки)." -ForegroundColor Yellow }

# ---------- запуск ----------
Step "Запускаю сайт"
Start-Process powershell -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded" -WindowStyle Minimized | Out-Null
Write-Host "Жду, пока сайт ответит (до 4 минут)…"
$up = $false
$clock = [Diagnostics.Stopwatch]::StartNew()
while ($clock.Elapsed.TotalSeconds -lt 240) {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3100/admin/login" -UseBasicParsing -TimeoutSec 20
    if ($r.StatusCode -lt 500) { $up = $true; break }
  } catch {}
}
if (-not $up) { Fail "сайт не ответил за 4 минуты. Разверните свёрнутое окно «Сайт Handyman» — там видна ошибка." }

Write-Host ""
Write-Host "ГОТОВО. Сайт обновлён и работает: http://localhost:3100 (админка — http://localhost:3100/admin)" -ForegroundColor Green
Write-Host "Свёрнутое окно «Сайт Handyman» не закрывайте — это и есть работающий сайт."
Start-Process "http://localhost:3100/admin"
try { Stop-Transcript | Out-Null } catch {}
