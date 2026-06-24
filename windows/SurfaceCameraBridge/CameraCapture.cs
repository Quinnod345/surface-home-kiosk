using Windows.Graphics.Imaging;
using Windows.Media.Capture.Frames;
using Windows.Storage;

namespace SurfaceCameraBridge;

internal static class CameraCapture
{
    public static async Task CaptureAsync(string kind, string outputPath, int timeoutMs)
    {
        var bytes = await CapturePngAsync(CameraKinds.Parse(kind), timeoutMs);
        var fullPath = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        await File.WriteAllBytesAsync(fullPath, bytes);
        Console.WriteLine(fullPath);
    }

    public static async Task<byte[]> CapturePngAsync(
        MediaFrameSourceKind kind,
        int timeoutMs = 4000)
    {
        using var session = await CameraFrameSession.OpenAsync(kind);
        var bitmap = await session.CaptureSoftwareBitmapAsync(timeoutMs);
        return await EncodePngAsync(bitmap);
    }

    public static async Task<byte[]> EncodePngAsync(SoftwareBitmap bitmap)
    {
        using var encoded = new MemoryStream();
        var tempPath = Path.Combine(Path.GetTempPath(), $"surface-camera-{Guid.NewGuid():N}.png");

        try
        {
            var folder = await StorageFolder.GetFolderFromPathAsync(Path.GetDirectoryName(tempPath));
            var file = await folder.CreateFileAsync(
                Path.GetFileName(tempPath),
                CreationCollisionOption.ReplaceExisting);

            using (var stream = await file.OpenAsync(FileAccessMode.ReadWrite))
            {
                var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
                var writable = bitmap;
                if (bitmap.BitmapPixelFormat != BitmapPixelFormat.Bgra8 ||
                    bitmap.BitmapAlphaMode != BitmapAlphaMode.Premultiplied)
                {
                    writable = SoftwareBitmap.Convert(
                        bitmap,
                        BitmapPixelFormat.Bgra8,
                        BitmapAlphaMode.Premultiplied);
                }

                encoder.SetSoftwareBitmap(writable);
                await encoder.FlushAsync();
            }

            return await File.ReadAllBytesAsync(tempPath);
        }
        finally
        {
            try
            {
                File.Delete(tempPath);
            }
            catch
            {
                // Best-effort cleanup of a diagnostic capture file.
            }
        }
    }
}
