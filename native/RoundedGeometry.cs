using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Windows.Forms;
using System.Xml.Linq;

namespace Sandun.PresentationBootstrap
{
    internal static class RoundedGeometry
    {
        private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
        private struct P
        {
            internal double X, Y;
            internal P(double x, double y) { X = x; Y = y; }
            public static P operator +(P a, P b) { return new P(a.X + b.X, a.Y + b.Y); }
            public static P operator -(P a, P b) { return new P(a.X - b.X, a.Y - b.Y); }
            public static P operator *(P a, double n) { return new P(a.X * n, a.Y * n); }
            internal double Length { get { return Math.Sqrt(X * X + Y * Y); } }
            internal P Unit { get { return Length < 1e-8 ? new P() : this * (1 / Length); } }
        }
        private sealed class Segment
        {
            internal P Start, C1, C2, End; internal bool Curve;
            internal P At(double t) { double u = 1 - t; return Curve ? Start * (u * u * u) + C1 * (3 * u * u * t) + C2 * (3 * u * t * t) + End * (t * t * t) : Start * u + End * t; }
            internal P Tangent(bool end)
            {
                P vector = Curve ? (end ? End - C2 : C1 - Start) : End - Start;
                if (vector.Length < 1e-8 && Curve) vector = end ? End - C1 : C2 - Start;
                return vector.Length < 1e-8 ? (End - Start).Unit : vector.Unit;
            }
            internal double Length(double from = 0, double to = 1)
            {
                P last = At(from); double length = 0; int steps = Curve ? 64 : 1;
                for (int i = 1; i <= steps; i++) { P p = At(from + (to - from) * i / steps); length += (p - last).Length; last = p; }
                return length;
            }
            internal double Parameter(double distance, bool fromEnd)
            {
                if (distance <= 0) return fromEnd ? 1 : 0;
                double low = 0, high = 1;
                for (int i = 0; i < 24; i++) { double mid = (low + high) / 2; if (Length(0, mid) < (fromEnd ? Length() - distance : distance)) low = mid; else high = mid; }
                return (low + high) / 2;
            }
            internal Segment Part(double from, double to)
            {
                P start = At(from), end = At(to);
                if (!Curve) return new Segment { Start = start, End = end };
                P d0 = (C1 - Start) * (3 * (1 - from) * (1 - from)) + (C2 - C1) * (6 * (1 - from) * from) + (End - C2) * (3 * from * from);
                P d1 = (C1 - Start) * (3 * (1 - to) * (1 - to)) + (C2 - C1) * (6 * (1 - to) * to) + (End - C2) * (3 * to * to);
                return new Segment { Start = start, End = end, C1 = start + d0 * ((to - from) / 3), C2 = end - d1 * ((to - from) / 3), Curve = true };
            }
        }
        internal static dynamic Prepare(dynamic original, double radius, out int corners)
        {
            dynamic copy = null, pasted = null; corners = 0;
            try
            {
                if ((int)original.Type != 1 && (int)original.Type != 2 && (int)original.Type != 5) throw new InvalidOperationException("圆角适用于 PPT 形状和自由曲线，请先选择形状；组合请先解散。");
                copy = NativeTools.DuplicateShape(original); copy.Left = original.Left; copy.Top = original.Top;
                if ((int)copy.Nodes.Count < 2) throw new InvalidOperationException("此对象没有可处理的轮廓节点。");
                copy.Nodes.SetEditingType(1, 1);
                byte[] source = null;
                for (int attempt = 0; attempt < 8 && source == null; attempt++)
                {
                    Clipboard.Clear(); copy.Copy();
                    System.Threading.Thread.Sleep(40); Application.DoEvents();
                    var data = Clipboard.GetDataObject();
                    var clip = data == null ? null : data.GetData("Art::GVML ClipFormat") as MemoryStream;
                    if (clip != null)
                    {
                        byte[] candidate = clip.ToArray();
                        try
                        {
                            using (var check = new ZipArchive(new MemoryStream(candidate), ZipArchiveMode.Read))
                            using (var xml = check.GetEntry("clipboard/drawings/drawing1.xml").Open()) XDocument.Load(xml);
                            source = candidate;
                        }
                        catch (InvalidDataException) { }
                    }
                }
                if (source == null) throw new InvalidOperationException("当前演示软件没有提供可编辑图形数据。");
                double dx = 0, dy = 0;
                if ((int)original.HasTextFrame != 0 && (int)original.TextFrame.HasText != 0)
                {
                    double x = (float)original.TextFrame2.TextRange.BoundLeft - (float)copy.TextFrame2.TextRange.BoundLeft;
                    double y = (float)original.TextFrame2.TextRange.BoundTop - (float)copy.TextFrame2.TextRange.BoundTop;
                    double angle = (float)copy.Rotation * Math.PI / 180;
                    dx = x * Math.Cos(angle) + y * Math.Sin(angle); dy = -x * Math.Sin(angle) + y * Math.Cos(angle);
                    if ((int)copy.HorizontalFlip != 0) dx = -dx;
                    if ((int)copy.VerticalFlip != 0) dy = -dy;
                }
                var snapshot = new string[1];
                byte[] rounded = Transform(source, radius, out corners, dx, dy, CornerSourceCache.Read(original), snapshot);
                if (corners == 0) { copy.Delete(); copy = null; return null; }
                var payload = new DataObject(); payload.SetData("Art::GVML ClipFormat", false, new MemoryStream(rounded));
                Clipboard.SetDataObject(payload, true);
                for (int attempt = 0; ; attempt++)
                {
                    try { pasted = original.Parent.Shapes.Paste().Item(1); break; }
                    catch (System.Runtime.InteropServices.COMException) { if (attempt >= 5) throw; System.Threading.Thread.Sleep(60); Application.DoEvents(); Clipboard.SetDataObject(payload, true); }
                }
                // Office may normalize compound paths lazily when their nodes are first read.
                // Materialize that geometry before positioning the replacement.
                for (int i = 1; i <= (int)pasted.Nodes.Count; i++) { object points = pasted.Nodes.Item(i).Points; }
                pasted.Left = copy.Left; pasted.Top = copy.Top;
                CornerSourceCache.Write(pasted, snapshot[0]);
                while ((int)pasted.ZOrderPosition > (int)original.ZOrderPosition + 1) pasted.ZOrder(3);
                return pasted;
            }
            catch { if (pasted != null) try { pasted.Delete(); } catch { } throw; }
            finally { if (copy != null) try { copy.Delete(); } catch { } }
        }
        internal static byte[] Transform(byte[] source, double radius, out int corners, double dx = 0, double dy = 0, string savedGeometry = null, string[] snapshot = null)
        {
            corners = 0;
            using (var stream = new MemoryStream())
            {
                stream.Write(source, 0, source.Length); stream.Position = 0;
                using (var zip = new ZipArchive(stream, ZipArchiveMode.Update, true))
                {
                    var entry = zip.GetEntry("clipboard/drawings/drawing1.xml");
                    if (entry == null) throw new InvalidDataException("图形数据缺少轮廓。");
                    XDocument doc; using (var input = entry.Open()) doc = XDocument.Load(input);
                    foreach (var current in doc.Descendants(A + "custGeom").ToList())
                    {
                        var geometry = current;
                        if (savedGeometry != null) { geometry = XElement.Parse(savedGeometry); current.ReplaceWith(geometry); }
                        var ext = geometry.Parent.Element(A + "xfrm").Element(A + "ext");
                        double width = Num(ext, "cx") / 12700, height = Num(ext, "cy") / 12700;
                        var textRect = geometry.Element(A + "rect");
                        if (savedGeometry == null && textRect != null && (Math.Abs(dx) > .01 || Math.Abs(dy) > .01))
                        {
                            var guides = geometry.Element(A + "gdLst");
                            foreach (string edge in new[] { "l", "r", "t", "b" })
                            {
                                bool horizontal = edge == "l" || edge == "r";
                                double full = horizontal ? width : height, shift = horizontal ? dx : dy;
                                string name = "sandunText" + edge;
                                guides.Add(new XElement(A + "gd", new XAttribute("name", name), new XAttribute("fmla", "*/ " + (horizontal ? "w" : "h") + " " + (long)Math.Round((shift + (edge == "r" || edge == "b" ? full : 0)) * 12700) + " " + (long)Math.Round(full * 12700))));
                                textRect.SetAttributeValue(edge, name);
                            }
                        }
                        if (snapshot != null) snapshot[0] = geometry.ToString(SaveOptions.DisableFormatting);
                        if (geometry.Element(A + "pathLst").Elements(A + "path").Count() > 1)
                        {
                            int compound = CompoundGeometry.Round(geometry, width, height, radius);
                            if (compound >= 0) { corners += compound; continue; }
                        }
                        foreach (var path in geometry.Element(A + "pathLst").Elements(A + "path").ToList())
                            corners += RoundPath(path, radius, width / Num(path, "w"), height / Num(path, "h"));
                    }
                    using (var output = entry.Open()) { output.SetLength(0); doc.Save(output); }
                }
                return stream.ToArray();
            }
        }
        private static double Num(XElement e, string name) { return double.Parse((string)e.Attribute(name), CultureInfo.InvariantCulture); }
        private static P Point(XElement e, double sx, double sy) { return new P(Num(e, "x") * sx, Num(e, "y") * sy); }
        private static XElement Point(P p, double sx, double sy) { return new XElement(A + "pt", new XAttribute("x", Math.Round(p.X / sx)), new XAttribute("y", Math.Round(p.Y / sy))); }
        internal static int RoundPath(XElement path, double radius, double sx, double sy)
        {
            if (sx <= 0 || sy <= 0 || double.IsInfinity(sx) || double.IsInfinity(sy)) return 0;
            var output = new XElement(path.Name, path.Attributes()); var segments = new List<Segment>();
            P start = new P(), last = new P(); int count = 0; bool hasMove = false;
            foreach (var command in path.Elements())
            {
                var points = command.Elements(A + "pt").Select(p => Point(p, sx, sy)).ToArray();
                switch (command.Name.LocalName)
                {
                    case "moveTo":
                        if (hasMove) count += Contour(output, segments, segments.Count > 1 && (segments[segments.Count - 1].End - start).Length < .001, radius, sx, sy, start);
                        segments.Clear(); start = last = points[0]; hasMove = true; break;
                    case "lnTo": segments.Add(new Segment { Start = last, End = points[0] }); last = points[0]; break;
                    case "cubicBezTo": segments.Add(new Segment { Start = last, C1 = points[0], C2 = points[1], End = points[2], Curve = true }); last = points[2]; break;
                    case "quadBezTo": segments.Add(new Segment { Start = last, C1 = last + (points[0] - last) * (2.0 / 3), C2 = points[1] + (points[0] - points[1]) * (2.0 / 3), End = points[1], Curve = true }); last = points[1]; break;
                    case "close":
                        if ((last - start).Length > 0.0001) segments.Add(new Segment { Start = last, End = start });
                        count += Contour(output, segments, true, radius, sx, sy, start); segments.Clear(); hasMove = false; break;
                    default: throw new InvalidOperationException("图形轮廓包含尚未转换的路径：" + command.Name.LocalName);
                }
            }
            if (hasMove) count += Contour(output, segments, segments.Count > 1 && (segments[segments.Count - 1].End - start).Length < .001, radius, sx, sy, start);
            if (count > 0) path.ReplaceNodes(output.Nodes());
            return count;
        }
        private static int Contour(XElement output, List<Segment> raw, bool closed, double radius, double sx, double sy, P start)
        {
            var segments = raw.Where(s => s.Length() > 0.001).ToArray(); int n = segments.Length, count = 0;
            var before = new double[n]; var after = new double[n];
            for (int i = 0; i < n; i++)
            {
                if (!closed && i == n - 1) break;
                int j = (i + 1) % n; P a = segments[i].Tangent(true), b = segments[j].Tangent(false);
                double dot = Math.Max(-1, Math.Min(1, a.X * b.X + a.Y * b.Y)), angle = Math.Acos(dot);
                if (angle < 0.025) continue;
                // Both ends of a short edge keep at least 20% of its length, even on dense stars.
                double trim = Math.Min(angle > Math.PI - 0.025 ? radius : radius * Math.Tan(angle / 2), Math.Min(segments[i].Length(), segments[j].Length()) * 0.4);
                if (trim < 0.0001) continue;
                after[i] = before[j] = trim; count++;
            }
            var parts = segments.Select((s, i) => s.Part(s.Parameter(before[i], false), s.Parameter(after[i], true))).ToArray();
            output.Add(new XElement(A + "moveTo", Point(n == 0 ? start : parts[0].Start, sx, sy)));
            for (int i = 0; i < n; i++)
            {
                Write(output, parts[i], sx, sy);
                if (after[i] <= 0) continue;
                int j = (i + 1) % n; P a = parts[i].Tangent(true), b = parts[j].Tangent(false);
                double angle = Math.Acos(Math.Max(-1, Math.Min(1, a.X * b.X + a.Y * b.Y)));
                double handle = Math.Min(after[i] * 0.95, (parts[j].Start - parts[i].End).Length / (3 * Math.Max(0.15, Math.Pow(Math.Cos(angle / 4), 2))));
                Write(output, new Segment { Start = parts[i].End, C1 = parts[i].End + a * handle, C2 = parts[j].Start - b * handle, End = parts[j].Start, Curve = true }, sx, sy);
            }
            if (closed) output.Add(new XElement(A + "close"));
            return count;
        }
        private static void Write(XElement output, Segment segment, double sx, double sy)
        {
            output.Add(segment.Curve ? new XElement(A + "cubicBezTo", Point(segment.C1, sx, sy), Point(segment.C2, sx, sy), Point(segment.End, sx, sy)) : new XElement(A + "lnTo", Point(segment.End, sx, sy)));
        }
    }
}
