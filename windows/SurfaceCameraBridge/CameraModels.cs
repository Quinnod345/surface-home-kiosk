using Windows.Media.Capture.Frames;

namespace SurfaceCameraBridge;

internal sealed record CameraInventory(
    string GeneratedAt,
    IReadOnlyList<CameraGroupInfo> Groups);

internal sealed record CameraGroupInfo(
    string Id,
    string DisplayName,
    IReadOnlyList<CameraSourceInfo> Sources,
    string? Error = null);

internal sealed record CameraSourceInfo(
    string Id,
    string? DeviceName,
    string SourceKind,
    string MediaStreamType,
    string? CurrentFormat,
    IReadOnlyList<string> SupportedFormats);

internal static class CameraKinds
{
    public static MediaFrameSourceKind Parse(string value)
    {
        return Enum.TryParse<MediaFrameSourceKind>(value, ignoreCase: true, out var kind)
            ? kind
            : MediaFrameSourceKind.Infrared;
    }

    public static bool IsCameraKind(MediaFrameSourceKind kind)
    {
        return kind is MediaFrameSourceKind.Color
            or MediaFrameSourceKind.Infrared
            or MediaFrameSourceKind.Depth;
    }
}
