using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Sandun.PresentationBootstrap
{
    // All document work stays on Office's STA thread; no macro runtime is involved.
    internal static class NativeTools
    {
        internal static Func<string, string, string, string> SaveDestination = PickSavePath;
        internal static Func<string, string> FolderDestination = PickFolder;
        internal static dynamic App { get { if (PresentationBootstrap.CurrentApplication == null) throw new InvalidOperationException("请先打开 PowerPoint 或 WPS 演示。"); return PresentationBootstrap.CurrentApplication; } }
        internal static dynamic Deck { get { return App.ActivePresentation; } }
        internal static bool IsWps { get { return ((string)App.Path).IndexOf("WPS Office", StringComparison.OrdinalIgnoreCase) >= 0 || System.Diagnostics.Process.GetCurrentProcess().ProcessName.Equals("wpp", StringComparison.OrdinalIgnoreCase); } }
        internal static dynamic Slide { get { return App.ActiveWindow.View.Slide; } }
        internal static List<dynamic> Items(dynamic collection)
        {
            var result = new List<dynamic>();
            for (int i = 1; i <= (int)collection.Count; i++) result.Add(collection.Item(i));
            return result;
        }
        internal static List<dynamic> Selection(bool required = true)
        {
            var result = new List<dynamic>();
            if ((int)App.ActiveWindow.Selection.Type >= 2) result = Items(App.ActiveWindow.Selection.ShapeRange);
            if (required && result.Count == 0) throw new InvalidOperationException("请先在幻灯片中选择一个或多个对象。");
            return result;
        }
        internal static List<dynamic> Slides(bool all = false)
        {
            if (all) return Items(Deck.Slides);
            try { return Items(App.ActiveWindow.Selection.SlideRange); }
            catch { return new List<dynamic> { Slide }; }
        }
        internal static void Select(List<dynamic> shapes)
        {
            App.ActiveWindow.Selection.Unselect();
            foreach (dynamic shape in shapes) shape.Select(0);
        }
        internal static dynamic Range(List<dynamic> shapes)
        {
            if (shapes.Count == 0) throw new InvalidOperationException("没有可操作的对象。");
            return shapes[0].Parent.Shapes.Range(shapes.Select(s => (object)(string)s.Name).ToArray());
        }
        internal static RectangleF Bounds(List<dynamic> shapes)
        {
            float left = shapes.Min(s => (float)s.Left), top = shapes.Min(s => (float)s.Top);
            return RectangleF.FromLTRB(left, top, shapes.Max(s => (float)s.Left + (float)s.Width), shapes.Max(s => (float)s.Top + (float)s.Height));
        }
        private static bool TextShape(dynamic shape) { return (int)shape.HasTextFrame != 0 && (int)shape.TextFrame.HasText != 0; }
        internal static IEnumerable<dynamic> Leaves(dynamic shape)
        {
            if ((int)shape.Type == 6) { foreach (dynamic child in Items(shape.GroupItems)) foreach (dynamic leaf in Leaves(child)) yield return leaf; }
            else if ((int)shape.HasTable != 0) { for (int r = 1; r <= (int)shape.Table.Rows.Count; r++) for (int c = 1; c <= (int)shape.Table.Columns.Count; c++) yield return shape.Table.Cell(r, c).Shape; }
            else yield return shape;
        }
        internal static void UndoEntry() { try { App.StartNewUndoEntry(); } catch { /* Older WPS versions use their own undo grouping. */ } }
        internal static string Execute(string command, string json)
        {
            if (!ToolCatalog.All.Any(t => t.Id == command)) throw new ArgumentException("未知的 SANDUN 操作。");
            var options = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(string.IsNullOrEmpty(json) ? "{}" : json);
            if ((int)App.Presentations.Count == 0) throw new InvalidOperationException("请先打开一份演示文稿。");
            if (IsWps && new[] { "outline", "export-fonts", "export-video", "ungroup-style", "round-corners", "layers" }.Contains(command)) throw new InvalidOperationException("当前 WPS 不支持此操作。");
            UndoEntry();
            switch (command)
            {
                case "page-height": return PageHeight();
                case "guides":
                    if (IsWps) WpsGuides().Execute(); else App.CommandBars.ExecuteMso("GuidesShowHide");
                    return "已切换参考线";
                case "master": App.ActiveWindow.ViewType = 2; return "已进入幻灯片母版";
                case "zoom": Scale(options); return "已缩放，可按 Ctrl+Z 撤销";
                case "layers": App.CommandBars.ExecuteMso("SelectionPane"); return "已打开图层管理";
                case "select-between": case "select-inverse": case "select-type": case "select-font": case "select-width": case "select-height": case "select-color": case "select-lines": case "select-text": case "select-groups": return Filter(command);
                case "group-near": GroupNear(); break;
                case "group": Range(Selection()).Group().Select(); break;
                case "ungroup-style": Ungroup(Selection(), false, true); break;
                case "ungroup-slide": foreach (dynamic slide in Slides()) Ungroup(Items(slide.Shapes), true, false); break;
                case "ungroup-selection": Ungroup(Selection(), true, false); break;
                case "layer-up": case "layer-down":
                    var ordered = Selection().OrderBy(s => command == "layer-up" ? -(int)s.ZOrderPosition : (int)s.ZOrderPosition).ToList();
                    foreach (dynamic s in ordered) s.ZOrder(command == "layer-up" ? 2 : 3); break;
                case "duplicate":
                    var copies = new List<dynamic>(); foreach (dynamic s in Selection()) { dynamic copy = DuplicateShape(s); copy.Left = s.Left; copy.Top = s.Top; copies.Add(copy); } Select(copies); break;
                case "fill-slide": FillSlide(); break;
                case "crop-slide": CropSlide(); break;
                case "trim": Trim(); break;
                case "mask": Mask(options); break;
                case "merge":
                    var merging = Selection(); if (merging.Count < 2) throw new InvalidOperationException("请至少选择两个形状。");
                    Range(merging).MergeShapes((int)Number(options, "operation", 1, 1, 5), merging[0]); break;
                case "export-images": return ExportImages(options);
                case "export-fonts": return ExportFonts();
                case "outline": Outline(); break;
                case "round-corners": return RoundCorners(options);
                case "unify-fonts": return FontUnifier.Execute(options);
                case "super-brush": return SuperBrush.Execute(options);
                case "collage": return SlideCollage.Execute(options);
                case "export-video": return ExportVideo(options);
                default: throw new ArgumentException("该操作尚未定义。");
            }
            return "操作完成，可按 Ctrl+Z 撤销";
        }
        internal static dynamic WpsGuides()
        {
            foreach (dynamic parent in Items(App.CommandBars.Item("Slide Background Popup Menu").Controls))
            {
                string caption = parent.Caption;
                if (!caption.Contains("参考线") && !caption.ToLowerInvariant().Contains("guide")) continue;
                foreach (dynamic control in Items(parent.Controls))
                {
                    string label = System.Text.RegularExpressions.Regex.Replace((string)control.Caption, @"\(&.\)|&", "").Trim();
                    if (label == "参考线" || label.Equals("Guides", StringComparison.OrdinalIgnoreCase)) return control;
                }
            }
            throw new InvalidOperationException("当前 WPS 未提供参考线切换命令。");
        }
        internal static double Number(Dictionary<string, object> values, string key, double fallback, double min, double max)
        {
            double value = values.ContainsKey(key) ? Convert.ToDouble(values[key], CultureInfo.InvariantCulture) : fallback;
            if (double.IsNaN(value) || double.IsInfinity(value) || value < min || value > max) throw new ArgumentException(key + " 的数值超出范围。");
            return value;
        }
        internal static bool Flag(Dictionary<string, object> values, string key, bool fallback) { return values.ContainsKey(key) ? Convert.ToBoolean(values[key]) : fallback; }
        internal static void Scale(Dictionary<string, object> options)
        {
            var shapes = Selection(); var box = Bounds(shapes);
            double factor = Number(options, "percent", 100, 1, 10000) / 100;
            bool positions = Flag(options, "positions", true), fonts = Flag(options, "fonts", true), lines = Flag(options, "lines", true), effects = Flag(options, "effects", true);
            string anchor = options.ContainsKey("anchor") ? Convert.ToString(options["anchor"]) : "center";
            float ax = anchor == "center" ? box.Left + box.Width / 2 : anchor.EndsWith("right") ? box.Right : box.Left;
            float ay = anchor == "center" ? box.Top + box.Height / 2 : anchor.StartsWith("bottom") ? box.Bottom : box.Top;
            foreach (dynamic shape in shapes)
            {
                float left = shape.Left, top = shape.Top, width = shape.Width, height = shape.Height;
                if (width * factor > 100000 || height * factor > 100000) throw new ArgumentException("缩放后尺寸过大，请减小比例。");
            }
            foreach (dynamic shape in shapes)
            {
                float left = shape.Left, top = shape.Top, width = shape.Width, height = shape.Height;
                // Capture individual runs before resizing: Office may scale group text itself.
                var restore = new List<Action>();
                CaptureEffects(shape, effects ? factor : 1, restore);
                foreach (dynamic leaf in Leaves(shape))
                {
                    dynamic target = leaf;
                    if ((int)target.Id != (int)shape.Id) CaptureEffects(target, effects ? factor : 1, restore);
                    if (TextShape(target))
                    {
                        dynamic runs = target.TextFrame2.TextRange.Runs();
                        for (int i = 1; i <= (int)runs.Count; i++)
                        {
                            dynamic run = target.TextFrame2.TextRange.Runs(i, 1); float size = run.Font.Size;
                            if (size > 0) { float next = (float)(size * (fonts ? factor : 1)); restore.Add(() => run.Font.Size = next); }
                            CaptureEffects(run.Font, effects ? factor : 1, restore, false);
                            if ((int)run.Font.Line.Visible != 0) { float weight = run.Font.Line.Weight; restore.Add(() => run.Font.Line.Weight = (float)(weight * (lines ? factor : 1))); }
                        }
                    }
                    if ((int)target.Line.Visible != 0) { float weight = target.Line.Weight; restore.Add(() => target.Line.Weight = (float)(weight * (lines ? factor : 1))); }
                }
                int locked = shape.LockAspectRatio;
                try { shape.LockAspectRatio = 0; shape.Width = (float)(width * factor); shape.Height = (float)(height * factor); }
                finally { shape.LockAspectRatio = locked; }
                shape.Left = positions ? ax + (float)((left - ax) * factor) : left + (width - (float)shape.Width) / 2;
                shape.Top = positions ? ay + (float)((top - ay) * factor) : top + (height - (float)shape.Height) / 2;
                foreach (var action in restore) action();
            }
        }
        private static string Filter(string command)
        {
            var selected = Selection(false); var all = Items(Slide.Shapes); var found = new List<dynamic>();
            bool reference = command == "select-between" || command == "select-type" || command == "select-font" || command == "select-width" || command == "select-height" || command == "select-color";
            if (reference && selected.Count == 0) throw new InvalidOperationException("请先选择一个作为比较基准的对象。");
            if (command == "select-between" && selected.Count != 2) throw new InvalidOperationException("请选择两个图层，将连选它们之间的对象。");
            dynamic first = selected.FirstOrDefault();
            if (command == "select-font" && !TextShape(first)) throw new InvalidOperationException("请先选择包含文字的对象。");
            var ids = new HashSet<int>(selected.Select(s => (int)s.Id));
            foreach (dynamic s in all)
            {
                if ((int)s.Visible == 0) continue;
                bool match = false;
                switch (command)
                {
                    case "select-inverse": match = !ids.Contains((int)s.Id); break;
                    case "select-between": int z = s.ZOrderPosition; match = z >= selected.Min(x => (int)x.ZOrderPosition) && z <= selected.Max(x => (int)x.ZOrderPosition); break;
                    case "select-type": match = (int)s.Type == (int)first.Type && ((int)s.Type != 1 || (int)s.AutoShapeType == (int)first.AutoShapeType); break;
                    case "select-font": match = TextShape(s) && (string)s.TextFrame.TextRange.Font.Name == (string)first.TextFrame.TextRange.Font.Name && Math.Abs((float)s.TextFrame.TextRange.Font.Size - (float)first.TextFrame.TextRange.Font.Size) < .1; break;
                    case "select-width": match = Math.Abs((float)s.Width - (float)first.Width) < .5; break;
                    case "select-height": match = Math.Abs((float)s.Height - (float)first.Height) < .5; break;
                    case "select-color": match = (int)s.Fill.Visible == (int)first.Fill.Visible && (int)s.Fill.Type == (int)first.Fill.Type && (int)s.Fill.ForeColor.RGB == (int)first.Fill.ForeColor.RGB; break;
                    case "select-lines": match = (int)s.Type == 9 || (int)s.Connector != 0; break;
                    case "select-text": match = TextShape(s); break;
                    case "select-groups": match = (int)s.Type == 6; break;
                }
                if (match) found.Add(s);
            }
            Select(found); return "已选择 " + found.Count + " 个对象";
        }
        private static void GroupNear()
        {
            var box = Bounds(Selection()); var containers = Items((object)Slide.Shapes).Where(s => Math.Abs((float)s.Width - box.Width) < 5 && Math.Abs((float)s.Height - box.Height) < 5).ToList();
            var groups = new List<dynamic>();
            foreach (dynamic container in containers)
            {
                var inside = Items((object)Slide.Shapes).Where(s => (float)s.Left >= (float)container.Left - 10 && (float)s.Top >= (float)container.Top - 10 && (float)s.Left + (float)s.Width <= (float)container.Left + (float)container.Width + 10 && (float)s.Top + (float)s.Height <= (float)container.Top + (float)container.Height + 10).ToList();
                if (inside.Count > 1) groups.Add(Range(inside).Group());
            }
            if (groups.Count == 0) throw new InvalidOperationException("未找到与所选区域等大的容器及其内部对象。");
            Select(groups);
        }
        private static void Ungroup(List<dynamic> shapes, bool recursive, bool style)
        {
            foreach (dynamic shape in shapes)
            {
                if ((int)shape.Type != 6) continue;
                // Apply group effects before ungrouping, while the source COM object is valid.
                if (style) foreach (dynamic child in Items(shape.GroupItems))
                {
                    if ((int)shape.Shadow.Visible != 0 && (int)child.Shadow.Visible == 0)
                    {
                        child.Shadow.Visible = -1; child.Shadow.ForeColor.RGB = shape.Shadow.ForeColor.RGB;
                        child.Shadow.Transparency = shape.Shadow.Transparency; child.Shadow.Blur = shape.Shadow.Blur;
                        child.Shadow.OffsetX = shape.Shadow.OffsetX; child.Shadow.OffsetY = shape.Shadow.OffsetY;
                    }
                    if ((float)shape.Glow.Radius > 0 && (float)child.Glow.Radius == 0) { child.Glow.Radius = shape.Glow.Radius; child.Glow.Color.RGB = shape.Glow.Color.RGB; child.Glow.Transparency = shape.Glow.Transparency; }
                }
                var children = Items(shape.Ungroup()); if (recursive) Ungroup(children, true, style);
            }
        }
        private static void FillSlide()
        {
            var shapes = Selection(false);
            if (shapes.Count == 0) shapes.Add(Slide.Shapes.AddShape(1, 0, 0, Deck.PageSetup.SlideWidth, Deck.PageSetup.SlideHeight));
            foreach (dynamic shape in shapes)
            {
                int locked = shape.LockAspectRatio;
                try { shape.LockAspectRatio = 0; shape.Left = 0; shape.Top = 0; shape.Width = Deck.PageSetup.SlideWidth; shape.Height = Deck.PageSetup.SlideHeight; }
                finally { shape.LockAspectRatio = locked; }
            }
            Select(shapes);
        }
        private static void CropSlide()
        {
            var shapes = Selection();
            if (shapes.Any(s => (int)s.Type != 13 && (int)s.Type != 11)) throw new InvalidOperationException("全屏裁剪只支持图片，请只选择图片。");
            float width = Deck.PageSetup.SlideWidth, height = Deck.PageSetup.SlideHeight;
            foreach (dynamic s in shapes)
            {
                dynamic crop = s.PictureFormat.Crop; float pw = crop.PictureWidth, ph = crop.PictureHeight;
                float ratio = Math.Max(width / pw, height / ph);
                crop.ShapeWidth = width; crop.ShapeHeight = height; crop.PictureWidth = pw * ratio; crop.PictureHeight = ph * ratio;
                crop.PictureOffsetX = 0; crop.PictureOffsetY = 0; s.Left = 0; s.Top = 0;
            }
        }
        private static void Trim()
        {
            var shapes = Selection(false); if (shapes.Count == 0) shapes = Items(Slide.Shapes);
            float width = Deck.PageSetup.SlideWidth, height = Deck.PageSetup.SlideHeight;
            foreach (dynamic shape in shapes)
            {
                float l = shape.Left, t = shape.Top, r = l + (float)shape.Width, b = t + (float)shape.Height;
                if (l >= 0 && t >= 0 && r <= width && b <= height) continue;
                if (r <= 0 || b <= 0 || l >= width || t >= height) { shape.Delete(); continue; }
                dynamic rect = shape.Parent.Shapes.AddShape(1, 0, 0, width, height);
                try { Range(new List<dynamic> { shape, rect }).MergeShapes(3, shape); }
                catch { try { rect.Delete(); } catch { } throw new InvalidOperationException("该对象不支持原生修边，请先转换为形状或图片。已完成的修边可用 Ctrl+Z 撤销。"); }
            }
        }
        internal static dynamic DuplicateShape(dynamic source)
        {
            dynamic shapes = source.Parent.Shapes;
            var before = new HashSet<int>(Items((object)shapes).Select(s => (int)s.Id));
            if (IsWps) using (var clipboard = new ClipboardSnapshot()) { source.Copy(); shapes.Paste(); }
            else source.Duplicate();
            // WPS returns a detached ShapeRange from Duplicate; reacquire the real shape.
            return Items((object)shapes).First(s => !before.Contains((int)s.Id));
        }
        private static void Mask(Dictionary<string, object> options)
        {
            float transparency = (float)Number(options, "transparency", 20, 0, 100) / 100;
            int color = (int)Number(options, "color", 0, 0, 16777215);
            var shapes = Selection(false); var result = new List<dynamic>();
            if (shapes.Count == 0) shapes.Add(null);
            foreach (dynamic source in shapes)
            {
                dynamic mask;
                if (source != null && ((int)source.Type == 1 || (int)source.Type == 5)) { mask = DuplicateShape(source); mask.Left = source.Left; mask.Top = source.Top; mask.TextFrame.TextRange.Text = ""; }
                else mask = Slide.Shapes.AddShape(1, source == null ? 0 : source.Left, source == null ? 0 : source.Top, source == null ? Deck.PageSetup.SlideWidth : source.Width, source == null ? Deck.PageSetup.SlideHeight : source.Height);
                mask.Name = "SANDUN 遮罩 " + mask.Id; mask.Fill.Solid(); mask.Fill.Visible = -1; mask.Fill.ForeColor.RGB = color; mask.Fill.Transparency = transparency; mask.Line.Visible = 0; mask.Shadow.Visible = 0;
                if (source != null) while ((int)mask.ZOrderPosition > (int)source.ZOrderPosition + 1) mask.ZOrder(3);
                result.Add(mask);
            }
            Select(result);
        }
        private static string SavePath(string title, string filter, string name) { return SaveDestination(title, filter, name); }
        private static string PickSavePath(string title, string filter, string name)
        {
            using (var dialog = new SaveFileDialog { Title = title, Filter = filter, FileName = name, OverwritePrompt = true }) return dialog.ShowDialog() == DialogResult.OK ? dialog.FileName : null;
        }
        private static string Folder(string title) { return FolderDestination(title); }
        private static string PickFolder(string title)
        {
            using (var dialog = new FolderBrowserDialog { Description = title }) return dialog.ShowDialog() == DialogResult.OK ? dialog.SelectedPath : null;
        }
        private static string TemporaryDirectory() { string path = Path.Combine(Path.GetTempPath(), "SANDUN-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(path); return path; }
        private static void Clean(string path) { try { Directory.Delete(path, true); } catch (IOException) { } }
        private static string ExportImages(Dictionary<string, object> options)
        {
            string scope = options.ContainsKey("scope") ? Convert.ToString(options["scope"]) : "slides";
            var selected = scope == "shapes" ? Selection() : new List<dynamic>();
            var slides = Slides(scope == "all" || Flag(options, "all", false)); string folder = Folder("选择导出目录，将在目录中创建独立文件夹"); if (folder == null) return "已取消导出";
            string output = Path.Combine(folder, "SANDUN-图片-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff")); Directory.CreateDirectory(output);
            int dpi = (int)Number(options, "dpi", 300, 72, 600); int w = (int)Math.Round((float)Deck.PageSetup.SlideWidth / 72 * dpi), h = (int)Math.Round((float)Deck.PageSetup.SlideHeight / 72 * dpi);
            if (scope == "shapes" && IsWps) throw new InvalidOperationException("WPS 暂不支持按指定清晰度导出透明选区，请选择导出幻灯片。");
            if (scope == "shapes")
            {
                var batches = Flag(options, "separate", false) ? selected.Select(s => new List<dynamic> { s }).ToList() : new List<List<dynamic>> { selected };
                // Shape.Export uses point-based scale dimensions at 96 DPI;
                // Slide.Export takes output pixels. Keep the conversions separate.
                for (int i = 0; i < batches.Count; i++) Range(batches[i]).Export(Path.Combine(output, "selection-" + (i + 1).ToString("D3") + ".png"), 2, (int)Math.Round(w * .75), (int)Math.Round(h * .75), 1);
                return "已导出 " + batches.Count + " 张透明背景选区图片：" + output;
            }
            foreach (dynamic slide in slides) slide.Export(Path.Combine(output, "slide-" + ((int)slide.SlideIndex).ToString("D3") + ".png"), "PNG", w, h);
            return "已导出 " + slides.Count + " 张图片：" + output;
        }
        private static dynamic CopySlides(List<dynamic> selected, string temp)
        {
            dynamic source = Deck;
            string copy = Path.Combine(temp, "source.pptx"); source.SaveCopyAs(copy, 24);
            dynamic target = App.Presentations.Open(copy, 0, 0, 0);
            var ids = new HashSet<int>(selected.Select(s => (int)s.SlideIndex));
            for (int i = (int)target.Slides.Count; i >= 1; i--) if (!ids.Contains(i)) target.Slides.Item(i).Delete();
            return target;
        }
        private static SortedSet<string> Fonts(List<dynamic> slides)
        {
            var fonts = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (dynamic slide in slides) foreach (dynamic shape in Items(slide.Shapes)) foreach (dynamic leaf in Leaves(shape)) if (TextShape(leaf))
            {
                dynamic text = leaf.TextFrame.TextRange;
                for (int i = 1; i <= (int)text.Runs().Count; i++)
                {
                    dynamic font = text.Runs(i, 1).Font;
                    foreach (string name in new[] { (string)font.Name, (string)font.NameFarEast }) if (!string.IsNullOrWhiteSpace(name)) fonts.Add(name);
                }
            }
            return fonts;
        }
        private static string ExportFonts()
        {
            var names = Fonts(Slides(true)); string folder = Folder("选择字体导出目录"); if (folder == null) return "已取消导出";
            string output = Path.Combine(folder, "SANDUN-字体-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff")); Directory.CreateDirectory(output);
            var copied = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var missing = new List<string>();
            var installed = new List<KeyValuePair<string, string>>();
            foreach (var hive in new[] { Registry.LocalMachine, Registry.CurrentUser }) using (var key = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"))
            {
                if (key == null) continue;
                foreach (string label in key.GetValueNames())
                {
                    string file = Convert.ToString(key.GetValue(label));
                    if (!Path.IsPathRooted(file)) file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), file);
                    installed.Add(new KeyValuePair<string, string>(label, file));
                }
            }
            foreach (string name in names)
            {
                var matches = installed.Where(p => p.Key.Equals(name, StringComparison.OrdinalIgnoreCase) || p.Key.StartsWith(name + " ", StringComparison.OrdinalIgnoreCase) || p.Key.StartsWith(name + "&", StringComparison.OrdinalIgnoreCase)).ToList();
                if (matches.Count == 0) { missing.Add(name); continue; }
                bool found = false;
                foreach (var match in matches) if (File.Exists(match.Value)) { if (copied.Add(match.Value)) File.Copy(match.Value, Path.Combine(output, Path.GetFileName(match.Value)), true); found = true; }
                if (!found) missing.Add(name);
            }
            File.WriteAllLines(Path.Combine(output, "字体清单.txt"), names.Concat(new[] { "", "未找到本机字体文件：" }).Concat(missing), Encoding.UTF8);
            return "已导出 " + copied.Count + " 个字体文件；未找到 " + missing.Count + " 项，详见字体清单：" + output;
        }
        private static string RoundCorners(Dictionary<string, object> options)
        {
            double radius = Number(options, "radius", 8, 0.1, 1000);
            var originals = Selection(); var replacements = new List<dynamic>(); var sources = new List<dynamic>(); int corners = 0;
            using (var clipboard = new ClipboardSnapshot())
            try
            {
                foreach (dynamic shape in originals)
                {
                    int changed; dynamic result = RoundedGeometry.Prepare(shape, radius, out changed);
                    if (result != null) { replacements.Add(result); sources.Add(shape); corners += changed; }
                }
            }
            catch { foreach (dynamic shape in replacements) try { shape.Delete(); } catch { } throw; }
            foreach (dynamic shape in sources) shape.Delete();
            if (replacements.Count > 0) Select(replacements);
            return corners == 0 ? "所选图形没有需要圆角化的拐角，光滑轮廓已保留。" : "已处理 " + replacements.Count + " 个形状、" + corners + " 个拐角，可按 Ctrl+Z 撤销。";
        }
        private static void Outline()
        {
            var originals = Selection(); var converted = new List<dynamic>(); string temp = TemporaryDirectory();
            if (originals.Any(s => !Leaves((object)s).Any(leaf => TextShape(leaf)))) throw new InvalidOperationException("请选择包含文字的文本框、形状或组合。");
            try
            {
                foreach (dynamic shape in originals)
                {
                    string source = Path.Combine(temp, "text-" + shape.Id + ".svg"), output = Path.Combine(temp, "outlines-" + shape.Id + ".svg");
                    shape.Export(source, 6);
                    FontOutlines.Convert(source, output);
                    var svg = System.Xml.Linq.XDocument.Load(output).Root;
                    float width = float.Parse((string)svg.Attribute("width"), CultureInfo.InvariantCulture) * 0.75f;
                    float height = float.Parse((string)svg.Attribute("height"), CultureInfo.InvariantCulture) * 0.75f;
                    float left = shape.Left, top = shape.Top;
                    var group = svg.Elements().FirstOrDefault(e => e.Name.LocalName == "g");
                    var transform = group == null ? "" : (string)group.Attribute("transform") ?? "";
                    var match = System.Text.RegularExpressions.Regex.Match(transform, @"^translate\(\s*([-+\d.]+)[ ,]+([-+\d.]+)\s*\)$");
                    if (match.Success) { left = -float.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) * 0.75f; top = -float.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture) * 0.75f; }
                    dynamic result = shape.Parent.Shapes.AddPicture(output, 0, -1, left, top, width, height);
                    converted.Add(result); result.Name = "SANDUN 字体轮廓 " + result.Id;
                    while ((int)result.ZOrderPosition > (int)shape.ZOrderPosition + 1) result.ZOrder(3);
                }
            }
            catch { foreach (dynamic shape in converted) try { shape.Delete(); } catch { } throw; }
            finally { try { Directory.Delete(temp, true); } catch { } }
            foreach (dynamic shape in originals) shape.Delete();
            Select(converted);
        }
        private static void CaptureEffects(dynamic target, double factor, List<Action> restore, bool shapeEffects = true)
        {
            if ((int)target.Shadow.Visible != 0)
            {
                float blur = target.Shadow.Blur, x = target.Shadow.OffsetX, y = target.Shadow.OffsetY;
                restore.Add(() => { target.Shadow.Blur = (float)(blur * factor); target.Shadow.OffsetX = (float)(x * factor); target.Shadow.OffsetY = (float)(y * factor); });
            }
            float radius = target.Glow.Radius;
            if (radius > 0) restore.Add(() => target.Glow.Radius = (float)(radius * factor));
            if ((int)target.Reflection.Type != 0) { float offset = target.Reflection.Offset; restore.Add(() => target.Reflection.Offset = (float)(offset * factor)); }
            // Font2 has no SoftEdge object.
            if (shapeEffects)
            {
                float soft = target.SoftEdge.Radius;
                if (soft > 0) restore.Add(() => target.SoftEdge.Radius = (float)(soft * factor));
            }
        }
        private static string PageHeight()
        {
            const string tag = "SANDUN_PAGE_HEIGHT";
            var masters = Items((object)Deck.Designs).Select(d => (object)d.SlideMaster).ToList();
            bool enabled = masters.Any(m => Items((object)((dynamic)m).Shapes).Any(s => Convert.ToString(s.Tags.Item(tag)) == "1"));
            float w = Deck.PageSetup.SlideWidth, h = Deck.PageSetup.SlideHeight;
            foreach (dynamic master in masters)
            {
                foreach (dynamic shape in Items(master.Shapes)) if (Convert.ToString(shape.Tags.Item(tag)) == "1") shape.Delete();
                if (enabled) continue;
                foreach (float y in new[] { h / 2 - h * 2, h / 2 + h * 2 })
                {
                    dynamic marker = master.Shapes.AddShape(1, w / 2 - 1, y, 2, 2);
                    marker.Name = "SANDUN 页面定位 " + marker.Id; marker.Tags.Add(tag, "1"); marker.Line.Visible = 0; marker.Fill.Visible = -1; marker.Fill.Transparency = 1;
                }
            }
            return enabled ? "已关闭页面撑高" : "已开启页面撑高，再次点击可关闭";
        }
        private static string ExportVideo(Dictionary<string, object> options)
        {
            if (VideoProgress.Busy) { ToolPanel.Open("video-progress"); return "正在导出上一份视频，请稍候。"; }
            var selected = Slides(); string path = SavePath("导出选定页视频", "MP4 视频|*.mp4", "选定幻灯片.mp4"); if (path == null) return "已取消导出";
            int seconds = (int)Number(options, "seconds", 5, 1, 300); string temp = TemporaryDirectory(); dynamic target = null;
            try
            {
                target = CopySlides(selected, temp); target.CreateVideo(path, true, seconds, 1080, 30, 85);
                // The asynchronous exporter needs its presentation alive until it finishes.
                VideoProgress.Show(target, path, temp); target = null;
                return "视频正在导出，进度窗口完成后即可使用文件";
            }
            finally { if (target != null) { target.Saved = -1; target.Close(); Clean(temp); } }
        }
    }
}
