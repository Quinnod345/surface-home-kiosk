using System.Text.Json;
using Windows.Media.Capture;
using Windows.Media.Capture.Frames;
using Windows.Media.MediaProperties;

namespace SurfaceCameraBridge;

internal static class CameraProbe
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    public static async Task PrintJsonAsync()
    {
        var inventory = await GetInventoryAsync();
        Console.WriteLine(JsonSerializer.Serialize(inventory, JsonOptions));
    }

    public static async Task<string> GetInventoryJsonAsync()
    {
        var inventory = await GetInventoryAsync();
        return JsonSerializer.Serialize(inventory, JsonOptions);
    }

    public static async Task<CameraInventory> GetInventoryAsync()
    {
        var groups = await MediaFrameSourceGroup.FindAllAsync();
        var output = new List<CameraGroupInfo>();

        foreach (var group in groups)
        {
            output.Add(await DescribeGroupAsync(group));
        }

        return new CameraInventory(DateTimeOffset.UtcNow.ToString("O"), output);
    }

    public static async Task<(MediaCapture Capture, MediaFrameSource Source)> OpenFirstAsync(
        MediaFrameSourceKind desiredKind)
    {
        var groups = await MediaFrameSourceGroup.FindAllAsync();

        foreach (var group in groups)
        {
            if (!group.SourceInfos.Any(source => source.SourceKind == desiredKind))
            {
                continue;
            }

            var capture = new MediaCapture();
            await capture.InitializeAsync(new MediaCaptureInitializationSettings
            {
                SourceGroup = group,
                SharingMode = MediaCaptureSharingMode.SharedReadOnly,
                StreamingCaptureMode = StreamingCaptureMode.Video,
                MemoryPreference = MediaCaptureMemoryPreference.Cpu,
            });

            var source = capture.FrameSources.Values.FirstOrDefault(
                candidate => candidate.Info.SourceKind == desiredKind);
            if (source is not null)
            {
                Console.Error.WriteLine(
                    $"[bridge] selected {desiredKind} source in group '{group.DisplayName}' " +
                    $"(sourceId={source.Info.Id}, format={Format(source.CurrentFormat)})");
                return (capture, source);
            }

            capture.Dispose();
        }

        throw new InvalidOperationException($"No {desiredKind} camera source was found.");
    }

    private static async Task<CameraGroupInfo> DescribeGroupAsync(MediaFrameSourceGroup group)
    {
        try
        {
            using var capture = new MediaCapture();
            await capture.InitializeAsync(new MediaCaptureInitializationSettings
            {
                SourceGroup = group,
                SharingMode = MediaCaptureSharingMode.SharedReadOnly,
                StreamingCaptureMode = StreamingCaptureMode.Video,
                MemoryPreference = MediaCaptureMemoryPreference.Cpu,
            });

            var sources = capture.FrameSources.Values
                .Where(source => CameraKinds.IsCameraKind(source.Info.SourceKind))
                .Select(DescribeSource)
                .ToList();

            return new CameraGroupInfo(group.Id, group.DisplayName, sources);
        }
        catch (Exception error)
        {
            var sources = group.SourceInfos
                .Where(source => CameraKinds.IsCameraKind(source.SourceKind))
                .Select(source => new CameraSourceInfo(
                    source.Id,
                    source.DeviceInformation?.Name,
                    source.SourceKind.ToString(),
                    source.MediaStreamType.ToString(),
                    null,
                    Array.Empty<string>()))
                .ToList();

            return new CameraGroupInfo(
                group.Id,
                group.DisplayName,
                sources,
                error.Message);
        }
    }

    private static CameraSourceInfo DescribeSource(MediaFrameSource source)
    {
        return new CameraSourceInfo(
            source.Info.Id,
            source.Info.DeviceInformation?.Name,
            source.Info.SourceKind.ToString(),
            source.Info.MediaStreamType.ToString(),
            Format(source.CurrentFormat),
            source.SupportedFormats.Select(Format).ToList());
    }

    private static string Format(MediaFrameFormat format)
    {
        var video = format.VideoFormat;
        var rate = format.FrameRate;
        var fps = rate.Denominator == 0 ? 0 : (double)rate.Numerator / rate.Denominator;
        return $"{format.Subtype} {video.Width}x{video.Height} {fps:0.##}fps";
    }
}
