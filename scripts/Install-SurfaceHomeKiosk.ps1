param(
  [switch]$SkipAutostart,
  [switch]$SkipModels,
  [string]$HomeAssistantUrl = "http://homeassistant.local:8123",
  [string]$DashboardUrl = "http://homeassistant.local:8123/lovelace/default_view?kiosk"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ConfigPath = Join-Path $Root "public\kiosk-config.json"
$ExampleConfigPath = Join-Path $Root "public\kiosk-config.example.json"
$StartScript = Join-Path $Root "scripts\Start-SurfaceHomeKiosk.ps1"
$TaskName = "Surface Home Kiosk"

function Assert-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not installed. $InstallHint"
  }
}

function Update-Config {
  if (-not (Test-Path $ConfigPath)) {
    Copy-Item $ExampleConfigPath $ConfigPath
  }

  $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  $config.homeAssistant.baseUrl = $HomeAssistantUrl
  $config.homeAssistant.dashboardUrl = $DashboardUrl
  $config.nativeBridge.enabled = $true
  $config.nativeBridge.url = "ws://127.0.0.1:8765/events"
  $config.nativeBridge.preferredSourceKind = "Infrared"
  $config.faceRecognition.enabled = $true

  $json = $config | ConvertTo-Json -Depth 20
  Set-Content -Path $ConfigPath -Value $json -Encoding UTF8
}

function Install-Dependencies {
  Push-Location $Root
  try {
    if (Test-Path "package-lock.json") {
      npm ci
    } else {
      npm install
    }

    if (-not $SkipModels) {
      npm run download:face-models
    }
  } finally {
    Pop-Location
  }
}

function Publish-Bridge {
  dotnet publish (Join-Path $Root "windows\SurfaceCameraBridge\SurfaceCameraBridge.csproj") `
    -c Release `
    -r win-x64 `
    --self-contained false
}

function Install-Autostart {
  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Starts the Surface Home Kiosk and camera bridge at sign-in." `
    -Force | Out-Null
}

Assert-Command "node" "Install Node.js LTS from https://nodejs.org/ or winget install OpenJS.NodeJS.LTS"
Assert-Command "npm" "Install Node.js LTS from https://nodejs.org/ or winget install OpenJS.NodeJS.LTS"
Assert-Command "dotnet" "Install the .NET 8 SDK from https://dotnet.microsoft.com/download"

Write-Host "Updating kiosk config..."
Update-Config

Write-Host "Installing npm dependencies and face models..."
Install-Dependencies

Write-Host "Publishing Surface camera bridge..."
Publish-Bridge

if (-not $SkipAutostart) {
  Write-Host "Registering scheduled task: $TaskName"
  Install-Autostart
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Run camera probe next:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\Probe-SurfaceCamera.ps1"
Write-Host ""
Write-Host "Start kiosk now:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\Start-SurfaceHomeKiosk.ps1"
