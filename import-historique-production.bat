@echo off
REM Import historique KPI Production depuis KPI_Production 2026.xlsx
REM Necessite Node.js installe et .env configure (connexion BDD).

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set XLSX=%ROOT%..\KPI_Production 2026.xlsx

if exist "%XLSX%" (
  echo Fichier trouve: %XLSX%
  cd /d "%BACKEND%"
  call npm run seed-production -- "%XLSX%"
) else (
  echo Fichier non trouve: %XLSX%
  echo Placez "KPI_Production 2026.xlsx" dans le dossier parent du projet, ou lancez:
  echo   cd backend
  echo   npm run seed-production -- "chemin/vers/KPI_Production 2026.xlsx"
  pause
)
