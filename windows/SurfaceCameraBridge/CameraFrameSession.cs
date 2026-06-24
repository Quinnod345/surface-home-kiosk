using Windows.Graphics.Imaging;
using Windows.Media.Capture;
using Windows.Media.Capture.Frames;

namespace SurfaceCameraBridge;

internal sealed class CameraFrameSession : IDisposable
{
    private readonly MediaCapture _capture;
    private readonly MediaFrameReader _reader;
    private readonly SemaphoreSlim _frameSignal = new(0, 1);
    private SoftwareBitmap? _latestBitmap;

    private CameraFrameSession(MediaCapture capture, MediaFrameReader reader)
    {
        _capture = capture;
        _reader = reader;
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

        return new CameraFrameSession(capture, reader);
    }

    public async Task<SoftwareBitmap> CaptureSoftwareBitmapAsync(int timeoutMs)
    {
        using var timeout = new CancellationTokenSource(timeoutMs);
        await _frameSignal.WaitAsync(timeout.Token);

        return _latestBitmap is null
            ? throw new InvalidOperationException("No bitmap was captured.")
            : SoftwareBitmap.Copy(_latestBitmap);
    }

    private void OnFrameArrived(MediaFrameReader sender, MediaFrameArrivedEventArgs args)
    {
        using var frame = sender.TryAcquireLatestFrame();
        var bitmap = frame?.VideoMediaFrame?.SoftwareBitmap;
        if (bitmap is null) return;

        _latestBitmap?.Dispose();
        _latestBitmap = SoftwareBitmap.Copy(bitmap);

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
        _latestBitmap?.Dispose();
        _frameSignal.Dispose();
    }
}
