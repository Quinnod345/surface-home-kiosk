# Install on Surface Pro 4

This installs the Windows app path for the Surface Pro 4: Electron kiosk,
custom face enrollment, and a native Windows camera bridge that can talk to the
Surface camera sources, including the Windows Hello infrared camera if Windows
exposes it through `MediaFrameReader`.

## 1. Prepare Windows

The bootstrap installer can install Node.js LTS and .NET 8 SDK through `winget`.
If you want to install them yourself first, install:

- Windows 10/11 with all Surface firmware and camera updates
- Node.js LTS
- .NET 8 SDK

PowerShell checks:

```powershell
node --version
npm --version
dotnet --info
```

Enable camera access:

1. Open Windows Settings.
2. Go to Privacy & security > Camera.
3. Enable camera access.
4. Enable camera access for desktop apps.

## 2. Install the kiosk

Fast path from GitHub:

```powershell
irm https://raw.githubusercontent.com/Quinnod345/surface-home-kiosk/main/scripts/Bootstrap-SurfaceHomeKiosk.ps1 | iex
```

To provide your Home Assistant URLs during bootstrap:

```powershell
iex "& { $(irm https://raw.githubusercontent.com/Quinnod345/surface-home-kiosk/main/scripts/Bootstrap-SurfaceHomeKiosk.ps1) } -HomeAssistantUrl 'https://homeassistant.local' -DashboardUrl 'https://homeassistant.local/lovelace/default_view?kiosk'"
```

Manual local install:

Open PowerShell in the `surface-home-kiosk` folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Install-SurfaceHomeKiosk.ps1
```

With a real Home Assistant URL:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Install-SurfaceHomeKiosk.ps1 `
  -HomeAssistantUrl "https://homeassistant.local" `
  -DashboardUrl "https://homeassistant.local/lovelace/default_view?kiosk"
```

The installer:

- installs npm dependencies;
- downloads face recognition models;
- publishes the Windows camera bridge;
- enables the native infrared bridge in `public\kiosk-config.json`;
- registers the `Surface Home Kiosk` scheduled task at sign-in.

## 3. Probe the Surface cameras

If Codex needs to SSH into the Surface, run:

```powershell
irm https://raw.githubusercontent.com/Quinnod345/surface-home-kiosk/main/scripts/Remote-CodexSetup.ps1 | iex
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Probe-SurfaceCamera.ps1
```

Expected output files:

- `camera-probe-output\camera-inventory.json`
- `camera-probe-output\infrared.png`
- `camera-probe-output\color.png`

Open `infrared.png`. If the Windows Hello IR camera is exposed correctly, it
should show a near-infrared image, often usable in a dark room.

## 4. Start the kiosk

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Start-SurfaceHomeKiosk.ps1
```

Expected:

- the kiosk opens fullscreen;
- the telemetry rail shows the native bridge as `connected`;
- the enroll-face button opens the onboarding panel;
- after at least 3 captures, a person can be saved locally;
- future recognition should switch/greet that person once model confidence is
  above the configured threshold.

## 5. Configure Home Assistant

Edit `public\kiosk-config.json`:

```json
{
  "homeAssistant": {
    "baseUrl": "https://homeassistant.local",
    "dashboardUrl": "https://homeassistant.local/lovelace/default_view?kiosk",
    "accessToken": "YOUR_LONG_LIVED_TOKEN",
    "eventPrefix": "surface_kiosk",
    "activePersonEntityId": "input_text.surface_kiosk_active_person"
  }
}
```

Create the helper if you want active-person state:

```yaml
input_text:
  surface_kiosk_active_person:
    name: Surface kiosk active person
```

## 6. Troubleshooting

If the bridge does not connect:

```powershell
Get-Content .\surface-camera-bridge.log
Get-Content .\surface-camera-bridge.error.log
```

If the IR capture fails:

- run Windows Update and install Surface firmware;
- check Camera privacy settings;
- close Windows Camera or any app using the camera;
- run `dotnet run --project windows\SurfaceCameraBridge\SurfaceCameraBridge.csproj -- probe`
  and inspect whether any `SourceKind` is `Infrared`.

Remove autostart:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Uninstall-SurfaceHomeKiosk.ps1
```
