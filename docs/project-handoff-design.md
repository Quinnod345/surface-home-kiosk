# Surface Home Kiosk Project Handoff and Design Document

Last updated: 2026-06-24  
Repository: `https://github.com/Quinnod345/surface-home-kiosk`  
Local Mac checkout: `/Users/quinnodonnell/Documents/New project/surface-home-kiosk`  
Surface install path: `C:\Users\Quinn\SurfaceHomeKiosk`  
Surface SSH target: `quinn@192.168.1.179` using the key `~/.ssh/surface_home_kiosk_ed25519`  
Home Assistant local API endpoint verified from the Surface: `https://192.168.1.82:8123`

Do not write secrets into the repository. The SSH password and Home Assistant
long-lived access token were provided during the live session but are
intentionally omitted from this document. The app stores user configuration and
enrollments in the Electron user-data local database on the Surface.

## One Paragraph Summary

This project is a Windows/Electron smart-home kiosk for a Surface Pro 4. It
runs full-screen, uses a photo slideshow as the normal idle surface, detects
motion/faces from the Surface camera stack, recognizes enrolled local face
embeddings for personalization/greetings, and talks to Home Assistant through a
long-lived access token. The latest implementation replaces the old Home
Assistant iframe-first experience with a native "Home center" dashboard that
polls Home Assistant entities, builds room/media/climate/camera controls, shows
doorbell/camera popups over the slideshow, and adds configurable screen
power/dimming behavior. The biggest open technical risk is the Surface Pro 4
Windows Hello IR path: the user observed that recognition appears to be using
only the RGB webcam, because it fails in the dark and the IR emitter does not
turn on.

## User Goal and Product Intent

The user wants the Surface Pro 4 to become a polished smart-home wall/tablet
kiosk:

- It should normally behave like a family photo frame.
- It should dim after inactivity, and optionally black out or return to photos
  depending on time of day and room brightness.
- It should wake when a face is presented or the screen is tapped.
- It should use the Surface camera/Windows Hello hardware as much as possible,
  especially the IR scanner/emitter so recognition can work in the dark.
- It should support local onboarding for face registration, creating local
  embeddings from captured samples.
- It should recognize enrolled people, say a welcome greeting, and switch into a
  personalized dashboard state.
- It should connect to Home Assistant using a long-lived access token.
- It should eventually feel like a native home center, not an embedded Home
  Assistant webpage.
- It should support doorbell/camera events: when configured motion/doorbell
  entities fire, the relevant camera should appear full-screen above everything
  else, with a path toward talk/mic support.
- It should be installable from GitHub with a short one-line command on the
  Surface.

## Current High-Level State

The latest functional app commit before this document is:

```text
6ec269c Build native home dashboard
```

That commit was pushed to GitHub `main`. The Surface was refreshed from the
GitHub ZIP after that push, using the existing bootstrap script. The refresh
completed successfully:

- Existing Surface install moved to backup:
  `C:\Users\Quinn\SurfaceHomeKiosk.backup-20260624-020206`
- New install copied to:
  `C:\Users\Quinn\SurfaceHomeKiosk`
- `npm ci` completed on the Surface.
- Face model files were copied into `dist/models`.
- `npm run build` completed successfully on the Surface.
- The native Surface camera bridge was published successfully.
- Scheduled task `Surface Home Kiosk` was registered.

Important truth line: after this install completed, the kiosk was not started
and visually verified in the live session. The next agent should start it and
inspect the actual UI/runtime before assuming the new dashboard works perfectly.

## Current Architecture

The app is a Vite + React + TypeScript frontend inside Electron. Electron owns
local persistence, Home Assistant API access, camera snapshot fetching, kiosk
window control, and optional Windows display-power control. React owns the
slideshow, setup/enrollment/test panels, face recognition flow, native home
dashboard, camera alert overlay, and screen-power state machine.

Core directories and files:

- `src/App.tsx`: main state machine and layout. This coordinates config,
  camera feed, native bridge frames, motion, face recognition, Home Assistant
  polling, dashboard/slideshow mode, camera alerts, hidden controls, and screen
  power behavior.
- `src/config.ts`: strongly typed kiosk configuration and defaults.
- `src/homeAssistant.ts`: browser/Electron Home Assistant helpers, entity state
  types, service calls, event firing, camera snapshot helper, display-name
  helpers.
