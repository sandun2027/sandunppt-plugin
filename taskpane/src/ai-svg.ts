import { applyChartSlotsToSvg } from "./vendor/slide-chart-utils";
import { CHART_TYPE_VALUES, type SlideChartSlot } from "./vendor/slide-image-types";
import type { PluginAIResponse } from "./types";

// PowerPoint's SVG importer is much less tolerant than a browser when a chart
// shape is filled only through a gradient URL inside a nested SVG group.  In
// that case it keeps the text labels but silently drops the bars/lines/areas.
// Keep the GoPro renderer as the source of geometry, then provide a solid-color
// fallback for every gradient used by the generated chart.  The browser still
// sees the original gradient; Office can always paint the same blue series.
function addOfficePaintFallback(svg: string): string {
  const colors = new Map<string, string>();
  for (const match of svg.matchAll(/<linearGradient\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/linearGradient>/gi)) {
    const stop = match[2].match(/<stop\b[^>]*\bstop-color=["']([^"']+)["']/i);
    if (stop?.[1]) colors.set(match[1], stop[1]);
  }
  return svg.replace(/fill=["']url\(#([^\)]+)\)["']/gi, (_all, id: string) => {
    const fallback = colors.get(id) || "#165DFF";
    return `fill="url(#${id}) ${fallback}"`;
  });
}

export function generatedSvg(response: PluginAIResponse, kind: "chart" | "diagram"): string {
  if (!response.success) throw new Error(response.error || "生成未完成，请重试。");
  if (kind === "diagram") {
    if (!response.slot?.svg?.trim()) throw new Error("未返回可插入的图示。");
    return response.slot.svg;
  }
  let parsed: any;
  try { parsed = JSON.parse(response.chart_data || ""); }
  catch { throw new Error("图表数据格式不正确，请重新生成。"); }
  const raw = parsed?.chart_slots?.[0] || parsed;
  const requestedType = raw?.chart_type || response.chart_type;
  const chartType = requestedType === "kpi" ? "table" : requestedType;
  if (!(CHART_TYPE_VALUES as readonly string[]).includes(chartType) || !Array.isArray(raw?.data) || !raw.data.length)
    throw new Error("图表缺少类型或有效数据，请重新生成。");
  const data = raw.data.map((row: any) => {
    if (!row || typeof row !== "object") throw new Error("图表数据行不正确。");
    const value = Number(row.value ?? 0);
    const text = row.text ?? (!Number.isFinite(value) && chartType === "table" ? String(row.value) : undefined);
    if (!Number.isFinite(value) && !text) throw new Error("图表包含无效的数值。");
    return { ...row, label: String(row.label ?? row.from ?? ""), color: String(row.color || ""), value: Number.isFinite(value) ? value : 0, text };
  });
  const slot: SlideChartSlot = {
    ...raw,
    slot_id: "plugin-chart-1",
    chart_type: chartType,
    x: 0,
    y: 0,
    width: 960,
    height: 540,
    // Match the web GoPro chart theme: #165DFF is the single visual anchor,
    // with restrained neighboring blues for additional series.
    style: {
      ...(raw.style || {}),
      palette: ["#165DFF", "#4080FF", "#6AA1FF", "#94BFFF", "#BED7FF", "#0E42D2", "#3370FF", "#80B5FF"],
    },
    data,
  };
  const svg = applyChartSlotsToSvg('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><g data-chart-slot-id="plugin-chart-1"><rect width="960" height="540"/></g></svg>', { chart_slots: [slot] });
  if (!svg.includes('data-chart-rendered="1"')) throw new Error("当前数据不足以绘制此类图表，请补充数据后重试。");
  return addOfficePaintFallback(svg);
}
