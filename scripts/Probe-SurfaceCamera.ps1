Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BridgeProject = Join-Path $Root "windows\SurfaceCameraBridge\SurfaceCameraBridge.csproj"
$OutDir = Join-Path $Root "camera-probe-output"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Push-Location $Root
try {
  Write-Host "Writing camera inventory..."
  dotnet run --project $BridgeProject -- probe |
    Tee-Object -FilePath (Join-Path $OutDir "camera-inventory.json")

  Write-Host "Capturing infrared frame..."
  dotnet run --project $BridgeProject -- capture --kind Infrared --out (Join-Path $OutDir "infrared.png")

  Write-Host "Capturing color frame..."
  dotnet run --project $BridgeProject -- capture --kind Color --out (Join-Path $OutDir "color.png")

  Write-Host "Probe output: $OutDir"
} finally {
  Pop-Location
}
