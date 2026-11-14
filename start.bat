@echo off
chcp 65001 >nul
title Together - совместный просмотр
cd /d "%~dp0"

set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE goto nonode

"%NODE%" server.js
echo.
echo   Сервер остановлен.
pause
exit /b 0

:nonode
echo.
echo   Не найден Node.js - без него сервер не запустится.
echo   Сейчас откроется сайт nodejs.org: скачай версию LTS, установи
echo   с настройками по умолчанию и снова запусти start.bat.
echo.
start "" https://nodejs.org/
pause
exit /b 1
