# ============================================================
# SOLIDATA — Déploiement sur le site de production (depuis Windows)
# Ce script se connecte au serveur en SSH et lance le déploiement,
# puis lance les tests smoke depuis votre PC.
#
# Prérequis :
#   - SSH configuré (clé ou mot de passe) vers le serveur
#   - Node.js installé sur votre PC (pour les tests)
#
# Usage:
#   .\scripts\deploy-prod.ps1
#   .\scripts\deploy-prod.ps1 -SkipTests
#   .\scripts\deploy-prod.ps1 -SshUser root -SshHost 51.159.144.100
# ============================================================

param(
    [string]$SshUser = $env:SOLIDATA_SSH_USER,
    [string]$SshHost = $env:SOLIDATA_SSH_HOST,
    [string]$AppDir = "/opt/solidata.online",
    [switch]$SkipTests = $false
)

# Valeurs par défaut si variables d'environnement non définies
if (-not $SshHost) { $SshHost = "51.159.144.100" }
if (-not $SshUser) { $SshUser = "root" }

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }

Write-Host ""
Write-Host "[SOLIDATA] Déploiement production" -ForegroundColor Cyan
Write-Host "  Serveur : ${SshUser}@${SshHost}" -ForegroundColor Gray
Write-Host "  Répertoire : ${AppDir}" -ForegroundColor Gray
Write-Host ""

# Commande à exécuter sur le serveur : déploiement + health check
$RemoteCmd = "cd ${AppDir} && bash deploy/scripts/deploy-and-test.sh"
Write-Host "[SOLIDATA] Connexion SSH et exécution du déploiement..." -ForegroundColor Yellow
ssh "${SshUser}@${SshHost}" $RemoteCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "[SOLIDATA] Le déploiement ou les vérifications sur le serveur ont échoué." -ForegroundColor Red
    exit $LASTEXITCODE
}

if (-not $SkipTests) {
    Write-Host ""
    Write-Host "[SOLIDATA] Lancement des tests smoke depuis votre PC..." -ForegroundColor Yellow
    Set-Location $ProjectRoot
    $env:BASE_URL = "https://solidata.online"
    & node scripts/tests/api-smoke.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[SOLIDATA] Les tests smoke ont échoué. Vérifiez l'application en production." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host ""
Write-Host "[SOLIDATA] Déploiement et tests terminés avec succès." -ForegroundColor Green
Write-Host "  Web    : https://solidata.online" -ForegroundColor Gray
Write-Host "  Mobile : https://m.solidata.online" -ForegroundColor Gray
Write-Host ""
