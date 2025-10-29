$ErrorActionPreference = 'Stop'

# Paths (resolved relative to this script location)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$aria2Exe = Join-Path $root 'aria2-bin\aria2-1.37.0-win-64bit-build1\aria2c.exe'
$downloads = Join-Path $root 'downloads'

if (-not (Test-Path $aria2Exe)) {
  Write-Error "aria2c introuvable: $aria2Exe"
}

if (-not (Test-Path $downloads)) {
  New-Item -ItemType Directory -Path $downloads | Out-Null
}

# Env vars (change secret if needed)
$env:ARIA2_RPC_SECRET = if ($env:ARIA2_RPC_SECRET) { $env:ARIA2_RPC_SECRET } else { 'changeme' }
$env:DOWNLOADS_BASE_DIR = $downloads

# Launch aria2 in a new PowerShell window
$ariaCmd = "& '$aria2Exe' --enable-rpc --rpc-listen-all=false --rpc-secret=$($env:ARIA2_RPC_SECRET) --check-integrity=true --continue=true --seed-time=0 --seed-ratio=0 --max-upload-limit=1K --bt-max-peers=50 --dir='$downloads'"

Start-Process powershell -WorkingDirectory $root -ArgumentList @('-NoExit','-Command', $ariaCmd)
Write-Host "Aria2 lancé dans une nouvelle fenêtre. Downloads: $downloads"


