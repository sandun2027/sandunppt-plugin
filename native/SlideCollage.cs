using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Sandun.PresentationBootstrap
{
    internal static class SlideCollage
    {
        private static byte[] watermarkImage;
        internal static string Execute(Dictionary<string, object> o)
        {
            string action = FontUnifier.Value(o, "action", "save");
            if (action == "image")
            {
                using (var picker = new OpenFileDialog { Title = "选择水印图片", Filter = "图片|*.png;*.jpg;*.jpeg;*.bmp" })
                {
                    if (picker.ShowDialog() != DialogResult.OK) return "";
                    LoadWatermarkImage(picker.FileName);
                    return Path.GetFileName(picker.FileName);
                }
            }
            string path = null;
            if (action != "preview")
            {
                path = NativeTools.SaveDestination("PPT 拼图 · 另存为", "PNG 图片|*.png|JPEG 图片|*.jpg", "PPT拼图.png");
                if (string.IsNullOrEmpty(path)) return "已取消保存";
            }
            var slides = ResolveSlides(o);
            int width = (int)NativeTools.Number(o, "width", 1200, 200, 12000);
            int columns = (int)NativeTools.Number(o, "columns", 2, 1, 12);
            int margin = (int)NativeTools.Number(o, "margin", 24, 0, 1000), gap = (int)NativeTools.Number(o, "gap", 12, 0, 1000);
            double ratio = (double)(float)NativeTools.Deck.PageSetup.SlideHeight / (float)NativeTools.Deck.PageSetup.SlideWidth;
            var cells = Layout(slides.Count, width, columns, margin, gap, ratio, NativeTools.Flag(o, "cover", false), NativeTools.Flag(o, "back", false), NativeTools.Flag(o, "pad", true));
            int height = (int)Math.Ceiling(cells.Max(c => c.Bottom)) + margin;
            if ((long)width * height > 80000000 || height > 60000) throw new ArgumentException("拼图过大，请减小宽度、增加列数或减少页数。");
            double scale = action == "preview" ? Math.Min(1, Math.Min(1100.0 / width, 1800.0 / height)) : 1;
            string temp = Path.Combine(Path.GetTempPath(), "sandun-collage-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temp);
            try
            {
                using (var bitmap = new Bitmap(Math.Max(1, (int)Math.Round(width * scale)), Math.Max(1, (int)Math.Round(height * scale))))
                using (var graphics = Graphics.FromImage(bitmap))
                {
                    DrawBackground(graphics, bitmap.Width, bitmap.Height, scale, o);
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic; graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    for (int i = 0; i < slides.Count; i++)
                    {
                        RectangleF cell = cells[i]; var dest = new RectangleF((float)(cell.X * scale), (float)(cell.Y * scale), (float)(cell.Width * scale), (float)(cell.Height * scale));
                        string page = Path.Combine(temp, i + ".png");
                        slides[i].Export(page, "PNG", Math.Max(1, (int)Math.Ceiling(dest.Width)), Math.Max(1, (int)Math.Ceiling(dest.Height)));
                        float radius = (float)(NativeTools.Number(o, "cardRadius", 0, 0, 64) * scale);
                        using (var outline = CardOutline(dest, radius))
                        {
                            if (NativeTools.Flag(o, "cardShadow", false))
                            {
                                for (int blur = 10; blur >= 1; blur--)
                                {
                                    float spread = (float)(blur * scale); var shadow = dest; shadow.Inflate(spread, spread); shadow.Offset(0, (float)(5 * scale));
                                    using (var shadowPath = CardOutline(shadow, radius + spread)) using (var brush = new SolidBrush(Color.FromArgb(5, 10, 20, 35))) graphics.FillPath(brush, shadowPath);
                                }
                            }
                            var state = graphics.Save(); graphics.SetClip(outline);
                            using (var image = Image.FromFile(page)) graphics.DrawImage(image, dest);
                            graphics.Restore(state);
                        }
                    }
                    Watermark(graphics, bitmap.Width, bitmap.Height, scale, o);
                    if (action == "preview") using (var data = new MemoryStream())
                    {
                        bitmap.Save(data, ImageFormat.Png);
                        return new JavaScriptSerializer { MaxJsonLength = 16000000 }.Serialize(new { preview = "data:image/png;base64," + Convert.ToBase64String(data.ToArray()), width = width, height = height, slides = slides.Count });
                    }
                    bitmap.Save(path, Path.GetExtension(path).Equals(".png", StringComparison.OrdinalIgnoreCase) ? ImageFormat.Png : ImageFormat.Jpeg);
                    return "已导出 " + slides.Count + " 页拼图（" + width + " × " + height + " px）：" + path;
                }
            }
            finally { Directory.Delete(temp, true); }
        }
        internal static void LoadWatermarkImage(string path)
        {
            using (var loaded = Image.FromFile(path))
            using (var copy = new Bitmap(loaded))
            using (var data = new MemoryStream()) { copy.Save(data, ImageFormat.Png); watermarkImage = data.ToArray(); }
        }
        private static GraphicsPath CardOutline(RectangleF rect, float radius)
        {
            var path = new GraphicsPath(); float d = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
            if (d < .1) { path.AddRectangle(rect); return path; }
            path.AddArc(rect.Left, rect.Top, d, d, 180, 90); path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90); path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90); path.CloseFigure(); return path;
        }
        private static void DrawBackground(Graphics graphics, int width, int height, double scale, Dictionary<string, object> o)
        {
            if (FontUnifier.Value(o, "backgroundStyle", "solid") == "solid") { graphics.Clear(ColorTranslator.FromHtml(FontUnifier.Value(o, "background", "#FFFFFF"))); return; }
            var colors = FontUnifier.Value(o, "backgroundColors", "#A9ADB4,#505660,#171A20").Split(',').Select(ColorTranslator.FromHtml).ToArray();
            if (colors.Length != 3) throw new ArgumentException("背景渐变需要三种颜色。");
            var bounds = new Rectangle(0, 0, width, height);
            using (var gradient = new LinearGradientBrush(bounds, colors[0], colors[2], (float)NativeTools.Number(o, "backgroundAngle", 145, 0, 360) - 90))
            {
                gradient.InterpolationColors = new ColorBlend { Colors = colors, Positions = new[] { 0f, .52f, 1f } }; graphics.FillRectangle(gradient, bounds);
            }
            using (var ellipse = new GraphicsPath())
            {
                ellipse.AddEllipse(-width * .4f, -height * .2f, width * 1.3f, height * .9f);
                using (var glow = new PathGradientBrush(ellipse)) { glow.CenterColor = Color.FromArgb(36, Color.White); glow.SurroundColors = new[] { Color.Transparent }; graphics.FillPath(glow, ellipse); }
            }
            string texture = FontUnifier.Value(o, "texture", "none");
            if (texture == "grain")
            {
                using (var tile = new Bitmap(128, 128))
                {
                    var random = new Random(2718);
                    for (int y = 0; y < 128; y++) for (int x = 0; x < 128; x++) tile.SetPixel(x, y, Color.FromArgb(random.Next(0, 12), random.Next(2) == 0 ? Color.White : Color.Black));
                    using (var brush = new TextureBrush(tile)) { brush.ScaleTransform((float)scale, (float)scale); graphics.FillRectangle(brush, bounds); }
                }
            }
            else if (texture == "grid" || texture == "dots")
            {
                float step = Math.Max(2, (float)(32 * scale));
                using (var pen = new Pen(Color.FromArgb(19, Color.White), Math.Max(.3f, (float)scale)))
                using (var brush = new SolidBrush(Color.FromArgb(36, 61, 93, 100)))
                {
                    for (float x = step / 2; x < width; x += step)
                    {
                        if (texture == "grid") graphics.DrawLine(pen, x, 0, x, height);
                        else for (float y = step / 2; y < height; y += step) graphics.FillEllipse(brush, x, y, (float)(2 * scale), (float)(2 * scale));
                    }
                    if (texture == "grid") for (float y = step / 2; y < height; y += step) graphics.DrawLine(pen, 0, y, width, y);
                }
            }
        }
        internal static List<dynamic> ResolveSlides(Dictionary<string, object> o)
        {
            string scope = FontUnifier.Value(o, "scope", "all");
            List<dynamic> result;
            if (scope == "range")
            {
                result = new List<dynamic>(); var seen = new HashSet<int>(); int count = NativeTools.Deck.Slides.Count;
                foreach (string part in FontUnifier.Value(o, "range", "").Replace('，', ',').Split(','))
                {
                    var bounds = part.Trim().Split('-'); int first, last;
                    if (bounds.Length > 2 || !int.TryParse(bounds[0], out first)) throw new ArgumentException("页码格式如：1-4,6,8-10。");
                    last = first;
                    if (bounds.Length == 2 && !int.TryParse(bounds[1], out last)) throw new ArgumentException("请输入正确的结束页码。");
                    if (first < 1 || last < first || last > count) throw new ArgumentException("页码超出当前文稿范围。");
                    for (int i = first; i <= last; i++) if (seen.Add(i)) result.Add(NativeTools.Deck.Slides.Item(i));
                }
            }
            else if (scope == "all" || scope == "selected") result = NativeTools.Slides(scope == "all");
            else throw new ArgumentException("未知的幻灯片范围。");
            if (!NativeTools.Flag(o, "hidden", false)) result = result.Where(s => (int)s.SlideShowTransition.Hidden == 0).ToList();
            if (result.Count == 0) throw new ArgumentException("当前范围没有可导出的页面，请检查隐藏页设置。");
            return result;
        }
        internal static List<RectangleF> Layout(int count, int width, int columns, int margin, int gap, double ratio, bool cover, bool back, bool pad)
        {
            double inner = width - 2 * margin, tile = (inner - (columns - 1) * gap) / columns;
            if (count < 1 || tile < 16) throw new ArgumentException("边距或间距过大，页面宽度不足。");
            var result = new List<RectangleF>(); double y = margin; int index = 0;
            if (cover) { result.Add(new RectangleF(margin, (float)y, (float)inner, (float)(inner * ratio))); y += inner * ratio + gap; index++; }
            int end = back && count > index ? count - 1 : count;
            while (index < end)
            {
                int n = Math.Min(columns, end - index); double w = !pad && n < columns ? (inner - (n - 1) * gap) / n : tile;
                for (int col = 0; col < n; col++) result.Add(new RectangleF((float)(margin + col * (w + gap)), (float)y, (float)w, (float)(w * ratio)));
                y += w * ratio + gap; index += n;
            }
            if (index < count) result.Add(new RectangleF(margin, (float)y, (float)inner, (float)(inner * ratio)));
            return result;
        }
        private static void Watermark(Graphics graphics, int width, int height, double scale, Dictionary<string, object> o)
        {
            string type = FontUnifier.Value(o, "watermark", "none"); if (type == "none") return;
            float opacity = (float)(1 - NativeTools.Number(o, "transparency", 70, 0, 100) / 100);
            float angle = (float)NativeTools.Number(o, "rotation", -30, -180, 180);
            float size = (float)(NativeTools.Number(o, "fontSize", 32, 6, 500) * scale);
            float density = (float)NativeTools.Number(o, "density", 40, 0, 100);
            using (var path = new GraphicsPath())
            {
                Image picture = null; MemoryStream pictureStream = null;
                try
                {
                    float stampWidth, stampHeight;
                    if (type == "image")
                    {
                        if (watermarkImage == null) throw new ArgumentException("请先选择水印图片。");
                        pictureStream = new MemoryStream(watermarkImage); picture = Image.FromStream(pictureStream);
                        stampWidth = Math.Max(1, size * 5); stampHeight = stampWidth * picture.Height / picture.Width;
                    }
                    else
                    {
                        string text = FontUnifier.Value(o, "text", "SANDUN");
                        if (string.IsNullOrWhiteSpace(text)) throw new ArgumentException("请输入水印文字。");
                        using (var family = new FontFamily(FontUnifier.Value(o, "font", "Arial"))) path.AddString(text, family, 0, size, PointF.Empty, StringFormat.GenericTypographic);
                        var bounds = path.GetBounds(); using (var matrix = new Matrix()) { matrix.Translate(-bounds.X - bounds.Width / 2, -bounds.Y - bounds.Height / 2); path.Transform(matrix); }
                        stampWidth = Math.Max(size, bounds.Width); stampHeight = Math.Max(size, bounds.Height);
                    }
                    bool repeated = type == "pattern" || type == "image";
                    float spacing = 1.1f + (100 - density) / 30;
                    float dx = Math.Max(12, stampWidth * spacing), dy = Math.Max(12, stampHeight * spacing * 1.5f);
                    long stamps = (long)Math.Ceiling(width / dx + 2) * (long)Math.Ceiling(height / dy + 2);
                    if (repeated && stamps > 30000) throw new ArgumentException("水印过密，请增大字号或降低密度。");
                    for (float y = repeated ? dy / 2 : height / 2; y < height; y += repeated ? dy : height)
                    for (float x = repeated ? dx / 2 : width / 2; x < width; x += repeated ? dx : width)
                    {
                        var state = graphics.Save(); graphics.TranslateTransform(x, y); graphics.RotateTransform(angle);
                        if (picture != null) using (var attrs = new ImageAttributes())
                        {
                            var colorMatrix = new ColorMatrix(); colorMatrix.Matrix33 = opacity; attrs.SetColorMatrix(colorMatrix);
                            graphics.DrawImage(picture, new Rectangle((int)(-stampWidth / 2), (int)(-stampHeight / 2), (int)stampWidth, (int)stampHeight), 0, 0, picture.Width, picture.Height, GraphicsUnit.Pixel, attrs);
                        }
                        else
                        {
                            float outline = (float)(NativeTools.Number(o, "outlineWidth", 0, 0, 20) * scale);
                            if (outline > 0) using (var pen = new Pen(Color.FromArgb((int)(255 * opacity), ColorTranslator.FromHtml(FontUnifier.Value(o, "outlineColor", "#FFFFFF"))), outline)) { pen.LineJoin = LineJoin.Round; graphics.DrawPath(pen, path); }
                            using (var brush = new SolidBrush(Color.FromArgb((int)(255 * opacity), ColorTranslator.FromHtml(FontUnifier.Value(o, "textColor", "#808080"))))) graphics.FillPath(brush, path);
                        }
                        graphics.Restore(state);
                    }
                }
                finally { if (picture != null) picture.Dispose(); if (pictureStream != null) pictureStream.Dispose(); }
            }
        }
    }
}
