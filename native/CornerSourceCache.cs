using System;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace Sandun.PresentationBootstrap
{
    internal static class CornerSourceCache
    {
        private const string Prefix = "SANDUN_ROUND_";
        internal static string Read(dynamic shape)
        {
            int count;
            if (!int.TryParse((string)shape.Tags.Item(Prefix + "COUNT"), out count) || count < 1 || count > 1024) return null;
            var hex = new StringBuilder();
            for (int i = 0; i < count; i++) hex.Append((string)shape.Tags.Item(Prefix + i.ToString("D4")));
            var bytes = new byte[hex.Length / 2];
            for (int i = 0; i < bytes.Length; i++) bytes[i] = Convert.ToByte(hex.ToString(i * 2, 2), 16);
            using (var stream = new GZipStream(new MemoryStream(bytes), CompressionMode.Decompress))
            using (var reader = new StreamReader(stream, Encoding.UTF8)) return reader.ReadToEnd();
        }
        internal static void Write(dynamic shape, string geometry)
        {
            byte[] bytes;
            using (var stream = new MemoryStream())
            {
                using (var zip = new GZipStream(stream, CompressionMode.Compress, true))
                { var input = Encoding.UTF8.GetBytes(geometry); zip.Write(input, 0, input.Length); }
                bytes = stream.ToArray();
            }
            // Office uppercases tag values. Hex survives that normalization and stays
            // with the shape across save/reopen, so another radius starts from its original corners.
            string hex = BitConverter.ToString(bytes).Replace("-", ""); int count = (hex.Length + 239) / 240;
            shape.Tags.Add(Prefix + "COUNT", count.ToString());
            for (int i = 0; i < count; i++) shape.Tags.Add(Prefix + i.ToString("D4"), hex.Substring(i * 240, Math.Min(240, hex.Length - i * 240)));
        }
    }
}
