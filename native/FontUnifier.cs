using System;
using System.Collections.Generic;
using System.Drawing.Text;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;

namespace Sandun.PresentationBootstrap
{
    internal static class FontUnifier
    {
        private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
        internal static string[] Fonts() { using (var fonts = new InstalledFontCollection()) return fonts.Families.Select(f => f.Name).OrderBy(n => n).ToArray(); }
        internal static string[] DocumentFonts()
        {
            var names = new SortedSet<string>(StringComparer.CurrentCultureIgnoreCase);
            if (!NativeTools.IsWps) foreach (dynamic font in NativeTools.Items(NativeTools.Deck.Fonts))
            {
                string name = font.Name;
                if (!string.IsNullOrWhiteSpace(name) && !name.StartsWith("+")) names.Add(name);
            }
            // Presentation.Fonts omits East Asian run overrides in both hosts.
            foreach (dynamic slide in NativeTools.Items(NativeTools.Deck.Slides)) CollectFonts(slide.Shapes, names);
            foreach (dynamic design in NativeTools.Items(NativeTools.Deck.Designs))
            {
                CollectFonts(design.SlideMaster.Shapes, names);
                foreach (dynamic layout in NativeTools.Items(design.SlideMaster.CustomLayouts)) CollectFonts(layout.Shapes, names);
            }
            return names.ToArray();
        }
        private static void CollectFonts(dynamic shapes, SortedSet<string> names)
        {
            foreach (dynamic shape in NativeTools.Items(shapes)) foreach (dynamic leaf in NativeTools.Leaves(shape))
            {
                int type = 0; try { type = leaf.Type; } catch (NotImplementedException) { }
                if (type == 24) foreach (dynamic node in NativeTools.Items(leaf.SmartArt.AllNodes)) CollectRange(node.TextFrame2.TextRange, names);
                if (type == 3)
                {
                    dynamic chart = leaf.Chart;
                    CollectRange(chart.ChartArea.Format.TextFrame2.TextRange, names);
                    if ((bool)chart.HasTitle) CollectRange(chart.ChartTitle.Format.TextFrame2.TextRange, names);
                    if ((bool)chart.HasLegend) CollectRange(chart.Legend.Format.TextFrame2.TextRange, names);
                    foreach (dynamic axis in NativeTools.Items(chart.Axes()))
                    {
                        string name = axis.TickLabels.Font.Name;
                        if (!string.IsNullOrWhiteSpace(name) && !name.StartsWith("+")) names.Add(name);
                        if ((bool)axis.HasTitle) CollectRange(axis.AxisTitle.Format.TextFrame2.TextRange, names);
                    }
                    foreach (dynamic series in NativeTools.Items(chart.SeriesCollection())) if ((bool)series.HasDataLabels)
                        foreach (dynamic label in NativeTools.Items(series.DataLabels())) CollectRange(label.Format.TextFrame2.TextRange, names);
                }
                if ((int)leaf.HasTextFrame == 0 || (int)leaf.TextFrame.HasText == 0) continue;
                CollectRange(leaf.TextFrame2.TextRange, names);
            }
        }
        private static void CollectRange(dynamic text, SortedSet<string> names)
        {
            try
            {
                for (int i = 1; i <= (int)text.Runs().Count; i++)
                {
                    dynamic font = text.Runs(i, 1).Font;
                    foreach (string name in new[] { (string)font.Name, (string)font.NameAscii, (string)font.NameFarEast, (string)font.NameOther })
                        if (!string.IsNullOrWhiteSpace(name) && !name.StartsWith("+")) names.Add(name);
                }
            }
            catch (UnauthorizedAccessException) { /* WPS chart areas expose no readable text runs. Titles are read separately. */ }
            catch (NotImplementedException) { /* WPS exposes some decorative text ranges without a Runs implementation. */ }
        }
        internal static string Value(Dictionary<string, object> o, string key, string fallback) { return o.ContainsKey(key) ? Convert.ToString(o[key]) : fallback; }
        internal static string Execute(Dictionary<string, object> o)
        {
            string chinese = NativeTools.Flag(o, "chineseEnabled", true) ? Value(o, "chinese", "微软雅黑").Trim() : null;
            string english = NativeTools.Flag(o, "englishEnabled", true) ? Value(o, "english", "Arial").Trim() : null;
            if (chinese == null && english == null) throw new ArgumentException("请至少启用一种字体。");
            if (chinese == "" || english == "") throw new ArgumentException("请选择字体。");
            string mode = Value(o, "mode", "theme");
            if (mode == "core") return SaveCore(chinese, english);
            if (mode == "theme")
            {
                int count = 0;
                foreach (dynamic design in NativeTools.Items(NativeTools.Deck.Designs))
                {
                    dynamic fonts = design.SlideMaster.Theme.ThemeFontScheme;
                    if (english != null) { fonts.MajorFont(1).Name = english; fonts.MinorFont(1).Name = english; }
                    if (chinese != null) { fonts.MajorFont(3).Name = chinese; fonts.MinorFont(3).Name = chinese; }
                    count++;
                }
                return "已统一 " + count + " 套母版的中英主题字体；手动指定字体的文字请使用强制或核心模式。";
            }
            if (mode != "force") throw new ArgumentException("未知的字体模式。");
            var slides = NativeTools.Slides(); int changed = 0, charts = 0;
            foreach (dynamic slide in slides) foreach (dynamic root in NativeTools.Items(slide.Shapes)) foreach (dynamic shape in NativeTools.Leaves(root))
            {
                if ((int)shape.HasTextFrame != 0) { ApplyFont(shape.TextFrame2.TextRange.Font, chinese, english); changed++; }
                int kind = 0;
                try { kind = shape.Type; } catch (NotImplementedException) { /* Office table-cell shapes have text but no shape type. */ }
                if (kind == 24) foreach (dynamic node in NativeTools.Items(shape.SmartArt.AllNodes)) { ApplyFont(node.TextFrame2.TextRange.Font, chinese, english); changed++; }
                if (kind == 3)
                {
                    dynamic chart = shape.Chart;
                    ApplyFont(chart.ChartArea.Format.TextFrame2.TextRange.Font, chinese, english);
                    if ((bool)chart.HasTitle) ApplyFont(chart.ChartTitle.Format.TextFrame2.TextRange.Font, chinese, english);
                    if ((bool)chart.HasLegend) ApplyFont(chart.Legend.Format.TextFrame2.TextRange.Font, chinese, english);
                    foreach (dynamic axis in NativeTools.Items(chart.Axes()))
                    {
                        if ((bool)axis.HasTitle) ApplyFont(axis.AxisTitle.Format.TextFrame2.TextRange.Font, chinese, english);
                    }
                    foreach (dynamic series in NativeTools.Items(chart.SeriesCollection())) if ((bool)series.HasDataLabels)
                        foreach (dynamic label in NativeTools.Items(series.DataLabels())) ApplyFont(label.Format.TextFrame2.TextRange.Font, chinese, english);
                    charts++;
                }
            }
            return "已统一当前选中的 " + slides.Count + " 页（" + changed + " 个文字对象、" + charts + " 个图表），可按 Ctrl+Z 撤销。" + (charts > 0 ? " 图表坐标轴刻度继承图表字体；若刻度单独指定了字体，请使用核心模式彻底替换。" : "");
        }
        private static void ApplyFont(dynamic font, string chinese, string english)
        {
            if (english != null) font.NameAscii = english;
            if (chinese != null) font.NameFarEast = chinese;
        }
        private static string SaveCore(string chinese, string english)
        {
            bool macros = (bool)NativeTools.Deck.HasVBProject;
            string ext = macros ? ".pptm" : ".pptx";
            string path = NativeTools.SaveDestination("统一字体 · 另存为", "PowerPoint 演示文稿|*" + ext, "统一字体" + ext);
            if (string.IsNullOrEmpty(path)) return "已取消保存";
            if (string.Equals(Path.GetFullPath(path), (string)NativeTools.Deck.FullName, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("核心模式请另存为新文件，不能覆盖当前打开的文稿。");
            string temporary = Path.Combine(Path.GetDirectoryName(path), ".sandun-fonts-" + Guid.NewGuid().ToString("N") + ext);
            try
            {
                NativeTools.Deck.SaveCopyAs(temporary, macros ? 25 : 24);
                using (var zip = ZipFile.Open(temporary, ZipArchiveMode.Update))
                {
                    foreach (var entry in zip.Entries.Where(e => e.FullName.StartsWith("ppt/") && e.FullName.EndsWith(".xml")).ToList())
                    {
                        XDocument doc; using (var input = entry.Open()) doc = XDocument.Load(input);
                        Rewrite(doc, chinese, english);
                        using (var output = entry.Open()) { output.SetLength(0); doc.Save(output); }
                    }
                }
                if (File.Exists(path)) File.Replace(temporary, path, null); else File.Move(temporary, path);
                return "已另存统一字体文稿：" + path;
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        internal static void Rewrite(XDocument doc, string chinese, string english)
        {
            foreach (var font in doc.Descendants().Where(e => e.Name == A + "latin" || e.Name == A + "ea" || e.Name == A + "font"))
            {
                if (font.Name == A + "latin" && english != null) font.SetAttributeValue("typeface", english);
                if (chinese != null && (font.Name == A + "ea" || new[] { "Hans", "Hant", "Jpan", "Hang" }.Contains((string)font.Attribute("script")))) font.SetAttributeValue("typeface", chinese);
            }
            foreach (var run in doc.Descendants(A + "r").Concat(doc.Descendants(A + "fld")).ToList()) if (run.Element(A + "rPr") == null) run.AddFirst(new XElement(A + "rPr"));
            foreach (var properties in doc.Descendants().Where(e => e.Name == A + "rPr" || e.Name == A + "defRPr" || e.Name == A + "endParaRPr").ToList())
            {
                SetTypeface(properties, "latin", english); SetTypeface(properties, "ea", chinese);
            }
        }
        private static void SetTypeface(XElement parent, string name, string font)
        {
            if (font == null) return;
            var node = parent.Element(A + name);
            if (node == null)
            {
                node = new XElement(A + name);
                var next = parent.Elements().FirstOrDefault(e => new[] { "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst" }.Skip(name == "ea" ? 1 : 0).Contains(e.Name.LocalName));
                if (next != null) next.AddBeforeSelf(node); else parent.Add(node);
            }
            node.SetAttributeValue("typeface", font);
        }
    }
}