- `src/useHomeAssistantStates.ts`: polling hook for `/api/states`.
- `src/HomeCenterDashboard.tsx`: native dashboard UI built from Home Assistant
  states.
- `src/CameraAlertOverlay.tsx`: full-screen camera popup layer.
- `src/SetupPanel.tsx`: app settings UI. Now includes Home Assistant, camera,
  face recognition, camera popup, and screen power settings.
- `src/EnrollmentPanel.tsx`: guided face enrollment.
- `src/faceApiRuntime.ts`: face-api model loading and descriptor extraction.
- `src/useFaceRecognition.ts`: recognition loop using browser video or native
  bridge frame data.
- `src/useCameraFeed.ts`: browser `getUserMedia` feed.
- `src/useNativeBridgeFrames.ts`: WebSocket client for the Windows camera
  bridge.
- `electron/main.ts`: Electron main process, local JSON state DB, IPC handlers,
  Home Assistant API bridge, certificate handling, display power hook.
- `electron/preload.ts` and `electron/preload.cjs`: exposed IPC surface for the
  renderer.
- `windows/SurfaceCameraBridge`: .NET 8 Windows camera bridge intended to
  access Surface camera frame sources, including infrared when available.
- `scripts/Bootstrap-SurfaceHomeKiosk.ps1`: one-line GitHub ZIP installer.
- `scripts/Install-SurfaceHomeKiosk.ps1`: install/build/register task script.
- `scripts/Start-SurfaceHomeKiosk.ps1`: starts camera bridge and Electron.
- `scripts/Probe-SurfaceCamera.ps1`: probe/capture helper for the Surface camera
  bridge.

## Persistence Model

Electron stores durable state in:

```text
C:\Users\Quinn\AppData\Roaming\SurfaceHomeKiosk\kiosk-state.json
```

That state DB can contain:

- `config`: the saved kiosk configuration from the in-app setup panel.
- `enrollments`: locally enrolled people and face descriptors.

The install folder has `public/kiosk-config.json`, but the Electron state DB is
the durable app-level source after the user saves settings in the app. This was
important because earlier rebuilds appeared to lose Home Assistant URL/token
settings. The current design preserves setup in the local app database rather
than relying only on files inside the install directory.

The setup panel shows the local database path after saving.

## Home Assistant Discovery and Current Facts

Home Assistant was inspected from the Surface/Mac during this work.

Endpoint facts:

- `192.168.1.82` responds to ping.
- Port `8123` is open.
- `https://192.168.1.82:8123/` is Home Assistant over HTTPS.
- The certificate is not trusted by Windows PowerShell by default.
- Port `443` on `192.168.1.82` did not respond from the Surface.
- The user's earlier "no port" URL can work externally, but the verified local
  API endpoint is `https://192.168.1.82:8123`.
- Home Assistant reported version `2026.2.1`.
- Home Assistant reported `internal_url: https://odohome.duckdns.org`.

API inspection:

- `/api/` works with the long-lived token.
- `/api/states` returned about 1926 states.
- WebSocket Lovelace config read worked.
- REST `/api/lovelace/config` returned Not Found.

Entity inventory from the session:

- Areas: basement, Basement Game Area, Basement Sitting Area, Bathroom, Bedroom,
  Deck, Dining Room, Entrance, Family Room, Family Room (4), Front Yard, Garage,
  Kitchen, Laundry Room, Living Room, Master Bedroom, Nora's Room, office,
  outside, Outside Light, Quinn's bedroom, Theater.
- Approximate domains: `sensor` 492, `device_tracker` 417, `button` 189,
  `light` 154, `binary_sensor` 132, `switch` 104, `update` 98,
  `media_player` 81, `camera` 6, `fan` 4, `climate` 2.
- Cameras observed:
  - `camera.side_2`
  - `camera.side_1`
  - `camera.driveway`
  - `camera.backyard`
  - `camera.first_led_hardware_instance` unavailable
  - `camera.roborock_qrevo_maxv_map` unavailable
- Camera-related binary sensors observed:
  - `binary_sensor.side_2_motion_detected`
  - `binary_sensor.side_2_person_detected`
  - `binary_sensor.side_1_motion_detected`
  - `binary_sensor.side_1_person_detected`
  - `binary_sensor.driveway_motion_detected`
  - `binary_sensor.driveway_person_detected`
  - `binary_sensor.backyard_motion_detected`
  - `binary_sensor.backyard_person_detected`
