@echo off
REM SOLIDATA — Push local vers origin main
REM Usage: push.bat
REM        push.bat "Message de commit"

set MSG=%~1
if "%MSG%"=="" set MSG=Mise à jour %date% %time%

echo [PUSH] Statut...
git status -sb

echo [PUSH] Ajout des fichiers...
git add -A

echo [PUSH] Commit : %MSG%
git commit -m "%MSG%"
if errorlevel 1 (
  echo [PUSH] Rien a committer ou annule.
  exit /b 0
)

echo [PUSH] Envoi vers origin main...
git push origin main

echo [PUSH] OK.
