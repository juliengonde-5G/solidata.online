@echo off
REM ============================================================
REM SOLIDATA — Lancement des tests techniques (smoke API)
REM Usage:
REM   scripts\run-tests.bat              → tests sur production
REM   scripts\run-tests.bat recette      → tests sur recette
REM   scripts\run-tests.bat https://...  → tests sur URL personnalisée
REM Variable optionnelle : SMOKE_API_KEY (cle d'API de service, tests authentifies)
REM ============================================================

setlocal
cd /d "%~dp0.."

if "%1"=="" (
  set "BASE_URL=https://solidata.online"
  echo [SOLIDATA] Tests sur PRODUCTION : %BASE_URL%
) else if "%1"=="recette" (
  set "BASE_URL=https://recette.solidata.online"
  echo [SOLIDATA] Tests sur RECETTE : %BASE_URL%
) else (
  set "BASE_URL=%1"
  echo [SOLIDATA] Tests sur : %BASE_URL%
)

echo.

node scripts/tests/api-smoke.js
set EXIT_CODE=%ERRORLEVEL%
endlocal
exit /b %EXIT_CODE%
