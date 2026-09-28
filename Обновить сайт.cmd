@echo off
rem Obnovit sajt Handyman: skachat svezhuyu versiyu i perezapustit (sm. scripts\update-site.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-site.ps1"
echo.
pause