- Media examples:
  - `media_player.kitchen`
  - `media_player.entrance`
  - `media_player.family_room_4`
  - `media_player.family_room_3`
  - `media_player.master_bedroom_tv`
  - `media_player.house_speakers_2`
  - `media_player.home_theater`
- Kitchen lights observed:
  - `light.kitchen_island`
  - `light.kitchen_table`
  - `light.kitchen_overhead`
  - `light.all_kitchen_lights`
  - `light.kitchen_sink`
  - `light.kitchen_island_2`

Lovelace views discovered through WebSocket:

- Home: `vertical-stack`, `grid`
- Media: `custom:button-card`, `custom:xiaomi-vacuum-map-card`,
  `vertical-stack`
- TV: no cards
- settings: `custom:button-card`, `entities`
- Kitchen: `custom:button-card`, `grid`, `vertical-stack`
- Family room: `custom:button-card`, `vertical-stack`
- Bedroom: `custom:button-card`, `vertical-stack`, `conditional`,
  `custom:gap-card`
- Basement: `custom:button-card`, `grid`, `vertical-stack`
- test: `custom:vertical-stack-in-card`, `grid`
- Dining Room: `custom:button-card`, `vertical-stack`

## Home Assistant API Bridge

The app now uses Electron IPC for Home Assistant APIs:

- `ha:test`: calls `/api/`.
- `ha:fire-event`: posts to `/api/events/{eventType}`.
- `ha:call-service`: posts to `/api/services/{domain}/{service}`.
- `ha:get-states`: gets `/api/states`.
- `ha:get-state`: gets `/api/states/{entity_id}`.
- `ha:get-camera-snapshot`: fetches `/api/camera_proxy/{camera_entity_id}` with
  the bearer token and returns a data URL to the renderer.

The renderer calls these through `window.surfaceKiosk` from the preload scripts.

Certificate behavior:

- `homeAssistant.allowSelfSignedCertificate` defaults to `true`.
- Electron's `session.defaultSession.setCertificateVerifyProc` allows the
  configured Home Assistant hosts.
- Home Assistant iframe headers were previously relaxed, but the new native
  dashboard no longer depends on an iframe for the main experience.

Potential issue:

- Electron `net.fetch` is used for HA calls because it respects Electron's
  certificate/session behavior better than Node fetch for this kiosk. If future
  HA calls fail on the self-signed local IP, inspect `electron/main.ts` first.

## Native Dashboard Design

The old UI used a full-screen Home Assistant iframe. The current native
dashboard implementation lives in `src/HomeCenterDashboard.tsx`.

Design goals:

- No top-left overlay, because Home Assistant sidebars/buttons had previously
  been covered there.
- Two equal columns on desktop/tablet-sized surfaces.
- Left column: rooms, media, camera shortcuts.
- Right column: climate and fan controls.
- Native visual styling rather than Lovelace iframe styling.
- Dense, scannable, utilitarian layout appropriate for a home-control panel.
- Use Home Assistant long-lived token and API instead of scraping Lovelace.
- Keep controls ergonomic for touch.

Current behavior:

- Polls `/api/states` every 5 seconds with `useHomeAssistantStates`.
- Infers room groups from entity IDs and friendly names using keywords:
  Kitchen, Family Room, Living Room, Bedroom, Master Bedroom, Quinn's Bedroom,
  Basement, Dining Room, Theater, Garage, Outside.
- Room cards show active counts for lights/switches/sensors/etc.
- Room light button toggles a primary light/switch. It prefers entity names
  matching `all`, `group`, `overhead`, or `main`, otherwise first entity in that
  room/domain.
- Media rows show active media players first and call
  `media_player.media_play_pause`.
- Climate cards read `temperature`, `target_temp_high`, or
  `current_temperature`, and call `climate.set_temperature` for +/- controls.
- Fan cards call `fan.toggle` and `fan.set_percentage`.
- Camera shortcuts open the camera alert overlay.

Limitations:

- Room grouping is heuristic, not based on the Home Assistant entity registry's
  area IDs yet. This works quickly but should eventually be replaced with real
  `/api/config/entity_registry/list`/WebSocket registry data or a cached area
  map if the agent wants exact composition.
- Service calls are generic. They do not yet account for per-device quirks,
  unsupported features, or disabled entity services.
- The UI was production-built on Surface but not visually verified after the
  install.

## Slideshow and Hidden Controls

