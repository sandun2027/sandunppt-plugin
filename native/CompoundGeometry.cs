using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using System.Xml.Linq;

namespace Sandun.PresentationBootstrap
{
    internal static class CompoundGeometry
    {
        private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
        private const double Tolerance = 0.001;
        internal static int Round(XElement geometry, double width, double height, double radius)
        {
            var paths = geometry.Element(A + "pathLst").Elements(A + "path").ToArray();
            var filled = paths.Where(p => (string)p.Attribute("fill") != "none").ToArray();
            if (filled.Length == 0) return -1;
            Geometry silhouette = Geometry.Empty;
            foreach (var path in filled) silhouette = Geometry.Combine(silhouette, Read(path, width, height), GeometryCombineMode.Union, null, Tolerance, ToleranceType.Absolute);
            var outline = Write(silhouette.GetOutlinedPathGeometry(Tolerance, ToleranceType.Absolute), width, height);
            int corners = RoundedGeometry.RoundPath(outline, radius, 1.0 / 12700, 1.0 / 12700);
            if (corners == 0) return -1;
            Geometry rounded = Read(outline, width, height);
            foreach (var path in paths)
            {
                var original = Read(path, width, height);
                XElement result;
                if ((string)path.Attribute("fill") != "none")
                {
                    // Round a shared silhouette once. Clipping its faces to that same boundary
                    // preserves their shading and eliminates gaps between independently rounded faces.
                    Geometry clipped = filled.Length > 1 ? Geometry.Combine(original, rounded, GeometryCombineMode.Intersect, null, Tolerance, ToleranceType.Absolute) : rounded;
                    result = Write(clipped.GetOutlinedPathGeometry(Tolerance, ToleranceType.Absolute), width, height);
                }
                else
                {
                    var curves = new PathGeometry();
                    foreach (var figure in original.Figures)
                    {
                        if (figure.IsClosed)
                        {
                            var region = new PathGeometry(new[] { figure });
                            var clipped = Geometry.Combine(region, rounded, GeometryCombineMode.Intersect, null, Tolerance, ToleranceType.Absolute);
                            curves.AddGeometry(clipped);
                        }
                        else ClipLine(figure, silhouette, rounded, curves, width, height, radius);
                    }
                    result = Write(curves, width, height);
                }
                path.SetAttributeValue("w", result.Attribute("w").Value); path.SetAttributeValue("h", result.Attribute("h").Value);
                path.ReplaceNodes(result.Nodes());
            }
            return corners;
        }
        private static void ClipLine(PathFigure figure, Geometry original, Geometry rounded, PathGeometry output, double width, double height, double radius)
        {
            var path = new PathGeometry(new[] { figure });
            var flat = path.GetFlattenedPathGeometry(0.01, ToleranceType.Absolute);
            var points = new List<Point> { flat.Figures[0].StartPoint };
            foreach (var segment in flat.Figures[0].Segments)
            {
                var line = segment as LineSegment; var poly = segment as PolyLineSegment;
                if (line != null) points.Add(line.Point); else if (poly != null) points.AddRange(poly.Points);
            }
            // Leaders deliberately extend outside the body; only clip interior seams.
            bool interior = true;
            for (int i = 1; i < points.Count; i++) if (!original.FillContains(Mix(points[i - 1], points[i], .5), .02, ToleranceType.Absolute)) interior = false;
            if (!interior)
            {
                var outside = Write(path, width, height);
                RoundedGeometry.RoundPath(outside, radius, 1.0 / 12700, 1.0 / 12700);
                output.AddGeometry(Read(outside, width, height)); return;
            }
            PathFigure current = null;
            for (int i = 1; i < points.Count; i++)
            {
                Point a = points[i - 1];
                int steps = rounded.FillContains(a, Tolerance, ToleranceType.Absolute) && rounded.FillContains(points[i], Tolerance, ToleranceType.Absolute) ? 1 : 16;
                for (int step = 1; step <= steps; step++)
                {
                    Point b = Mix(points[i - 1], points[i], step / (double)steps);
                    bool insideA = rounded.FillContains(a, Tolerance, ToleranceType.Absolute), insideB = rounded.FillContains(b, Tolerance, ToleranceType.Absolute);
                    Point start = a, end = b;
                    if (insideA != insideB)
                    {
                        double low = 0, high = 1;
                        for (int j = 0; j < 20; j++) { double mid = (low + high) / 2; if (rounded.FillContains(Mix(a, b, mid), Tolerance, ToleranceType.Absolute) == insideA) low = mid; else high = mid; }
                        Point cut = Mix(a, b, (low + high) / 2); if (insideA) end = cut; else start = cut;
                    }
                    if (insideA || insideB)
                    {
                        if (current == null) { current = new PathFigure { StartPoint = start, IsClosed = false, IsFilled = false }; output.Figures.Add(current); }
                        current.Segments.Add(new LineSegment(end, true));
                    }
                    if (!insideB) current = null;
                    a = b;
                }
            }
        }
        private static Point Mix(Point a, Point b, double t) { return new Point(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t); }
        private static double N(XElement e, string name) { return double.Parse((string)e.Attribute(name), CultureInfo.InvariantCulture); }
        private static PathGeometry Read(XElement path, double width, double height)
        {
            double sx = width / N(path, "w"), sy = height / N(path, "h");
            var geometry = new PathGeometry { FillRule = FillRule.Nonzero }; PathFigure figure = null;
            foreach (var command in path.Elements())
            {
                var points = command.Elements(A + "pt").Select(p => new Point(N(p, "x") * sx, N(p, "y") * sy)).ToArray();
                switch (command.Name.LocalName)
                {
                    case "moveTo": figure = new PathFigure { StartPoint = points[0], IsFilled = true }; geometry.Figures.Add(figure); break;
                    case "lnTo": figure.Segments.Add(new LineSegment(points[0], true)); break;
                    case "cubicBezTo": figure.Segments.Add(new BezierSegment(points[0], points[1], points[2], true)); break;
                    case "quadBezTo": figure.Segments.Add(new QuadraticBezierSegment(points[0], points[1], true)); break;
                    case "close": figure.IsClosed = true; break;
                    default: throw new InvalidOperationException("无法读取图形路径：" + command.Name.LocalName);
                }
            }
            foreach (var item in geometry.Figures)
            {
                if (item.Segments.Count == 0) continue;
                var last = item.Segments.Last(); Point end = last is LineSegment ? ((LineSegment)last).Point : last is BezierSegment ? ((BezierSegment)last).Point3 : ((QuadraticBezierSegment)last).Point2;
                if ((end - item.StartPoint).Length < .001) item.IsClosed = true;
            }
            return geometry;
        }
        private static XElement Pt(Point p) { return new XElement(A + "pt", new XAttribute("x", (long)Math.Round(p.X * 12700)), new XAttribute("y", (long)Math.Round(p.Y * 12700))); }
        private static XElement Write(PathGeometry geometry, double width, double height)
        {
            var path = new XElement(A + "path", new XAttribute("w", (long)Math.Round(width * 12700)), new XAttribute("h", (long)Math.Round(height * 12700)));
            foreach (var figure in geometry.Figures)
            {
                path.Add(new XElement(A + "moveTo", Pt(figure.StartPoint)));
                foreach (var segment in figure.Segments)
                {
                    var line = segment as LineSegment; var bezier = segment as BezierSegment; var polyLine = segment as PolyLineSegment; var polyBezier = segment as PolyBezierSegment; var quad = segment as QuadraticBezierSegment;
                    if (line != null) path.Add(new XElement(A + "lnTo", Pt(line.Point)));
                    else if (bezier != null) path.Add(new XElement(A + "cubicBezTo", Pt(bezier.Point1), Pt(bezier.Point2), Pt(bezier.Point3)));
                    else if (polyLine != null) foreach (var p in polyLine.Points) path.Add(new XElement(A + "lnTo", Pt(p)));
                    else if (polyBezier != null) for (int i = 0; i < polyBezier.Points.Count; i += 3) path.Add(new XElement(A + "cubicBezTo", Pt(polyBezier.Points[i]), Pt(polyBezier.Points[i + 1]), Pt(polyBezier.Points[i + 2])));
                    else if (quad != null) path.Add(new XElement(A + "quadBezTo", Pt(quad.Point1), Pt(quad.Point2)));
                    else throw new InvalidOperationException("无法写入图形曲线：" + segment.GetType().Name);
                }
                if (figure.IsClosed) path.Add(new XElement(A + "close"));
            }
            return path;
        }
    }
}
