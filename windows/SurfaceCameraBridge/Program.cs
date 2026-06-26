using SurfaceCameraBridge;

var command = args.FirstOrDefault()?.ToLowerInvariant() ?? "help";

try
{
    switch (command)
    {
        case "probe":
            await CameraProbe.PrintJsonAsync();
            break;

        case "capture":
            await CameraCapture.CaptureAsync(
                kind: Args.Value(args, "--kind") ?? "Infrared",
                outputPath: Args.Value(args, "--out") ?? "surface-camera-capture.png",
                timeoutMs: Args.IntValue(args, "--timeout-ms") ?? 4000);
            break;

        case "serve":
            await BridgeServer.RunAsync(
                url: Args.Value(args, "--url") ?? "http://127.0.0.1:8765/",
                kind: Args.Value(args, "--kind") ?? "Infrared",
                intervalMs: Args.IntValue(args, "--interval-ms") ?? 250);
            break;

        default:
            PrintHelp();
            break;
    }
}
catch (Exception error)
{
    Console.Error.WriteLine(error);
    Environment.ExitCode = 1;
}

static void PrintHelp()
{
    Console.WriteLine("""
    SurfaceCameraBridge

    Commands:
      probe
        Print JSON describing all MediaFrameSourceGroup camera sources.

      capture --kind Infrared --out ir.png
        Capture one frame from the first matching Color/Infrared/Depth source.

      serve --url http://127.0.0.1:8765/ --kind Infrared --interval-ms 900
        Start a local HTTP/WebSocket bridge.

    Endpoints in serve mode:
      GET /probe
      GET /capture?kind=Infrared
      WS  /events
    """);
}
