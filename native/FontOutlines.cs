using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Xml.Linq;

namespace Sandun.PresentationBootstrap
{
    internal static class FontOutlines
    {
        private static readonly XNamespace Svg = "http://www.w3.org/2000/svg";
        private static string Value(XElement element, string name, string fallback)
        {
            foreach (var node in element.AncestorsAndSelf())
            {
                var value = (string)node.Attribute(name);
                if (value != null) return value;
                var style = ((string)node.Attribute("style") ?? "").Split(';').Select(x => x.Split(':')).FirstOrDefault(x => x.Length == 2 && x[0].Trim() == name);
                if (style != null) return style[1].Trim();
            }
            return fallback;
        }
        private static float Number(string value) { return float.Parse(value.Replace("px", "").Trim(), CultureInfo.InvariantCulture); }
        private static string F(float value) { return value.ToString("0.###", CultureInfo.InvariantCulture); }
        internal static int Convert(string source, string destination)
        {
            var doc = XDocument.Load(source); int count = 0;
            foreach (var text in doc.Descendants(Svg + "text").ToList())
            {
                float x = Number((string)text.Attribute("x") ?? "0"), y = Number((string)text.Attribute("y") ?? "0");
                var group = new XElement(Svg + "g", text.Attributes().Where(a => a.Name.LocalName != "x" && a.Name.LocalName != "y"));
                Render(text, group, ref x, ref y, ref count);
                text.ReplaceWith(group);
            }
            if (count == 0) throw new InvalidOperationException("未找到可转换的文字，原对象已保留。");
            doc.Save(destination); return count;
        }
        private static void Render(XElement source, XElement target, ref float x, ref float y, ref int count)
        {
            if (source.Attribute("x") != null) x = Number((string)source.Attribute("x"));
            if (source.Attribute("y") != null) y = Number((string)source.Attribute("y"));
            x += Number((string)source.Attribute("dx") ?? "0"); y += Number((string)source.Attribute("dy") ?? "0");
            foreach (var node in source.Nodes())
            {
                var child = node as XElement;
                if (child != null)
                {
                    var group = new XElement(Svg + "g", child.Attributes().Where(a => !new[] { "x", "y", "dx", "dy" }.Contains(a.Name.LocalName)));
                    Render(child, group, ref x, ref y, ref count); target.Add(group); continue;
                }
                var text = node as XText; if (text == null || text.Value.Length == 0) continue;
                float size = Number(Value(source, "font-size", "16"));
                string familyName = Value(source, "font-family", "Arial").Split(',')[0].Trim(' ', '\'', '"');
                using (var family = new FontFamily(familyName))
                using (var path = new GraphicsPath())
                using (var format = (StringFormat)StringFormat.GenericTypographic.Clone())
                {
                    var style = FontStyle.Regular;
                    string weight = Value(source, "font-weight", "400");
                    if (weight == "bold" || (weight != "normal" && Number(weight) >= 600)) style |= FontStyle.Bold;
                    if (new[] { "italic", "oblique" }.Contains(Value(source, "font-style", "normal"))) style |= FontStyle.Italic;
                    if (!family.IsStyleAvailable(style)) throw new InvalidOperationException("字体 " + familyName + " 缺少对应字形，原对象已保留。");
                    format.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces;
                    float ascent = size * family.GetCellAscent(style) / family.GetEmHeight(style);
                    path.AddString(text.Value, family, (int)style, size, new PointF(x, y - ascent), format);
                    if (path.PointCount > 0)
                    {
                        var d = new StringBuilder(); var points = path.PathPoints; var types = path.PathTypes;
                        for (int i = 0; i < points.Length; i++)
                        {
                            int type = types[i] & 7;
                            if (type == 0 || type == 1) d.Append(type == 0 ? "M" : "L").Append(F(points[i].X)).Append(' ').Append(F(points[i].Y));
                            else if (type == 3)
                            {
                                d.Append("C"); for (int j = 0; j < 3; j++) { d.Append(F(points[i + j].X)).Append(' ').Append(F(points[i + j].Y)).Append(' '); } i += 2;
                            }
                            if ((types[i] & 128) != 0) d.Append('Z');
                        }
                        target.Add(new XElement(Svg + "path", new XAttribute("d", d.ToString()), new XAttribute("fill-rule", "evenodd")));
                        count++;
                    }
                    using (var bitmap = new Bitmap(1, 1))
                    using (var graphics = Graphics.FromImage(bitmap))
                    using (var font = new Font(family, size, style, GraphicsUnit.Pixel)) x += graphics.MeasureString(text.Value, font, int.MaxValue, format).Width;
                }
            }
        }
    }
}
