@echo off
chcp 65001 >nul
cd /d "%~dp0"

fltmc >nul 2>&1
if errorlevel 1 goto noadmin

set "PORT=8765"
for /f "usebackq delims=" %%p in (`node -e "try{process.stdout.write(String(require('./config.json').port||8765))}catch(e){process.stdout.write('8765')}" 2^>nul`) do set "PORT=%%p"

netsh advfirewall firewall delete rule name="Together" >nul 2>&1
netsh advfirewall firewall add rule name="Together" dir=in action=allow protocol=TCP localport=%PORT% profile=any >nul
if errorlevel 1 goto fail

echo.
echo   Готово: брандмауэр Windows пропускает подключения к порту %PORT%.
echo   Убрать правило: netsh advfirewall firewall delete rule name="Together"
echo.
pause
exit /b 0

:noadmin
echo.
echo   Нужны права администратора: нажми на этот файл правой кнопкой мыши
echo   и выбери «Запуск от имени администратора».
echo.
pause
exit /b 1

:fail
echo.
echo   Не получилось добавить правило брандмауэра.
echo.
pause
exit /b 1