The normal idle surface is still the photo slideshow:

- `mode === "idle"` shows `.idle-stage`.
- `mode === "dashboard"` shows `.dashboard-stage`.
- The slideshow uses `config.slideshow.photos`, filtering to image extensions.
- The fallback photo surface is a generated CSS background if no photos exist.

Controls behavior:

- The old always-visible top rail was removed.
- A centered identity/status pill remains at the top center.
- Invisible corner hot zones exist in:
  - top-right
  - bottom-left
  - bottom-right
- There is deliberately no top-left hot zone/control.
- Tapping a corner hot zone reveals the control dock for about 7 seconds.
- The control dock includes photos, dashboard, enroll face, recognition test,
  setup, fullscreen/kiosk, and reload actions.

Open improvement:

- The user asked that tapping the corners "where they usually are" should fade
  controls in and then allow interaction. Current implementation reveals a
  top-right control dock. It may be worth adding secondary docks near bottom
  corners or making reveal origin depend on the hot zone tapped.

## Face Recognition and Personalization

The app uses `@vladmandic/face-api` models and local face descriptors.

Completed earlier:

- Fixed model packaging so `.bin` model files are copied from
  `@vladmandic/face-api`.
- `checkModels()` now expects `.bin` files.
- Surface model test previously verified `Models loaded.`
- Enrollment stores local people/descriptors in Electron state DB.
- The app has a guided enrollment panel with preview, outline, quality hints,
  multiple samples, and local descriptor storage.

Current face behavior in `src/App.tsx`:

- Any detected face updates `lastFaceSeenAtRef`.
- Any detected face wakes the screen.
- A recognized enrolled person:
  - sets `activePersonId`;
  - speaks `Welcome, {displayName}.` unless overridden by `person.greeting`;
  - fires `surface_kiosk_person_recognized`;
  - optionally writes active person to a configured HA `input_text`;
  - enters dashboard mode if configured.
- Active person resets to no face after `behavior.faceResetMs`.
- Default `behavior.faceResetMs` is 120 seconds.
- No-face photo return is controlled by `behavior.photosAfterNoFaceMs`.
- Default `behavior.photosAfterNoFaceMs` is 30 seconds.

Important nuance:

- There is still a speech greeting cooldown (`faceRecognition.greetCooldownMs`)
  to avoid repeated TTS loops for the same person. The user explicitly said
  there should not be a cooldown between faces. The state transition does not
  intentionally block switching between people, but the greeting cooldown may
  need another pass if the user wants immediate greeting on every person change.

## Camera Alert / Doorbell Overlay

The camera alert layer lives in `src/CameraAlertOverlay.tsx`.

Current behavior:

- Highest z-index full-screen overlay.
- Sits above dashboard and photos.
- Photos do not cover it.
- Polls camera snapshots through Electron IPC using the HA bearer token.
- Uses `/api/camera_proxy/{camera_entity_id}` and converts the result to a data
  URL.
- Refresh interval is configurable: `cameraOverlay.snapshotRefreshMs`.
- Auto-dismiss interval is configurable: `cameraOverlay.dismissAfterMs`.
- Manual camera shortcuts from the dashboard can open the overlay.
- HA binary sensors can trigger it automatically.

Trigger config:

```json
"cameraOverlay": {
  "enabled": true,
  "triggerEntityIds": [],
  "cameraBindings": [],
  "defaultCameraEntityId": "camera.driveway",
  "talkEntityId": "button.some_talk_button",
  "dismissAfterMs": 120000,
  "snapshotRefreshMs": 2000
}
```

If `triggerEntityIds` is empty, the app uses a heuristic for binary sensors
that look like driveway/side/backyard/front/doorbell motion/person sensors.
Explicit settings should eventually be preferred in this home because the known
good triggers are:

- `binary_sensor.side_2_motion_detected`
- `binary_sensor.side_2_person_detected`
- `binary_sensor.side_1_motion_detected`
- `binary_sensor.side_1_person_detected`
- `binary_sensor.driveway_motion_detected`
- `binary_sensor.driveway_person_detected`
- `binary_sensor.backyard_motion_detected`
- `binary_sensor.backyard_person_detected`

Suggested camera bindings:

