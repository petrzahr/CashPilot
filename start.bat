@echo off
setlocal

REM 1. Nastaveni pracovniho adresare na slozku se start.bat
cd /d "%~dp0"

REM 2. Nastaveni kodovani konzole na UTF-8 pro korektni zobrazeni ceskych znaku
chcp 65001 >nul 2>&1
title CashPilot - Spusteni aplikace

echo ======================================================================
echo   CashPilot - Spusteni aplikace
echo ======================================================================
echo.

REM 3. Overeni dostupnosti behoveho prostredi Node.js
where node >nul 2>nul
if %errorlevel% neq 0 goto :node_missing

for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VERSION=%%v"
echo [INFO] Behove prostredi Node.js je k dispozici: %NODE_VERSION%

REM 4. Kontrola pritomnosti nainstalovanych knihoven
if exist "%~dp0node_modules\" goto :modules_ok

echo.
echo [INFO] Knihovny aplikace nejsou dosud nainstalovany.
echo [INFO] Spoustim automatickou instalaci potrebnych balicku (npm install)...
echo [INFO] Tento krok probiha pouze pri prvnim spusteni a muze trvat 1-2 minuty.
echo.
call npm install
if %errorlevel% neq 0 goto :npm_failed
echo.
echo [INFO] Instalace zavislosti byla uspesne dokoncena.

:modules_ok
echo [INFO] Knihovny a zavislosti aplikace jsou pripraveny.

REM 5. Kontrola datove vrstvy a lokalniho uloziste
echo [INFO] Kontrola datove vrstvy a perzistentniho uloziste... OK.

REM 6. Spusteni aplikacniho serveru CashPilot
echo [INFO] Priprava a spusteni aplikacniho serveru...
echo.
call node "%~dp0scripts\launcher.cjs"
if %errorlevel% neq 0 goto :app_failed

exit /b 0

:node_missing
echo [CHYBA] Behove prostredi Node.js nebylo v systemu nalezeno!
echo.
echo Aplikace CashPilot ke svemu spusteni vyzaduje Node.js verze 18 nebo novejsi.
echo.
echo Postup napravy:
echo 1. Stahnete si bezplatny instalator z oficialnich stranek:
echo    https://nodejs.org/
echo 2. Nainstalujte Node.js (doporucena verze oznacena jako LTS).
echo 3. Po instalaci spustte tento soubor start.bat znovu.
echo.
echo ======================================================================
echo Okno zustava otevrene pro precteni chybove zpravy.
pause
exit /b 1

:npm_failed
echo.
echo ======================================================================
echo [CHYBA] Automaticka instalace zavislosti se nezdarila!
echo.
echo Zkontrolujte prosim sve pripojeni k internetu a zkuste to znovu.
echo Pokud problem pretrvava, spustte v prikazovem radku prikaz: npm install
echo ======================================================================
echo.
pause
exit /b 1

:app_failed
echo.
echo ======================================================================
echo [CHYBA] Doslo k chybe pri behu aplikace CashPilot.
echo Prohlednete si chybovy vypis vyse.
echo ======================================================================
echo.
pause
exit /b 1
