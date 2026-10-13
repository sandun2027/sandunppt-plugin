using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Xml;

namespace Sandun.PresentationBootstrap
{
    internal static class SvgInsertion
    {
        public sealed class Target
        {
            public string presentation { get; set; }
            public int slideId { get; set; }
            public int shapeId { get; set; }
        }
        internal static string CaptureTarget()
        {
            try { return new JavaScriptSerializer().Serialize(new Target { presentation = (string)NativeTools.Deck.FullName, slideId = (int)NativeTools.Slide.SlideID }); }
            catch { throw new InvalidOperationException("请先打开演示文稿并选择要插入的幻灯片。"); }
        }
        internal static string Insert(string svg, string targetJson, string label)
        {
            var target = new JavaScriptSerializer().Deserialize<Target>(targetJson);
            if (target == null || string.IsNullOrEmpty(target.presentation)) throw new ArgumentException("未找到生成时选择的幻灯片。");
            var doc = Validate(svg);
            dynamic deck = null, slide = null, previous = null;
            foreach (dynamic item in NativeTools.Items(NativeTools.App.Presentations))
                if ((string)item.FullName == target.presentation) { deck = item; break; }
            if (deck == null) throw new InvalidOperationException("原演示文稿已关闭或另存，请选择页面后重试插入。");
            // WPS exposes FindBySlideID but returns null in some releases.
            foreach (dynamic item in NativeTools.Items(deck.Slides)) if ((int)item.SlideID == target.slideId) { slide = item; break; }
            if (slide == null) throw new InvalidOperationException("原幻灯片已删除，请选择页面后重试插入。");
            if (target.shapeId != 0) {
                foreach (dynamic item in NativeTools.Items(slide.Shapes)) if ((int)item.Id == target.shapeId) { previous = item; break; }
                if (previous == null) throw new InvalidOperationException("原图形已删除，请重试插入到当前页面。");
            }
            float pageW = deck.PageSetup.SlideWidth, pageH = deck.PageSetup.SlideHeight;
            float width, height, left, top;
            // Cover layers are authored on the full 1280x720 canvas. Keep both
            // the background and title SVG aligned to the exact slide bounds.
            if (label == "cover") { width = pageW; height = pageH; left = 0; top = 0; }
            else {
                width = pageW * .8f; height = pageH * .8f;
                double ratio = AspectRatio(doc.DocumentElement);
                if (width / height > ratio) width = (float)(height * ratio); else height = (float)(width / ratio);
                left = (pageW - width) / 2; top = (pageH - height) / 2;
            }
            float rotation = 0;
            int order = 0;
            if (previous != null) { left = previous.Left; top = previous.Top; width = previous.Width; height = previous.Height; rotation = previous.Rotation; order = previous.ZOrderPosition; }
            byte[] raster = null;
            string extension = ".svg";
            var image = doc.DocumentElement.SelectSingleNode("*[local-name()='image']") as XmlElement;
            bool coverBackground = label == "cover" && image != null && doc.DocumentElement.SelectNodes("*").Count == 1;
            if (label == "image" || coverBackground) {
                // WPS accepts the SVG object but does not render embedded rasters.
                // Insert the original image file through its native picture API.
                if (image == null) throw new ArgumentException("生成结果中没有可插入的图片。");
                string data = image.GetAttribute("href");
                if (string.IsNullOrEmpty(data)) data = image.GetAttribute("href", "http://www.w3.org/1999/xlink");
                var file = GeneratedImageFile.Read(data);
                if (coverBackground) file.CropToCover(pageW, pageH);
                raster = file.Bytes; extension = file.Extension;
            }
            string path = Path.Combine(Path.GetTempPath(), "sandun-ai-" + Guid.NewGuid().ToString("N") + extension);
            dynamic inserted = null;
            try {
                if (raster != null) File.WriteAllBytes(path, raster);
                else File.WriteAllText(path, doc.OuterXml, new UTF8Encoding(false));
                try { NativeTools.App.StartNewUndoEntry(); } catch { }
                inserted = slide.Shapes.AddPicture(path, 0, -1, left, top, width, height);
                inserted.Name = "SANDUN AI " + (coverBackground ? "封面背景" : label == "cover" ? "封面标题" : label == "image" ? "图片" : label == "chart" ? "图表" : "图示");
                inserted.Rotation = rotation;
                if (previous != null) {
                    while ((int)inserted.ZOrderPosition > order + 1) inserted.ZOrder(3);
                    previous.Delete();
                }
                target.shapeId = inserted.Id;
                try { inserted.Select(); } catch { }
                return new JavaScriptSerializer().Serialize(target);
            } catch {
                if (inserted != null) { try { inserted.Delete(); } catch { } }
                throw;
            } finally { if (File.Exists(path)) File.Delete(path); }
        }
        internal static string InsertCover(string backgroundSvg, string titleSvg, string targetJson)
        {
            Validate(backgroundSvg); Validate(titleSvg);
            var target = new JavaScriptSerializer().Deserialize<Target>(targetJson);
            if (target == null || target.shapeId != 0) throw new ArgumentException("请选择封面要插入的幻灯片。");
            string backgroundTarget = Insert(backgroundSvg, targetJson, "cover");
            try { return Insert(titleSvg, targetJson, "cover"); }
            catch {
                // Keep retries from leaving a partial cover behind when the title cannot be inserted.
                var created = new JavaScriptSerializer().Deserialize<Target>(backgroundTarget);
                foreach (dynamic deck in NativeTools.Items(NativeTools.App.Presentations))
                    if ((string)deck.FullName == created.presentation)
                        foreach (dynamic slide in NativeTools.Items(deck.Slides))
                            if ((int)slide.SlideID == created.slideId)
                                foreach (dynamic shape in NativeTools.Items(slide.Shapes))
                                    if ((int)shape.Id == created.shapeId) { shape.Delete(); break; }
                throw;
            }
        }
        private static XmlDocument Validate(string svg)
        {
            if (string.IsNullOrWhiteSpace(svg) || svg.Length > 8 * 1024 * 1024) throw new ArgumentException("生成的 SVG 为空或过大。");
            var doc = new XmlDocument { XmlResolver = null };
            using (var reader = XmlReader.Create(new StringReader(svg), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null })) doc.Load(reader);
            if (doc.DocumentElement == null || doc.DocumentElement.LocalName != "svg" || doc.DocumentElement.NamespaceURI != "http://www.w3.org/2000/svg") throw new ArgumentException("生成结果不是有效的 SVG。");
            foreach (XmlElement node in doc.SelectNodes("//*")) {
                if (node.LocalName == "script" || node.LocalName == "foreignObject") throw new ArgumentException("SVG 包含不支持的内容。");
                foreach (XmlAttribute attr in node.Attributes) {
                    string value = attr.Value.Trim();
                    if (attr.LocalName.StartsWith("on", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("SVG 包含不支持的交互内容。");
                    if (attr.LocalName == "href" && !value.StartsWith("#") && !value.StartsWith("data:image/png;base64,", StringComparison.OrdinalIgnoreCase) && !value.StartsWith("data:image/jpeg;base64,", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("SVG 包含未嵌入的外部资源。");
                }
            }
            return doc;
        }
        private static double AspectRatio(XmlElement root)
        {
            string[] viewBox = root.GetAttribute("viewBox").Split(new[] { ' ', ',', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            double width, height;
            if (viewBox.Length == 4 && double.TryParse(viewBox[2], NumberStyles.Float, CultureInfo.InvariantCulture, out width) && double.TryParse(viewBox[3], NumberStyles.Float, CultureInfo.InvariantCulture, out height) && width > 0 && height > 0 && !double.IsInfinity(width / height)) return width / height;
            if (double.TryParse(root.GetAttribute("width").Replace("px", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out width) && double.TryParse(root.GetAttribute("height").Replace("px", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out height) && width > 0 && height > 0) return width / height;
            return 16.0 / 9;
        }
    }
}
