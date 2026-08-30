# ============================================================
# SOLIDATA — Lancement des tests techniques (smoke API)
# Usage:
#   .\scripts\run-tests.ps1
#   .\scripts\run-tests.ps1 -Env recette
#   .\scripts\run-tests.ps1 -BaseUrl "https://recette.solidata.online"
#   .\scripts\run-tests.ps1 -ApiKey "sol_xxxxxxxx_yyyyyyyy"
# ============================================================

param(
    [string]$Env = "prod",      # prod | recette
    [string]$BaseUrl = "",
    [string]$ApiKey = $env:SMOKE_API_KEY
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
if ($ApiKey) { Write-Host "[SOLIDATA] Identite de service : cle d'API (lecture seule)" -ForegroundColor Gray }
Write-Host ""

$env:BASE_URL = $url
if ($ApiKey) { $env:SMOKE_API_KEY = $ApiKey }

& node scripts/tests/api-smoke.js
exit $LASTEXITCODE
