using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace Sandun.PresentationBootstrap
{
    // Creates a real PowerPoint chart and fills its embedded Excel workbook.
    internal static class NativeChartInsertion
    {
        internal static readonly HashSet<string> NativeTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "bar", "line", "pie", "donut", "horizontal-bar", "stacked-bar" };

        internal static bool CanInsert(string chartData)
        {
            try { var slot = ReadSlot(chartData); return slot != null && NativeTypes.Contains(slot.Type) && slot.Rows.Count > 0; }
            catch { return false; }
        }

        internal static string Insert(string chartData, string targetJson)
        {
            var slot = ReadSlot(chartData);
            if (slot == null || !NativeTypes.Contains(slot.Type) || slot.Rows.Count == 0) throw new InvalidOperationException("当前图表类型暂不支持原生编辑，请使用 SVG 插入。");
            var target = new JavaScriptSerializer().Deserialize<SvgInsertion.Target>(targetJson);
            dynamic deck = null, slide = null;
            foreach (dynamic item in NativeTools.Items(NativeTools.App.Presentations)) if ((string)item.FullName == target.presentation) { deck = item; break; }
            if (deck == null) throw new InvalidOperationException("原演示文稿已关闭，请重试。");
            foreach (dynamic item in NativeTools.Items(deck.Slides)) if ((int)item.SlideID == target.slideId) { slide = item; break; }
            if (slide == null) throw new InvalidOperationException("原幻灯片已删除，请重试。");
            float w = deck.PageSetup.SlideWidth * .8f, h = deck.PageSetup.SlideHeight * .8f;
            dynamic shape = null;
            try {
                int type = TypeCode(slot.Type);
                shape = slide.Shapes.AddChart(type, (deck.PageSetup.SlideWidth - w) / 2, (deck.PageSetup.SlideHeight - h) / 2, w, h);
                dynamic chart = shape.Chart;
                chart.HasTitle = !string.IsNullOrWhiteSpace(slot.Title);
                if (chart.HasTitle) chart.ChartTitle.Text = slot.Title;
                chart.ChartData.Activate();
                dynamic book = chart.ChartData.Workbook;
                dynamic sheet = book.Worksheets[1];
                sheet.Cells.Clear();
                sheet.Cells[1, 1] = "分类";
                var groups = new List<string>(); foreach (var row in slot.Rows) if (!groups.Contains(row.Group)) groups.Add(row.Group);
                for (int i = 0; i < groups.Count; i++) sheet.Cells[1, i + 2] = groups[i];
                var labels = new List<string>(); foreach (var row in slot.Rows) if (!labels.Contains(row.Label)) labels.Add(row.Label);
                for (int r = 0; r < labels.Count; r++) {
                    sheet.Cells[r + 2, 1] = labels[r];
                    for (int c = 0; c < groups.Count; c++) { var row = slot.Rows.Find(x => x.Label == labels[r] && x.Group == groups[c]); sheet.Cells[r + 2, c + 2] = row == null ? 0 : row.Value; }
                }
                string lastCol = Column(groups.Count + 1), lastRow = (labels.Count + 1).ToString();
                chart.SetSourceData(sheet.Range["A1:" + lastCol + lastRow]);
                chart.HasLegend = groups.Count > 1;
                for (int c = 0; c < groups.Count; c++) {
                    var colored = slot.Rows.Find(x => x.Group == groups[c] && x.Color != 0);
                    if (colored == null) continue;
                    try { chart.SeriesCollection(c + 1).Format.Fill.ForeColor.RGB = colored.Color; } catch { }
                    try {
                        dynamic fill = chart.SeriesCollection(c + 1).Format.Fill;
                        fill.BackColor.RGB = Blend(colored.Color, 0.42);
                        fill.TwoColorGradient(1, 1);
                    } catch { }
                }
                if (slot.Rows.Count > 0 && groups.Count > 0) try {
                    dynamic first = chart.SeriesCollection(1).Format;
                    first.Line.ForeColor.RGB = slot.Rows[0].Color == 0 ? 0xD8E2F0 : slot.Rows[0].Color;
                    first.Line.Weight = 1.25f;
                } catch { }
                try { chart.Legend.Position = 2; } catch { }
                try { chart.ChartArea.Format.Line.Visible = 0; } catch { }
                try { chart.PlotArea.Format.Line.Visible = 0; } catch { }
                shape.Name = "SANDUN AI 原生图表";
                shape.Select();
                target.shapeId = shape.Id;
                return new JavaScriptSerializer().Serialize(target);
            } catch { if (shape != null) try { shape.Delete(); } catch { } throw; }
        }

        private sealed class Slot { internal string Type, Title; internal List<Row> Rows = new List<Row>(); }
        private sealed class Row { internal string Label, Group; internal double Value; internal int Color; }
        private static int Blend(int rgb, double amount) { int r = rgb & 255, g = (rgb >> 8) & 255, b = (rgb >> 16) & 255; r = (int)(r + (255 - r) * amount); g = (int)(g + (255 - g) * amount); b = (int)(b + (255 - b) * amount); return r | (g << 8) | (b << 16); }
        private static Slot ReadSlot(string json) {
            var root = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
            var raw = root != null && root.ContainsKey("chart_slots") ? ((object[])root["chart_slots"])[0] as Dictionary<string, object> : root;
            if (raw == null) return null; var slot = new Slot { Type = Convert.ToString(raw["chart_type"]), Title = raw.ContainsKey("title") ? Convert.ToString(raw["title"]) : "" };
            var rows = raw["data"] as object[]; if (rows == null) return slot;
            foreach (Dictionary<string, object> item in rows) { double value; if (!double.TryParse(Convert.ToString(item.ContainsKey("value") ? item["value"] : ""), out value)) continue; int color = 0; if (item.ContainsKey("color")) { var hex = Convert.ToString(item["color"]).TrimStart('#'); if (hex.Length == 6) int.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out color); } slot.Rows.Add(new Row { Label = Convert.ToString(item.ContainsKey("label") ? item["label"] : ""), Group = Convert.ToString(item.ContainsKey("group") ? item["group"] : "系列 1"), Value = value, Color = color }); }
            return slot;
        }
        private static int TypeCode(string type) { switch (type) { case "line": return 4; case "pie": return 5; case "donut": return 80; case "horizontal-bar": return 57; case "stacked-bar": return 52; default: return 51; } }
        private static string Column(int number) { string result = ""; while (number > 0) { number--; result = (char)('A' + number % 26) + result; number /= 26; } return result; }
    }
}
