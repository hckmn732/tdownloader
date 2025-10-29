$aria2Processes = Get-Process -Name aria2c -ErrorAction SilentlyContinue

if ($aria2Processes) {
    Write-Host "aria2 est en cours d'exécution:" -ForegroundColor Green
    $aria2Processes | ForEach-Object {
        Write-Host "  PID: $($_.Id) - Démarrage: $($_.StartTime)" -ForegroundColor Cyan
    }
    exit 0
} else {
    Write-Host "aria2 n'est PAS en cours d'exécution." -ForegroundColor Yellow
    exit 1
}