```text
binary_sensor.side_2_motion_detected = camera.side_2
binary_sensor.side_2_person_detected = camera.side_2
binary_sensor.side_1_motion_detected = camera.side_1
binary_sensor.side_1_person_detected = camera.side_1
binary_sensor.driveway_motion_detected = camera.driveway
binary_sensor.driveway_person_detected = camera.driveway
binary_sensor.backyard_motion_detected = camera.backyard
binary_sensor.backyard_person_detected = camera.backyard
```

Talk support:

- The overlay has a Talk button.
- The Talk button is disabled unless `cameraOverlay.talkEntityId` is configured.
- If configured, the app infers the service:
  - `button.*` -> `button.press`
  - `switch.*` or `input_boolean.*` -> `toggle`
  - otherwise -> `turn_on`
- This is only a hook. Real two-way audio depends on the camera integration and
  how Home Assistant exposes talk/mic controls. This should be verified against
  the user's actual camera integration.

## Screen Power / Dimming Behavior

Added in the latest pass in response to the user's interjection.

Config section:

```json
"screenPower": {
  "enabled": true,
  "dimAfterMs": 30000,
  "dimOpacity": 0.5,
  "deepSleepAfterMs": 120000,
  "deepSleepAction": "photos",
  "deepSleepCondition": "either",
  "quietHoursStart": "22:30",
  "quietHoursEnd": "06:30",
  "ambientLightEntityId": "sensor.some_illuminance",
  "ambientLightThresholdLux": 8,
  "useWindowsDisplayPower": false
}
```

Current behavior:

- If no face is detected and no taps occur for `dimAfterMs`, the app shows a
  black overlay with opacity `dimOpacity`.
- This is relative visual dimming, not actual panel brightness scaling. The
  user's wording was "if the display is on 85%, dim halfway between 85 and
  zero"; the current practical equivalent is a 50% black overlay.
- If idle continues past `deepSleepAfterMs`, the app checks the configured
  condition:
  - `never`
  - `quiet-hours`
  - `ambient-dark`
  - `either`
  - `both`
- If condition passes, the action is:
  - `dim`: stay dim
  - `photos`: return to slideshow/photos
  - `blackout`: full black overlay, optionally ask Windows to power off the
    display
- If `useWindowsDisplayPower` is true and action is `blackout`, Electron calls a
  Windows PowerShell/User32 `SendMessage` monitor power command.
- Face detection and taps call the shared `wakeScreen()` path, clearing the
  overlay and asking Windows to power the display on if it had been powered off.

Ambient light:

- The app currently uses a Home Assistant illuminance/lux entity if configured.
- It does not yet read a Surface ambient-light sensor directly.
- If the user wants device-local ambient light, add it to the .NET native bridge
  or a small Windows sensor bridge and feed it into Electron.

Important caveat:

- Physical Windows display power-off from a kiosk process can be hardware and
  policy dependent. The in-app blackout overlay is reliable. The physical
  monitor-off command must be tested on the Surface.

## Installer / Deployment State

GitHub one-line install:

```powershell
irm https://raw.githubusercontent.com/Quinnod345/surface-home-kiosk/main/scripts/Bootstrap-SurfaceHomeKiosk.ps1 | iex
```

Manual Surface refresh used during this session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Quinn\SurfaceHomeKiosk\scripts\Bootstrap-SurfaceHomeKiosk.ps1" -HomeAssistantUrl "https://192.168.1.82:8123" -DashboardUrl "https://192.168.1.82:8123/lovelace/default_view?kiosk" -SkipPrerequisiteInstall
```

That first attempt failed because the running kiosk/bridge had files open. The
successful refresh stopped Electron and `SurfaceCameraBridge`, copied the
bootstrap script to temp, then ran it from outside the install folder.

Successful SSH command pattern:

```powershell
Get-Process electron,SurfaceCameraBridge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$tempScript = Join-Path $env:TEMP 'Bootstrap-SurfaceHomeKiosk.ps1'
Copy-Item 'C:\Users\Quinn\SurfaceHomeKiosk\scripts\Bootstrap-SurfaceHomeKiosk.ps1' $tempScript -Force
& $tempScript -HomeAssistantUrl 'https://192.168.1.82:8123' -DashboardUrl 'https://192.168.1.82:8123/lovelace/default_view?kiosk' -SkipPrerequisiteInstall
```

To start after install:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\Quinn\SurfaceHomeKiosk\scripts\Start-SurfaceHomeKiosk.ps1"
```

To inspect logs:

