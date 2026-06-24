# Surface Home Kiosk

A fullscreen Electron kiosk for a Surface Pro used as a Home Assistant tablet.
It shows family photos while idle, opens a Home Assistant dashboard on touch or
close face presence, detects room motion from the front camera, and can greet
known people once face recognition models and reference photos are installed.

The current hardware target is a **Surface Pro 4**, so the design uses a hybrid
approach: Windows Hello for real Windows-user verification/sign-in, and the
kiosk camera layer for ambient room presence. See
`docs/surface-pro-4-windows-hello.md`.

## Run locally

```sh
npm install
npm run dev
```

Use the fullscreen button in the top-right rail while testing. On the Surface,
start the app with:

```sh
SURFACE_KIOSK=1 npm start
```

On Windows PowerShell:

```powershell
$env:SURFACE_KIOSK="1"
npm start
```

## Install on the Surface

Full guide: `docs/install-surface-pro-4.md`.

One-line install from GitHub:

```powershell
irm https://raw.githubusercontent.com/Quinnod345/surface-home-kiosk/main/scripts/Bootstrap-SurfaceHomeKiosk.ps1 | iex
```

Refresh an existing install and enable Codex SSH:

```powershell
irm https://raw.githubusercontent.com/Quinnod345/surface-home-kiosk/main/scripts/Remote-CodexSetup.ps1 | iex
```

From PowerShell in this folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Install-SurfaceHomeKiosk.ps1
powershell -ExecutionPolicy Bypass -File scripts\Probe-SurfaceCamera.ps1
powershell -ExecutionPolicy Bypass -File scripts\Start-SurfaceHomeKiosk.ps1
```

The installer installs Node.js LTS and .NET 8 SDK through `winget` when missing,
installs npm dependencies, downloads face models, publishes the camera bridge,
enables the native IR bridge in `public/kiosk-config.json`, and registers a
sign-in scheduled task.

## Configure

Edit `public/kiosk-config.json` for development, or copy it to Electron's
user-data config path shown in the setup strip on first launch.

Important fields:

- `homeAssistant.baseUrl`: your Home Assistant origin, for example
  `https://homeassistant.local`.
- `homeAssistant.dashboardUrl`: the Lovelace dashboard to show in the kiosk.
- `homeAssistant.accessToken`: a long-lived token from a constrained Home
  Assistant user.
- `slideshow.photos`: photo URLs under `public/photos`.
- `people[].dashboardPath`: per-person dashboard path.
- `people[].referenceImageUrls`: reference photos for face recognition.

If Home Assistant refuses to load in the iframe, add this to
`configuration.yaml` and restart Home Assistant:

```yaml
http:
  use_x_frame_options: false
```

## Home Assistant helpers

Create an optional helper for the active person:

```yaml
input_text:
  surface_kiosk_active_person:
    name: Surface kiosk active person
```

The app fires these Home Assistant events:

- `surface_kiosk_dashboard_opened`
- `surface_kiosk_slideshow_opened`
- `surface_kiosk_occupancy_changed`
- `surface_kiosk_person_recognized`

Example automation:

```yaml
alias: Surface kiosk greeting lights
trigger:
  - platform: event
    event_type: surface_kiosk_person_recognized
action:
  - service: light.turn_on
    target:
      entity_id: light.kitchen
    data:
      brightness_pct: 60
```

## Face recognition

Download the model files:

```sh
npm run download:face-models
```

Add clear, consented reference photos under `public/people/`, then enable:

```json
"faceRecognition": {
  "enabled": true
}
```

Face recognition here is for personalization and greetings, not physical
security. Keep automations reversible and low-risk.

### On-device enrollment

Use the person-add button in the top rail to enroll a person from the tablet.
The app captures multiple face descriptors from the live camera and stores them
locally in browser storage under `surface-home-kiosk.enrollments.v1`.

For the Surface Pro 4 IR/Windows Hello camera path, run the Windows bridge first:

```powershell
cd windows\SurfaceCameraBridge
dotnet run -- probe
dotnet run -- capture --kind Infrared --out ir.png
dotnet run -- serve --kind Infrared
```

The bridge is documented in `windows/README.md`.

Enable it in `public/kiosk-config.json`:

```json
"nativeBridge": {
  "enabled": true,
  "url": "ws://127.0.0.1:8765/events",
  "preferredSourceKind": "Infrared"
}
```

When enabled, the kiosk prefers native bridge frames for enrollment and
recognition. If the bridge is disabled or unavailable, it falls back to the
browser camera path.

## Surface Pro 4 setup notes

Do not flash custom firmware first. For a Surface Pro 4, the practical route is:

1. Install current Surface firmware/drivers via Windows Update or Microsoft's
   Surface driver package.
2. Enroll Windows Hello Face for each Windows account/person who should get a
   personal dashboard.
3. Create per-person Home Assistant dashboards and map each Windows account to
   the right dashboard in the kiosk config.
4. Install Node.js LTS or package this app after the MVP stabilizes.
5. Put the Surface on a trusted VLAN or isolated IoT network.
6. Disable sleep, enable screen dimming, and launch this app at sign-in.
