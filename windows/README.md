# Surface Camera Bridge

This Windows-only helper talks to the Surface camera stack through
`Windows.Media.Capture.Frames`. It is meant to run on the Surface Pro 4 and prove
that the Windows Hello near-infrared camera can be enumerated and captured before
we build the full recognition pipeline on top.

## Requirements

- Windows 10/11 on the Surface Pro 4
- .NET 8 SDK
- Camera privacy enabled for desktop apps
- Surface camera/Windows Hello drivers installed

## Commands

```powershell
cd windows\SurfaceCameraBridge
dotnet run -- probe
dotnet run -- capture --kind Infrared --out ir.png
dotnet run -- capture --kind Color --out color.png
dotnet run -- serve --kind Infrared
```

`probe` prints JSON with every camera source group, source kind, current format,
and supported formats. The source we want should show up as `Infrared`, often
with a device name like `Microsoft IR Camera Front`.

`capture` writes a single PNG frame. Use this first to confirm that the IR
emitter and sensor path actually work.

`serve` exposes:

- `GET http://127.0.0.1:8765/probe`
- `GET http://127.0.0.1:8765/capture?kind=Infrared`
- `WS ws://127.0.0.1:8765/events`

The WebSocket currently sends PNG frames as base64 JSON payloads. That is simple
and debuggable; after the probe succeeds, we can optimize the bridge to stream
lower-latency frames or run ONNX recognition inside the native process.

## Use with the kiosk

After `serve` is running, set this in `public/kiosk-config.json`:

```json
"nativeBridge": {
  "enabled": true,
  "url": "ws://127.0.0.1:8765/events",
  "preferredSourceKind": "Infrared"
}
```

Then start the kiosk. The top telemetry rail should show the native bridge as
`connected`, and enrollment/recognition will prefer bridge frames over the
browser camera when frames are available.
