Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskName = "Surface Home Kiosk"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task: $TaskName"
} else {
  Write-Host "Scheduled task not found: $TaskName"
}

Get-Process SurfaceCameraBridge -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Stopped camera bridge if it was running."