```powershell
Get-Content "C:\Users\Quinn\SurfaceHomeKiosk\surface-home-kiosk.error.log" -Tail 200
Get-Content "C:\Users\Quinn\SurfaceHomeKiosk\surface-home-kiosk.log" -Tail 200
Get-Content "C:\Users\Quinn\SurfaceHomeKiosk\surface-camera-bridge.error.log" -Tail 200
Get-Content "C:\Users\Quinn\SurfaceHomeKiosk\surface-camera-bridge.log" -Tail 200
```

To verify app state:

```powershell
Get-Process electron,SurfaceCameraBridge -ErrorAction SilentlyContinue
Test-Path "C:\Users\Quinn\AppData\Roaming\SurfaceHomeKiosk\kiosk-state.json"
Get-Content "C:\Users\Quinn\AppData\Roaming\SurfaceHomeKiosk\kiosk-state.json" -Raw
```

Do not print the token into chat/logs if reading this state file.

## Local Development Caveats

On the Mac during the latest session:

- `node --version` returned `v25.5.0`.
- `tsc --version` returned `5.5.3`.
- `vite --version` was killed with exit code 137.
- `npm run build`, `npx tsc`, and TypeScript parser probes hung locally.
- Some git commands were slow because background Xcode git diff processes were
  running against the repo.

The Surface build is the trusted build verification for the latest commit:

- Surface Node: `v24.18.0`
- Surface npm: `11.16.0`
- Surface `npm run build`: succeeded
- Surface Vite build transformed 1597 modules and completed in about 9.67s.

## Current Untracked / Local Files

The local Mac checkout has a pre-existing untracked duplicate:

```text
src/EnrollmentPanel 2.tsx
```

It was intentionally not staged or committed. Do not delete or fold it in unless
the user asks or you inspect and confirm it is safe.

## Windows Hello / IR Camera Addendum

This is the newest and most important unresolved technical issue from the user:

> The app seems to be only using the webcam. When the lights are off, it cannot
> see me. The IR emitter does not appear to turn on. Normal Windows Hello works
> in the dark, so the Surface IR blaster/sensor should be doing something, but
> this app is not activating it.

### What Is Known

- The current app has two image sources:
  - Browser camera through Electron/getUserMedia.
  - Native bridge frames through `windows/SurfaceCameraBridge`, consumed by
    `src/useNativeBridgeFrames.ts`.
- The config default has:
  - `nativeBridge.enabled: true`
  - `nativeBridge.url: ws://127.0.0.1:8765/events`
  - `nativeBridge.preferredSourceKind: Infrared`
- `Start-SurfaceHomeKiosk.ps1` starts `SurfaceCameraBridge.exe serve --kind
  Infrared --url http://127.0.0.1:8765/`.
- The app should prefer native bridge frames for enrollment/recognition if the
  bridge produces them. If the bridge is unavailable or not producing frames, it
  falls back to browser camera frames.
- The user's observation strongly suggests the fallback path is being used, or
  the native bridge is capturing a non-illuminated/non-IR stream.

### Important Platform Reality

Windows Hello itself should not be treated as a general-purpose continuous
person-recognition API. Windows Hello can verify the signed-in Windows user and
can prompt for consent/verification, but it does not expose enrolled Hello face
templates or a continuous "this family member is Quinn" stream to arbitrary
kiosk apps.

However, the Surface Pro 4's underlying camera hardware may expose infrared or
depth frame sources through Windows media APIs. The project already has a .NET
bridge intended to access those frame sources. The open question is whether the
Surface Pro 4 driver exposes a usable IR stream and whether the IR emitter can
be activated from a non-Hello app.

### Diagnosis Plan For The Next Agent

Run these on the Surface first:

```powershell
cd "C:\Users\Quinn\SurfaceHomeKiosk"
powershell -ExecutionPolicy Bypass -File scripts\Probe-SurfaceCamera.ps1
```

Then inspect the probe output and logs:

```powershell
Get-Content .\surface-camera-bridge.log -Tail 200
Get-Content .\surface-camera-bridge.error.log -Tail 200
Get-ChildItem .\camera-probe-output -Recurse
```

Direct bridge commands if needed:

```powershell
cd "C:\Users\Quinn\SurfaceHomeKiosk\windows\SurfaceCameraBridge"
dotnet run -- probe
dotnet run -- capture --kind Infrared --out "$env:TEMP\surface-ir.png"
dotnet run -- serve --kind Infrared --url "http://127.0.0.1:8765/"
```

