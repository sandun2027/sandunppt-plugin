using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace Sandun.PresentationBootstrap
{
    internal sealed class GeneratedImageFile
    {
        internal byte[] Bytes;
        internal string Extension;

        internal static GeneratedImageFile Read(string dataUrl)
        {
            if (string.IsNullOrEmpty(dataUrl) || dataUrl.Length > 32 * 1024 * 1024) throw new ArgumentException("图片为空或过大。");
            bool png = dataUrl.StartsWith("data:image/png;base64,", StringComparison.OrdinalIgnoreCase);
            if (!png && !dataUrl.StartsWith("data:image/jpeg;base64,", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("图片必须使用 PNG 或 JPEG 格式。");
            byte[] bytes = Convert.FromBase64String(dataUrl.Substring(dataUrl.IndexOf(',') + 1));
            using (var stream = new MemoryStream(bytes))
            using (var image = Image.FromStream(stream, false, true)) {
                if (image.RawFormat.Guid != (png ? ImageFormat.Png : ImageFormat.Jpeg).Guid) throw new ArgumentException("图片内容与格式不符。");
            }
            return new GeneratedImageFile { Bytes = bytes, Extension = png ? ".png" : ".jpg" };
        }

        internal void CropToCover(float width, float height)
        {
            using (var stream = new MemoryStream(Bytes))
            using (var image = Image.FromStream(stream)) {
                double ratio = width / height;
                int cropW = image.Width, cropH = image.Height;
                if (cropW / (double)cropH > ratio) cropW = Math.Max(1, (int)Math.Round(cropH * ratio));
                else cropH = Math.Max(1, (int)Math.Round(cropW / ratio));
                if (cropW == image.Width && cropH == image.Height) return;
                // Match the preview's centered object-fit: cover without stretching the image.
                using (var cropped = new Bitmap(cropW, cropH))
                using (var graphics = Graphics.FromImage(cropped))
                using (var output = new MemoryStream()) {
                    graphics.DrawImage(image, new Rectangle(0, 0, cropW, cropH), new Rectangle((image.Width - cropW) / 2, (image.Height - cropH) / 2, cropW, cropH), GraphicsUnit.Pixel);
                    cropped.Save(output, ImageFormat.Png);
                    Bytes = output.ToArray(); Extension = ".png";
                }
            }
        }

        internal static string Save(string dataUrl, string suggestedName)
        {
            var image = Read(dataUrl);
            string name = suggestedName ?? "SANDUN AI 图片";
            foreach (char invalid in Path.GetInvalidFileNameChars()) name = name.Replace(invalid, '_');
            name = name.Trim().TrimEnd('.');
            if (name.Length > 100) name = name.Substring(0, 100);
            if (string.IsNullOrWhiteSpace(name)) name = "SANDUN AI 图片";
            string format = image.Extension == ".png" ? "PNG 图片 (*.png)|*.png" : "JPEG 图片 (*.jpg)|*.jpg";
            string path = NativeTools.SaveDestination("保存为文件", format, name + image.Extension);
            if (string.IsNullOrEmpty(path)) return "";
            File.WriteAllBytes(path, image.Bytes);
            return path;
        }
    }
}
