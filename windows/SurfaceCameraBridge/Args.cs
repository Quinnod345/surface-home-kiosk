namespace SurfaceCameraBridge;

internal static class Args
{
    public static string? Value(string[] args, string key)
    {
        var index = Array.IndexOf(args, key);
        if (index < 0 || index + 1 >= args.Length) return null;
        return args[index + 1];
    }

    public static int? IntValue(string[] args, string key)
    {
        return int.TryParse(Value(args, key), out var value) ? value : null;
    }
}