What to check:

- Does `probe` list any `Infrared` frame source?
- Does it list any `Depth` frame source?
- Does it list multiple front camera groups?
- Does `capture --kind Infrared` create a real image?
- In a dark room, does the captured image show a face?
- Does the IR emitter visibly turn on during `capture` or `serve`?
- Does the bridge log say it selected an infrared source or did it silently
  fall back?
- Does the app's status pill show the native bridge as connected?
- Does `useFaceRecognition` receive `nativeBridge.frame?.dataUrl`?
- Does enrollment preview use the bridge image or the browser video?

### Likely Code Areas For IR Fix

Start in the .NET bridge:

- `windows/SurfaceCameraBridge/CameraProbe.cs`
- `windows/SurfaceCameraBridge/CameraCapture.cs`
- `windows/SurfaceCameraBridge/CameraFrameSession.cs`
- `windows/SurfaceCameraBridge/BridgeServer.cs`
- `windows/SurfaceCameraBridge/CameraModels.cs`

Then inspect the renderer bridge consumer:

- `src/useNativeBridgeFrames.ts`
- `src/useFaceRecognition.ts`
- `src/EnrollmentPanel.tsx`
- `src/faceApiRuntime.ts`
- `src/App.tsx`

Potential bridge-side fixes to investigate:

- Ensure `MediaFrameSourceGroup` selection is preferring the Surface Windows
  Hello front camera group rather than the RGB webcam group.
- Ensure `MediaFrameSourceKind.Infrared` is not being confused with color
  preview streams.
- Consider whether the bridge should prefer `Depth` or another source kind if
  true IR is not exposed as `Infrared`.
- Try `MediaCaptureInitializationSettings.SharingMode =
  MediaCaptureSharingMode.ExclusiveControl` for diagnosis. This may conflict
  with Windows Hello or other camera consumers, but it can reveal whether shared
  mode is blocking emitter/control access.
- Check whether Windows privacy settings allow desktop apps to access camera.
- Check whether another process is holding the camera.
- Verify current Surface firmware/drivers and Windows Hello Face driver stack.
- Check Device Manager names for:
  - Surface Camera Front
  - Microsoft IR Camera Front
  - Windows Hello Face Software Device
  - Intel AVStream Camera entries
- Add detailed bridge logging: selected group ID, source ID, source kind, media
  encoding subtype, resolution, frame rate, and whether frames are arriving.
- Add a "bridge frame preview" debug panel in the app so the user can visually
  confirm whether the app sees IR frames.
- Temporarily disable browser camera fallback so failures are obvious instead
  of quietly using RGB.

Potential renderer-side fixes:

- In `useFaceRecognition`, make the current source explicit in debug status:
  `browser-color`, `native-infrared`, `native-depth`, or `none`.
- In `EnrollmentPanel`, show source label over the preview.
- If the native bridge frame exists, prefer it consistently for preview,
  enrollment, and recognition.
- If face-api does not work well on raw IR images, add preprocessing:
  grayscale/contrast normalization, resize, maybe invert depending on IR image
  format.
- If face-api cannot handle the IR stream reliably, use the IR stream only for
  presence/wake and keep recognition on RGB, or move to a model trained/tuned
  for IR/depth.

### Possible Outcomes

Outcome A: The Surface exposes usable IR frames and the emitter turns on.

- Fix the bridge selection and app preview so native IR frames are clearly used.
- Keep browser camera as fallback only.
- Add a setup/test button: "Test IR in dark room."
- Add an on-screen source indicator in the recognition test panel.

Outcome B: The Surface exposes an IR/depth stream but not the emitter.

- Investigate exclusive control and driver/firmware.
- See whether Windows Hello service has exclusive control.
- Decide whether the app can use passive IR/depth or if it needs external
  hardware.

Outcome C: The Windows Hello IR camera is not accessible to third-party apps in
the needed way.

- Keep Windows Hello for OS-level sign-in/verification only.
- Use RGB/local face embeddings for personalization in lit conditions.
- Use Home Assistant/Frigate/camera presence for ambient wake.
- Consider an external USB IR camera if dark-room local recognition is a hard
  requirement.

## Product Backlog / Next Work

Priority 0: verify latest installed app.

