param(
  [string]$RepoZipUrl = "https://github.com/Quinnod345/surface-home-kiosk/archive/refs/heads/main.zip",
  [string]$InstallDirectory = "$env:USERPROFILE\SurfaceHomeKiosk",
  [switch]$SkipRefresh,
  [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$CodexPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDyndpgo0gWweEoeh/2q8sj69IBaz/PzZLl825n/Cdub surface-home-kiosk-codex"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Refresh-Install {
  $tempRoot = Join-Path $env:TEMP ("surface-home-kiosk-refresh-" + [Guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $tempRoot "surface-home-kiosk.zip"
  $extractPath = Join-Path $tempRoot "extract"
  $preservePath = Join-Path $tempRoot "preserve"

  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $extractPath | Out-Null
  New-Item -ItemType Directory -Force -Path $preservePath | Out-Null

  try {
    Write-Host "Downloading latest kiosk..."
    Invoke-WebRequest -Uri $RepoZipUrl -OutFile $zipPath

    Write-Host "Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

    $source = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
    if (-not $source) {
      throw "Could not find extracted repository folder."
    }

    if (Test-Path $InstallDirectory) {
      $config = Join-Path $InstallDirectory "public\kiosk-config.json"
      if (Test-Path $config) {
        New-Item -ItemType Directory -Force -Path (Join-Path $preservePath "public") | Out-Null
        Copy-Item $config (Join-Path $preservePath "public\kiosk-config.json") -Force
      }

      foreach ($folder in @("public\photos", "public\people", "camera-probe-output")) {
        $existing = Join-Path $InstallDirectory $folder
        if (Test-Path $existing) {
          $target = Join-Path $preservePath $folder
          New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
          Copy-Item $existing $target -Recurse -Force
        }
      }
    }

    New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
    Copy-Item -Path (Join-Path $source.FullName "*") -Destination $InstallDirectory -Recurse -Force

    if (Test-Path $preservePath) {
      Copy-Item -Path (Join-Path $preservePath "*") -Destination $InstallDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Refreshed $InstallDirectory"
  } finally {
    Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Enable-CodexSsh {
  $sshDir = Join-Path $env:USERPROFILE ".ssh"
  $authorizedKeys = Join-Path $sshDir "authorized_keys"

  New-Item -ItemType Directory -Force -Path $sshDir | Out-Null
  if (-not (Test-Path $authorizedKeys)) {
    New-Item -ItemType File -Force -Path $authorizedKeys | Out-Null
  }

  $existing = Get-Content $authorizedKeys -ErrorAction SilentlyContinue
  if ($existing -notcontains $CodexPublicKey) {
    Add-Content -Path $authorizedKeys -Value $CodexPublicKey
  }

  icacls $sshDir /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
  icacls $authorizedKeys /inheritance:r /grant:r "${env:USERNAME}:F" "SYSTEM:F" "Administrators:F" | Out-Null

  $service = Get-Service sshd -ErrorAction SilentlyContinue
  if ($service) {
    Start-Service sshd -ErrorAction SilentlyContinue
  }

  if (Test-IsAdmin) {
    Set-Service sshd -StartupType Automatic -ErrorAction SilentlyContinue

    if (-not (Get-NetFirewallRule -Name "sshd" -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule `
        -Name "sshd" `
        -DisplayName "OpenSSH Server" `
        -Enabled True `
        -Direction Inbound `
        -Protocol TCP `
        -Action Allow `
        -LocalPort 22 | Out-Null
    }

    Restart-Service sshd -ErrorAction SilentlyContinue
  }

  Write-Host "Codex SSH key installed for $env:USERNAME."
}

if (-not $SkipRefresh) {
  Refresh-Install
}

Enable-CodexSsh

if (-not $SkipInstall) {
  $installScript = Join-Path $InstallDirectory "scripts\Install-SurfaceHomeKiosk.ps1"
  if (Test-Path $installScript) {
    powershell -ExecutionPolicy Bypass -File $installScript
    if ($LASTEXITCODE -ne 0) {
      throw "Install script failed with exit code $LASTEXITCODE."
    }
  }
}

Write-Host ""
Write-Host "Remote setup complete."
Write-Host "Tell Codex to connect with: ssh -i ~/.ssh/surface_home_kiosk_ed25519 quinn@192.168.1.179"
