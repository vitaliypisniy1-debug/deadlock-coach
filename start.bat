@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Deadlock Coach

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установи его с https://nodejs.org ^(версия LTS^), затем запусти этот файл снова.
  pause
  exit /b 1
)

rem Electron считается установленным, только если есть сам electron.exe.
rem Новые версии npm не запускают установочный скрипт Electron, поэтому
rem программу скачивает наш tools\get-electron.js — с понятным выводом.
if not exist "node_modules\electron\dist\electron.exe" (
  echo Первый запуск: ставлю Electron, это займёт пару минут...
  if not exist "node_modules\electron\package.json" (
    call npm install --no-audit --no-fund --ignore-scripts
    if errorlevel 1 goto install_failed
  )
  node tools\get-electron.js
  if errorlevel 1 goto install_failed
  if not exist "node_modules\electron\dist\electron.exe" goto install_failed
)

echo Запускаю Deadlock Coach... Это окно можно не закрывать — оно закроется само вместе с программой.
"node_modules\electron\dist\electron.exe" .
if errorlevel 1 (
  echo.
  echo Программа закрылась с ошибкой ^(код %errorlevel%^).
  echo Сделай скриншот этого окна. Подробности также в файле:
  echo   %APPDATA%\deadlock-coach\crash.log  или  %APPDATA%\Deadlock Coach\crash.log
  pause
)
exit /b 0

:install_failed
echo.
echo Не получилось установить Electron. Причина написана выше. Проверь интернет и запусти файл снова.
echo Если не помогло — удали папку node_modules рядом с этим файлом и попробуй ещё раз.
pause
exit /b 1
