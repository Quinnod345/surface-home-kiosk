using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Windows.Media.Capture.Frames;

namespace SurfaceCameraBridge;

internal static class BridgeServer
{
    public static async Task RunAsync(string url, string kind, int intervalMs)
    {
        var sourceKind = CameraKinds.Parse(kind);
        using var listener = new HttpListener();
        listener.Prefixes.Add(url.EndsWith('/') ? url : $"{url}/");
        listener.Start();

        Console.WriteLine($"SurfaceCameraBridge listening on {string.Join(", ", listener.Prefixes)}");
        Console.WriteLine("Press Ctrl+C to stop.");

        while (true)
        {
            var context = await listener.GetContextAsync();
            _ = Task.Run(() => HandleAsync(context, sourceKind, intervalMs));
        }
    }

    private static async Task HandleAsync(
        HttpListenerContext context,
        MediaFrameSourceKind defaultKind,
        int intervalMs)
    {
        try
        {
            var path = context.Request.Url?.AbsolutePath ?? "/";

            if (path == "/probe")
            {
                await WriteJsonAsync(context, await CameraProbe.GetInventoryJsonAsync());
                return;
            }

            if (path == "/capture")
            {
                var kind = CameraKinds.Parse(context.Request.QueryString["kind"] ?? defaultKind.ToString());
                var png = await CameraCapture.CapturePngAsync(kind);
                context.Response.ContentType = "image/png";
                context.Response.ContentLength64 = png.Length;
                await context.Response.OutputStream.WriteAsync(png);
                context.Response.Close();
                return;
            }

            if (path == "/events" && context.Request.IsWebSocketRequest)
            {
                var socketContext = await context.AcceptWebSocketAsync(null);
                using var socket = socketContext.WebSocket;
                await StreamFramesAsync(socket, defaultKind, intervalMs);
                return;
            }

            context.Response.StatusCode = 404;
            context.Response.Close();
        }
        catch (Exception error)
        {
            if (context.Response.OutputStream.CanWrite)
            {
                context.Response.StatusCode = 500;
                await WriteJsonAsync(context, JsonSerializer.Serialize(new
                {
                    type = "error",
                    error = error.Message,
                }));
            }
        }
    }

    private static async Task StreamFramesAsync(
        WebSocket socket,
        MediaFrameSourceKind kind,
        int intervalMs)
    {
        // Open the camera once and stream the latest frame on each tick. Opening
        // a fresh MediaCapture per frame (the old behaviour) capped the rate at
        // roughly 1fps; a persistent session streams at the requested interval.
        CameraFrameSession? session = null;
        try
        {
            session = await CameraFrameSession.OpenAsync(kind);
            await session.WaitForFirstFrameAsync(4000);

            while (socket.State == WebSocketState.Open)
            {
                try
                {
                    using var bitmap = session.TryGetLatestCopy();
                    if (bitmap is not null)
                    {
                        var png = await CameraCapture.EncodePngAsync(bitmap);
                        await SendTextAsync(socket, JsonSerializer.Serialize(new
                        {
                            type = "frame",
                            sourceKind = kind.ToString(),
                            mimeType = "image/png",
                            imageBase64 = Convert.ToBase64String(png),
                            at = DateTimeOffset.UtcNow.ToString("O"),
                        }));
                    }
                }
                catch (Exception error)
                {
                    await SendTextAsync(socket, JsonSerializer.Serialize(new
                    {
                        type = "error",
                        error = error.Message,
                        at = DateTimeOffset.UtcNow.ToString("O"),
                    }));
                }

                await Task.Delay(intervalMs);
            }
        }
        catch (Exception error)
        {
            await SendTextAsync(socket, JsonSerializer.Serialize(new
            {
                type = "error",
                error = error.Message,
                at = DateTimeOffset.UtcNow.ToString("O"),
            }));
        }
        finally
        {
            session?.Dispose();
        }
    }

    private static async Task SendTextAsync(WebSocket socket, string payload)
    {
        var bytes = Encoding.UTF8.GetBytes(payload);
        await socket.SendAsync(
            bytes,
            WebSocketMessageType.Text,
            endOfMessage: true,
            CancellationToken.None);
    }

    private static async Task WriteJsonAsync(HttpListenerContext context, string json)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        context.Response.ContentType = "application/json";
        context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes);
        context.Response.Close();
    }
}
