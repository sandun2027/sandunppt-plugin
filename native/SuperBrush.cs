using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.IO;
using System.IO.Compression;
using System.Windows.Forms;
using System.Xml.Linq;

namespace Sandun.PresentationBootstrap
{
    // Snapshot values, not COM references: the source can be edited or deleted after capture.
    internal static class SuperBrush
    {
        internal static string SourceName { get; private set; }
        internal static bool SourceHasText { get; private set; }
        private static Snapshot source;
        private sealed class Snapshot
        {
            internal readonly Dictionary<string, Dictionary<string, object>> Groups = new Dictionary<string, Dictionary<string, object>>();
            internal readonly Dictionary<string, FillSnapshot> Fills = new Dictionary<string, FillSnapshot>();
            internal float[] Adjustments; internal int ShapeType; internal float Round;
        }
        private static readonly Dictionary<string, string[]> Properties = new Dictionary<string, string[]> {
            { "left", new[] { "Left" } }, { "top", new[] { "Top" } }, { "width", new[] { "Width" } }, { "height", new[] { "Height" } }, { "rotation", new[] { "Rotation" } },
            { "crop", new[] { "PictureFormat.CropLeft", "PictureFormat.CropRight", "PictureFormat.CropTop", "PictureFormat.CropBottom" } },
            { "soft", new[] { "SoftEdge.Radius" } },
            { "line", new[] { "Line.Visible", "Line.Weight", "Line.Style", "Line.DashStyle", "Line.BeginArrowheadStyle", "Line.BeginArrowheadLength", "Line.BeginArrowheadWidth", "Line.EndArrowheadStyle", "Line.EndArrowheadLength", "Line.EndArrowheadWidth", "Line.ForeColor.RGB", "Line.BackColor.RGB", "Line.Transparency" } },
            { "shadow", new[] { "Shadow.Type", "Shadow.Style", "Shadow.ForeColor.RGB", "Shadow.Transparency", "Shadow.Size", "Shadow.Blur", "Shadow.OffsetX", "Shadow.OffsetY", "Shadow.RotateWithShape", "Shadow.Visible" } },
            { "reflection", new[] { "Reflection.Type", "Reflection.Transparency", "Reflection.Size", "Reflection.Blur", "Reflection.Offset" } },
            { "glow", new[] { "Glow.Color.RGB", "Glow.Transparency", "Glow.Radius" } },
            { "threeD", new[] { "ThreeD.BevelTopType", "ThreeD.BevelTopDepth", "ThreeD.BevelTopInset", "ThreeD.BevelBottomType", "ThreeD.BevelBottomDepth", "ThreeD.BevelBottomInset", "ThreeD.ExtrusionColorType", "ThreeD.ExtrusionColor.RGB", "ThreeD.Depth", "ThreeD.ContourColor.RGB", "ThreeD.ContourWidth", "ThreeD.PresetMaterial", "ThreeD.PresetLighting", "ThreeD.LightAngle", "ThreeD.Visible" } },
            { "threeDRotation", new[] { "ThreeD.PresetCamera", "ThreeD.RotationX", "ThreeD.RotationY", "ThreeD.RotationZ", "ThreeD.Perspective", "ThreeD.FieldOfView", "ThreeD.ProjectText", "ThreeD.Z" } },
            { "text", new[] { "TextFrame2.MarginLeft", "TextFrame2.MarginRight", "TextFrame2.MarginTop", "TextFrame2.MarginBottom", "TextFrame2.WordWrap", "TextFrame2.VerticalAnchor", "TextFrame2.TextRange.Font.NameAscii", "TextFrame2.TextRange.Font.NameFarEast", "TextFrame2.TextRange.Font.NameOther", "TextFrame2.TextRange.Font.Size", "TextFrame2.TextRange.Font.Bold", "TextFrame2.TextRange.Font.Italic", "TextFrame2.TextRange.Font.UnderlineStyle", "TextFrame2.TextRange.Font.Spacing", "TextFrame2.TextRange.Font.BaselineOffset", "TextFrame2.TextRange.ParagraphFormat.Alignment", "TextFrame2.TextRange.ParagraphFormat.SpaceWithin", "TextFrame2.TextRange.ParagraphFormat.SpaceBefore", "TextFrame2.TextRange.ParagraphFormat.SpaceAfter", "TextFrame2.TextRange.ParagraphFormat.FirstLineIndent", "TextFrame2.TextRange.ParagraphFormat.LeftIndent", "TextFrame2.TextRange.ParagraphFormat.Bullet.Type", "TextFrame2.TextRange.ParagraphFormat.Bullet.Character", "TextFrame2.AutoSize" } }
        };
        static SuperBrush()
        {
            foreach (string name in new[] { "line", "shadow", "reflection", "glow", "threeD", "threeDRotation" })
                Properties["text-" + name] = Properties[name].Select(p => (name.StartsWith("threeD") ? "TextFrame2." : "TextFrame2.TextRange.Font.") + p).ToArray();
        }
        internal static string Execute(Dictionary<string, object> o)
        {
            string action = FontUnifier.Value(o, "action", "apply");
            var selected = NativeTools.Selection();
            if (action == "capture")
            {
                if (selected.Count != 1) throw new ArgumentException("请选择一个对象作为样式源。");
                source = Capture(selected[0]); SourceName = selected[0].Name; SourceHasText = (int)selected[0].HasTextFrame != 0;
                return "已读取「" + SourceName + "」，现在选择目标对象并应用。";
            }
            var targets = NativeTools.Flag(o, "groups", true) ? selected.SelectMany(s => NativeTools.Leaves((object)s)).ToList() : selected;
            if (action == "shape-to-text" || action == "text-to-shape")
            {
                if (NativeTools.IsWps) throw new InvalidOperationException("当前 WPS 不支持渐变转换。");
                int converted = 0;
                foreach (dynamic target in targets)
                {
                    if ((int)target.HasTextFrame == 0) continue;
                    dynamic from = action == "shape-to-text" ? target.Fill : target.TextFrame2.TextRange.Font.Fill;
                    dynamic to = action == "shape-to-text" ? target.TextFrame2.TextRange.Font.Fill : target.Fill;
                    if ((int)from.Type != 3) continue;
                    new FillSnapshot(from).Apply(to); converted++;
                }
                if (converted == 0) throw new ArgumentException("当前选区没有可转换的渐变填充。");
                return "已将 " + converted + " 个对象的渐变复制到" + (action == "shape-to-text" ? "文字" : "形状") + "。";
            }
            if (source == null) throw new InvalidOperationException("请先读取一个样式源。");
            object raw; if (!o.TryGetValue("properties", out raw)) throw new ArgumentException("请勾选需要应用的属性。");
            var keys = new HashSet<string>(((System.Collections.IEnumerable)raw).Cast<object>().Select(Convert.ToString));
            if (keys.Count == 0) throw new ArgumentException("请至少勾选一项属性。");
            var failures = new HashSet<string>(); int applied = 0;
            foreach (dynamic target in targets)
            {
                int locked = target.LockAspectRatio;
                try
                {
                    target.LockAspectRatio = 0;
                    foreach (string key in keys)
                    {
                        try
                        {
                            if (key == "round")
                            {
                                if (source.Round <= 0) { failures.Add("样式源没有圆角参数"); continue; }
                                if ((int)target.Type == 1 && new[] { 1, 5, 151, 152, 153 }.Contains((int)target.AutoShapeType))
                                {
                                    if ((int)target.AutoShapeType == 1) target.AutoShapeType = 5;
                                    target.Adjustments[1] = Math.Min(.5f, source.Round / Math.Min((float)target.Width, (float)target.Height));
                                }
                                else failures.Add("圆角仅用于可调圆角矩形，其他形状请用圆角工具");
                            }
                            else if (key == "adjustments")
                            {
                                if ((int)target.AutoShapeType != source.ShapeType || (int)target.Adjustments.Count != source.Adjustments.Length) { failures.Add("控点需相同形状类型"); continue; }
                                for (int i = 0; i < source.Adjustments.Length; i++) target.Adjustments[i + 1] = source.Adjustments[i];
                            }
                            else if (source.Fills.ContainsKey(key)) source.Fills[key].Apply(key == "fill" ? target.Fill : target.TextFrame2.TextRange.Font.Fill);
                            else if (source.Groups.ContainsKey(key))
                            {
                                if (key.StartsWith("text") && (int)target.HasTextFrame == 0) { failures.Add("非文字对象已跳过文字属性"); continue; }
                                if (key == "crop" && (int)target.Type != 13 && (int)target.Type != 11) { failures.Add("非图片对象已跳过裁剪"); continue; }
                                foreach (var property in source.Groups[key])
                                {
                                    try { Set(target, property.Key, property.Value); }
                                    catch { failures.Add(property.Key); }
                                }
                            }
                            else failures.Add("样式源不含 " + key);
                        }
                        catch { failures.Add(key); }
                    }
                    applied++;
                }
                finally { target.LockAspectRatio = locked; }
            }
            NativeTools.Select(selected);
            return "已处理 " + applied + " 个对象，可按 Ctrl+Z 撤销。" + (failures.Count == 0 ? "" : " 未适用或未完成：" + string.Join("、", failures));
        }
        private static Snapshot Capture(dynamic shape)
        {
            var result = new Snapshot();
            foreach (var group in Properties)
            {
                if (NativeTools.IsWps && (group.Key == "shadow" || group.Key == "text-shadow")) continue;
                if (group.Key.StartsWith("text") && (int)shape.HasTextFrame == 0) continue;
                if (group.Key == "crop" && (int)shape.Type != 13 && (int)shape.Type != 11) continue;
                var values = new Dictionary<string, object>();
                foreach (string path in group.Value) try
                {
                    object value = Get(shape, path, true);
                    if (value is string && string.IsNullOrEmpty((string)value)) continue;
                    if (!(value is string))
                    {
                        double number = Convert.ToDouble(value);
                        if (number == -2 && !path.EndsWith("OffsetX") && !path.EndsWith("OffsetY")) continue;
                        if (number < 0 && new[] { "Transparency", "Weight", "Size", "Blur", "Radius", "Offset", "FieldOfView", "Depth", "Inset" }.Any(p => path.EndsWith(p))) continue;
                    }
                    values[path] = value;
                }
                catch { }
                if (values.Count > 0) result.Groups[group.Key] = values;
            }
            try { result.Fills["fill"] = new FillSnapshot((object)shape.Fill, () => FillImage((object)shape, false)); } catch { }
            if ((int)shape.HasTextFrame != 0) try { dynamic range = shape.TextFrame2.TextRange; result.Fills["text-fill"] = new FillSnapshot((object)((int)range.Length > 0 ? range.Characters(1, 1).Font.Fill : range.Font.Fill), () => FillImage((object)shape, true)); } catch { }
            result.Adjustments = new float[(int)shape.Adjustments.Count];
            for (int i = 0; i < result.Adjustments.Length; i++) result.Adjustments[i] = shape.Adjustments[i + 1];
            result.ShapeType = shape.AutoShapeType;
            if (new[] { 5, 151, 152, 153 }.Contains(result.ShapeType) && result.Adjustments.Length > 0) result.Round = result.Adjustments[0] * Math.Min((float)shape.Width, (float)shape.Height);
            return result;
        }
        private static object Get(object target, string path, bool firstCharacter = false)
        {
            foreach (string part in path.Split('.'))
            {
                target = target.GetType().InvokeMember(part, BindingFlags.GetProperty, null, target, null, CultureInfo.InvariantCulture);
                if (firstCharacter && part == "TextRange") { dynamic range = target; if ((int)range.Length > 0) target = range.Characters(1, 1); }
            }
            return target;
        }
        private static void Set(object target, string path, object value)
        {
            try { if (object.Equals(Get(target, path), value)) return; } catch { }
            int dot = path.LastIndexOf('.');
            if (dot >= 0) { target = Get(target, path.Substring(0, dot)); path = path.Substring(dot + 1); }
            // PresetCamera is exposed as a method in the Office COM contract.
            target.GetType().InvokeMember(path == "PresetCamera" ? "SetPresetCamera" : path, path == "PresetCamera" ? BindingFlags.InvokeMethod : BindingFlags.SetProperty, null, target, new[] { value }, CultureInfo.InvariantCulture);
        }
        private static byte[] FillImage(dynamic shape, bool text)
        {
            using (var previous = new ClipboardSnapshot())
            {
                for (int attempt = 0; attempt < 8; attempt++)
                {
                    Clipboard.Clear(); shape.Copy(); System.Threading.Thread.Sleep(40); Application.DoEvents();
                    var data = Clipboard.GetDataObject(); var stream = data == null ? null : data.GetData("Art::GVML ClipFormat") as MemoryStream;
                    if (stream == null) continue;
                    try
                    {
                        using (var zip = new ZipArchive(new MemoryStream(stream.ToArray()), ZipArchiveMode.Read))
                        {
                            XDocument doc, rels;
                            using (var input = zip.GetEntry("clipboard/drawings/drawing1.xml").Open()) doc = XDocument.Load(input);
                            using (var input = zip.GetEntry("clipboard/drawings/_rels/drawing1.xml.rels").Open()) rels = XDocument.Load(input);
                            XNamespace a = "http://schemas.openxmlformats.org/drawingml/2006/main", r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
                            var blip = doc.Descendants(a + "blip").FirstOrDefault(e => e.Ancestors().Any(n => n.Name.LocalName == "txBody") == text);
                            if (blip == null) return null;
                            string id = (string)blip.Attribute(r + "embed"); var rel = rels.Root.Elements().FirstOrDefault(e => (string)e.Attribute("Id") == id);
                            if (rel == null || (string)rel.Attribute("TargetMode") == "External") return null;
                            string path = new Uri(new Uri("https://clip/clipboard/drawings/drawing1.xml"), (string)rel.Attribute("Target")).AbsolutePath.TrimStart('/');
                            using (var input = zip.GetEntry(Uri.UnescapeDataString(path)).Open()) using (var output = new MemoryStream()) { input.CopyTo(output); return output.ToArray(); }
                        }
                    }
                    catch (InvalidDataException) { }
                }
            }
            return null;
        }
        private sealed class FillSnapshot
        {
            private readonly int visible, type, rgb, back, style, variant, pattern, texture;
            private readonly float transparency, angle;
            private readonly byte[] image;
            private readonly Dictionary<string, object> textureProperties = new Dictionary<string, object>();
            private readonly List<float[]> stops = new List<float[]>();
            internal FillSnapshot(dynamic fill, Func<byte[]> readImage = null)
            {
                visible = fill.Visible; type = fill.Type; rgb = fill.ForeColor.RGB; back = fill.BackColor.RGB;
                if (NativeTools.IsWps && type == 3) throw new InvalidOperationException("当前 WPS 不支持读取完整渐变色标。");
                if (type == 1) transparency = fill.Transparency;
                if (type == 2) pattern = fill.Pattern;
                if (type == 3)
                {
                    style = fill.GradientStyle; variant = fill.GradientVariant;
                    try { angle = fill.GradientAngle; } catch { }
                    foreach (dynamic stop in NativeTools.Items(fill.GradientStops)) stops.Add(new[] { (float)(int)stop.Color.RGB, (float)stop.Position, (float)stop.Transparency });
                }
                if (visible != 0 && (type == 4 || type == 6))
                {
                    if (type == 4 && (int)fill.TextureType == 1) texture = fill.PresetTexture;
                    else { image = readImage == null ? null : readImage(); if (image == null) throw new InvalidOperationException("未能读取图片填充。"); }
                    foreach (string key in new[] { "TextureAlignment", "TextureHorizontalScale", "TextureVerticalScale", "TextureOffsetX", "TextureOffsetY", "RotateWithObject", "Transparency" }) try { textureProperties[key] = Get(fill, key); } catch { }
                }
            }
            internal void Apply(dynamic fill)
            {
                if (visible == 0) { fill.Visible = 0; return; }
                if (type == 4 || type == 6)
                {
                    if (texture != 0) fill.PresetTextured(texture);
                    else
                    {
                        string path = Path.Combine(Path.GetTempPath(), "sandun-brush-" + Guid.NewGuid().ToString("N") + ".png");
                        try { File.WriteAllBytes(path, image); if (type == 4) fill.UserTextured(path); else fill.UserPicture(path); }
                        finally { if (File.Exists(path)) File.Delete(path); }
                    }
                    foreach (var item in textureProperties) Set(fill, item.Key, item.Value);
                    fill.Visible = visible; return;
                }
                if (type == 5) { fill.Background(); return; }
                if (type == 3)
                {
                    fill.TwoColorGradient(style, Math.Max(1, variant));
                    while ((int)fill.GradientStops.Count > 2) fill.GradientStops.Delete((int)fill.GradientStops.Count);
                    for (int i = 0; i < stops.Count; i++)
                    {
                        var stop = stops[i];
                        if (i < 2) { dynamic dest = fill.GradientStops.Item(i + 1); dest.Color.RGB = (int)stop[0]; dest.Position = stop[1]; dest.Transparency = stop[2]; }
                        else fill.GradientStops.Insert((int)stop[0], stop[1], stop[2]);
                    }
                    if (style == 1 || style == 2 || style == 3 || style == 4) fill.GradientAngle = angle;
                }
                else { if (type == 2) fill.Patterned(pattern); else fill.Solid(); fill.ForeColor.RGB = rgb; fill.BackColor.RGB = back; if (type == 1) fill.Transparency = transparency; }
                fill.Visible = visible;
            }
        }
    }
}
