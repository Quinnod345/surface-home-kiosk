using Windows.Graphics.Imaging;
using Windows.Media.Capture;
using Windows.Media.Capture.Frames;

namespace SurfaceCameraBridge;

internal sealed class CameraFrameSession : IDisposable
{
    private readonly MediaCapture _capture;
    private readonly MediaFrameReader _reader;
    private readonly SemaphoreSlim _frameSignal = new(0, 1);
    private readonly object _gate = new();
    private SoftwareBitmap? _latestBitmap;

    // Diagnostics about the most recent raw frame, captured before conversion so
    // IR/Depth format issues are visible in the bridge logs.
    public string? LastFrameInfo { get; private set; }
    public MediaFrameSource Source { get; }

    private CameraFrameSession(MediaCapture capture, MediaFrameReader reader, MediaFrameSource source)
    {
        _capture = capture;
        _reader = reader;
        Source = source;
        _reader.FrameArrived += OnFrameArrived;
    }

    public static async Task<CameraFrameSession> OpenAsync(MediaFrameSourceKind kind)
    {
        var (capture, source) = await CameraProbe.OpenFirstAsync(kind);
        var reader = await capture.CreateFrameReaderAsync(source);
        var status = await reader.StartAsync();

        if (status != MediaFrameReaderStartStatus.Success)
        {
            capture.Dispose();
            throw new InvalidOperationException($"Frame reader failed to start: {status}");
        }

        return new CameraFrameSession(capture, reader, source);
    }

    public async Task<SoftwareBitmap> CaptureSoftwareBitmapAsync(int timeoutMs)
    {
        using var timeout = new CancellationTokenSource(timeoutMs);
        await _frameSignal.WaitAsync(timeout.Token);

        lock (_gate)
        {
            if (_latestBitmap is null)
            {
                throw new InvalidOperationException("No bitmap was captured.");
            }

            // Copy under the lock so a concurrent FrameArrived cannot dispose the
            // bitmap mid-copy. The 60fps IR stream makes that race near-certain.
            return SoftwareBitmap.Copy(_latestBitmap);
        }
    }

    private void OnFrameArrived(MediaFrameReader sender, MediaFrameArrivedEventArgs args)
    {
        using var frame = sender.TryAcquireLatestFrame();
        var source = frame?.VideoMediaFrame?.SoftwareBitmap;
        if (source is null) return;

        // IR/Depth frames arrive as NV12 or grayscale and can be backed by the
        // frame's memory, which is only valid inside this callback. Normalize to
        // Bgra8 here so the stored bitmap is self-contained and encodable.
        SoftwareBitmap normalized;
        try
        {
            if (source.PixelWidth <= 0 || source.PixelHeight <= 0)
            {
                return;
            }

            normalized = source.BitmapPixelFormat == BitmapPixelFormat.Bgra8 &&
                         source.BitmapAlphaMode == BitmapAlphaMode.Premultiplied
                ? SoftwareBitmap.Copy(source)
                : SoftwareBitmap.Convert(
                    source,
                    BitmapPixelFormat.Bgra8,
                    BitmapAlphaMode.Premultiplied);
        }
        catch
        {
            // Skip a single malformed frame rather than tearing down the session.
            return;
        }

        if (LastFrameInfo is null)
        {
            LastFrameInfo =
                $"{source.BitmapPixelFormat} {source.PixelWidth}x{source.PixelHeight}";
            Console.Error.WriteLine(
                $"[bridge] first frame: kind={Source.Info.SourceKind} format={LastFrameInfo}");
        }

        lock (_gate)
        {
            _latestBitmap?.Dispose();
            _latestBitmap = normalized;
        }

        if (_frameSignal.CurrentCount == 0)
        {
            _frameSignal.Release();
        }
    }

    public void Dispose()
    {
        _reader.FrameArrived -= OnFrameArrived;
        _reader.StopAsync().AsTask().Wait(TimeSpan.FromSeconds(1));
        _reader.Dispose();
        _capture.Dispose();

        lock (_gate)
        {
            _latestBitmap?.Dispose();
            _latestBitmap = null;
        }

        _frameSignal.Dispose();
    }
}
