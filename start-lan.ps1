<#
 Arranca EcoGuardian en este PC y lo deja accesible a los demas equipos de la red local por tu IP.

 Uso (PowerShell, desde la carpeta del proyecto):
     .\start-lan.ps1                 # arranca todo
     .\start-lan.ps1 -OpenFirewall   # ademas abre los puertos 5173 y 4000 (ejecutar como Administrador)

 Requisitos una sola vez:
   - Docker Desktop, Node 20+, Python 3.11 con el venv de model-service creado (ver model-service\README.md)
   - backend\.env, model-service\.env y frontend\.env copiados de sus .env.example
   - model-service\weights\best.pt
#>
param([switch]$OpenFirewall)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# IPs de este equipo en la red local
$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress
Write-Host "`nLos demas equipos de la red abriran:" -ForegroundColor Green
$ips | ForEach-Object { Write-Host "    http://$($_):5173" -ForegroundColor Green }
Write-Host ""

if ($OpenFirewall) {
  # Solo frontend y backend. La BD (5432) y el modelo (8000) NO se exponen.
  New-NetFirewallRule -DisplayName 'EcoGuardian web (5173)' -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private | Out-Null
  New-NetFirewallRule -DisplayName 'EcoGuardian API (4000)' -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private | Out-Null
  Write-Host "Reglas de firewall creadas (solo perfil de red Privada)." -ForegroundColor Yellow
}

Write-Host "Arrancando base de datos..." -ForegroundColor Cyan
docker compose -f "$root\docker-compose.yml" up -d postgis

Write-Host "Arrancando model-service, backend y frontend en ventanas nuevas..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\model-service'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --host 127.0.0.1 --port 8000"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\backend'; npm install; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\frontend'; npm install; npm run dev"
