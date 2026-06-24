Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$VbsLauncher = Join-Path $Root "scripts\Start-SurfaceHomeKiosk.vbs"
$BridgeProject = Join-Path $Root "windows\SurfaceCameraBridge\SurfaceCameraBridge.csproj"
$BridgeExe = Join-Path $Root "windows\SurfaceCameraBridge\bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\SurfaceCameraBridge.exe"
$BridgeLog = Join-Path $Root "surface-camera-bridge.log"
$BridgeErrorLog = Join-Path $Root "surface-camera-bridge.error.log"
$KioskLog = Join-Path $Root "surface-home-kiosk.log"
$KioskErrorLog = Join-Path $Root "surface-home-kiosk.error.log"
$ElectronExe = Join-Path $Root "node_modules\electron\dist\electron.exe"

function Start-Bridge {
  if (Get-Process SurfaceCameraBridge -ErrorAction SilentlyContinue) {
    return
  }

  if (Test-Path $BridgeExe) {
    Start-Process -FilePath $BridgeExe `
      -ArgumentList @("serve", "--kind", "Infrared", "--url", "http://127.0.0.1:8765/") `
      -WorkingDirectory $Root `
      -WindowStyle Minimized `
      -RedirectStandardOutput $BridgeLog `
      -RedirectStandardError $BridgeErrorLog
    return
  }

  Start-Process -FilePath "dotnet" `
    -ArgumentList @("run", "--project", $BridgeProject, "--", "serve", "--kind", "Infrared", "--url", "http://127.0.0.1:8765/") `
    -WorkingDirectory $Root `
    -WindowStyle Minimized `
    -RedirectStandardOutput $BridgeLog `
    -RedirectStandardError $BridgeErrorLog
}

Start-Bridge

$env:SURFACE_KIOSK = "1"
$env:NODE_ENV = "production"

if (-not (Test-Path $ElectronExe)) {
  throw "Electron not found at $ElectronExe. Run Install-SurfaceHomeKiosk.ps1 first."
}

Start-Process -FilePath $ElectronExe `
  -ArgumentList @($Root) `
  -WorkingDirectory $Root `
  -RedirectStandardOutput $KioskLog `
  -RedirectStandardError $KioskErrorLog
