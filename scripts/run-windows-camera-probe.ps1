Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$bridge = Join-Path $PSScriptRoot "..\windows\SurfaceCameraBridge"
Push-Location $bridge
try {
  dotnet run -- probe
} finally {
  Pop-Location
}