- Start the kiosk on the Surface.
- Open the app with remote debugging if needed.
- Confirm the native dashboard renders instead of the old iframe.
- Confirm setup values persisted in the Electron state DB.
- Confirm Home Assistant states load over `https://192.168.1.82:8123`.
- Confirm room cards, media cards, climate/fan controls render with real
  entities.
- Confirm service calls work for harmless controls.
- Confirm hidden corner controls reveal and do not cover top-left.
- Confirm camera overlay opens from dashboard camera shortcut.
- Confirm camera overlay snapshot loads through the Electron HA proxy.
- Confirm screen dim overlay appears after configured inactivity.
- Confirm taps/faces wake the dim overlay.

Priority 1: IR camera diagnosis.

- Run the probe/capture plan above.
- Decide whether current native bridge can access real IR/depth frames.
- Make source selection visible in UI.
- Disable silent fallback during diagnostics.
- Fix the bridge or document platform limitation.

Priority 2: custom dashboard fidelity.

- Replace room heuristics with real Home Assistant area/entity registry data.
- Add per-room detail drilldowns.
- Add better light controls: brightness, color temp, scenes.
- Add climate feature detection before showing +/- controls.
- Add media volume controls and now-playing art when available.
- Add fan preset controls if entities expose presets.
- Add lock/sensitive-action guardrails.

Priority 3: camera/doorbell.

- Save suggested trigger/camera bindings in app settings on the Surface.
- Verify the exact camera entities support snapshots or streaming.
- If snapshots are too slow, implement authenticated MJPEG/HLS proxy in
  Electron main.
- Implement real talk support for the actual HA camera integration.
- Add camera overlay manual dismissal/retrigger behavior tests.

Priority 4: screen power.

- Test Windows display power-off/on on the Surface.
- Add a direct brightness control if Windows exposes a usable display brightness
  API for this device.
- Add Surface ambient light sensor bridge if present.
- Add separate day/evening/night policies instead of only quiet hours.

Priority 5: install and robustness.

- Make bootstrap better at refreshing a running install:
  - copy itself to temp automatically;
  - stop kiosk/bridge before moving install folder;
  - preserve local logs or write backup path;
  - show a short final "start now" command.
- Add an explicit "refresh from GitHub" script inside the app/install folder.
- Consider packaging Electron into a Windows app/exe installer.
- Add crash recovery and health status.

## Suggested Immediate Commands For Next Agent

From the Mac/Codex environment:

```sh
ssh -i ~/.ssh/surface_home_kiosk_ed25519 -o StrictHostKeyChecking=no quinn@192.168.1.179 \
  'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Quinn\SurfaceHomeKiosk\scripts\Start-SurfaceHomeKiosk.ps1"'
```

Then inspect processes/logs:

```sh
ssh -i ~/.ssh/surface_home_kiosk_ed25519 -o StrictHostKeyChecking=no quinn@192.168.1.179 \
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process electron,SurfaceCameraBridge -ErrorAction SilentlyContinue; Get-Content C:\Users\Quinn\SurfaceHomeKiosk\surface-home-kiosk.error.log -Tail 80; Get-Content C:\Users\Quinn\SurfaceHomeKiosk\surface-camera-bridge.error.log -Tail 80"'
```

If remote debugging is enabled on port 9222, inspect Electron:

```sh
ssh -i ~/.ssh/surface_home_kiosk_ed25519 -o StrictHostKeyChecking=no quinn@192.168.1.179 \
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest http://127.0.0.1:9222/json/version -UseBasicParsing | Select-Object -ExpandProperty Content"'
```

Run IR probe:

```sh
ssh -i ~/.ssh/surface_home_kiosk_ed25519 -o StrictHostKeyChecking=no quinn@192.168.1.179 \
  'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Quinn\SurfaceHomeKiosk\scripts\Probe-SurfaceCamera.ps1"'
```

## Git Notes

The native dashboard work was committed and pushed as:

```text
6ec269c Build native home dashboard
```

This document should be committed separately after creation. If this file is the
only change, a good commit message is:

```text
Document project handoff and IR camera backlog
```

## Final Cautions

- Do not rely on ambient face recognition for security-sensitive actions like
  unlocking doors or disarming alarms.
- Do not print or commit the Home Assistant long-lived token.
- Do not print or commit the SSH password.
- Treat Windows Hello as an OS verification boundary, not a source of reusable
  biometric templates.
- The user cares about the real Surface behavior. Always verify on the Surface,
  with the actual camera hardware and Home Assistant instance, before calling a
  change complete.
