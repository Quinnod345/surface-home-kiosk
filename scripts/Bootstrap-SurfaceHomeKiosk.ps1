param(
  [string]$RepoZipUrl = "https://github.com/Quinnod345/surface-home-kiosk/archive/refs/heads/main.zip",
  [string]$InstallDirectory = "$env:USERPROFILE\SurfaceHomeKiosk",
  [string]$HomeAssistantUrl = "http://homeassistant.local:8123",
  [string]$DashboardUrl = "http://homeassistant.local:8123/lovelace/default_view?kiosk",
  [switch]$SkipAutostart,
  [switch]$SkipModels,
  [switch]$SkipPrerequisiteInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$tempRoot = Join-Path $env:TEMP ("surface-home-kiosk-" + [Guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempRoot "surface-home-kiosk.zip"
$extractPath = Join-Path $tempRoot "extract"

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
New-Item -ItemType Directory -Force -Path $extractPath | Out-Null

try {
  Write-Host "Downloading Surface Home Kiosk..."
  Invoke-WebRequest -Uri $RepoZipUrl -OutFile $zipPath

  Write-Host "Extracting..."
  Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

  $source = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
  if (-not $source) {
    throw "Could not find extracted repository folder."
  }

  if (Test-Path $InstallDirectory) {
    $backup = "$InstallDirectory.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Write-Host "Existing install found. Moving to $backup"
    Move-Item -Path $InstallDirectory -Destination $backup
  }

  Write-Host "Installing to $InstallDirectory"
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDirectory -Parent) | Out-Null
  Copy-Item -Path $source.FullName -Destination $InstallDirectory -Recurse

  Push-Location $InstallDirectory
  try {
    $installArgs = @(
      "-ExecutionPolicy", "Bypass",
      "-File", "scripts\Install-SurfaceHomeKiosk.ps1",
      "-HomeAssistantUrl", $HomeAssistantUrl,
      "-DashboardUrl", $DashboardUrl
    )

    if ($SkipAutostart) {
      $installArgs += "-SkipAutostart"
    }

    if ($SkipModels) {
      $installArgs += "-SkipModels"
    }

    if ($SkipPrerequisiteInstall) {
      $installArgs += "-SkipPrerequisiteInstall"
    }

    powershell @installArgs
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Surface Home Kiosk installed."
Write-Host "Start it with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$InstallDirectory\scripts\Start-SurfaceHomeKiosk.ps1`""
