# ============================================================
# SOLIDATA — Lancement des tests techniques (smoke API)
# Usage:
#   .\scripts\run-tests.ps1
#   .\scripts\run-tests.ps1 -Env recette
#   .\scripts\run-tests.ps1 -BaseUrl "https://recette.solidata.online"
#   .\scripts\run-tests.ps1 -ApiUser admin -ApiPassword "xxx"
# ============================================================

param(
    [string]$Env = "prod",      # prod | recette
    [string]$BaseUrl = "",
    [string]$ApiUser = $env:API_USER,
    [string]$ApiPassword = $env:API_PASSWORD
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }
Set-Location $ProjectRoot

if ($BaseUrl) {
    $url = $BaseUrl.TrimEnd('/')
} elseif ($Env -eq "recette") {
    $url = "https://recette.solidata.online"
} else {
    $url = "https://solidata.online"
}

Write-Host "[SOLIDATA] Tests sur : $url" -ForegroundColor Cyan
if ($ApiUser) { Write-Host "[SOLIDATA] Login avec utilisateur : $ApiUser" -ForegroundColor Gray }
Write-Host ""

$env:BASE_URL = $url
if ($ApiUser) { $env:API_USER = $ApiUser }
if ($ApiPassword) { $env:API_PASSWORD = $ApiPassword }

& node scripts/tests/api-smoke.js
exit $LASTEXITCODE
