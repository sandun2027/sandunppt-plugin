// SVG chart rendering and theme utilities for the PPT plugin.
// See README.md in this directory for data and rendering contracts.
import type { SlideChartTheme, SlideDesignData, SlideChartSlot } from './slide-image-types';

// ─── SVG 数学工具 ───

interface Point { x: number; y: number }

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): Point {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeSector(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

function ringSegment(cx: number, cy: number, outerR: number, innerR: number, startAngle: number, endAngle: number): string {
    const oStart = polarToCartesian(cx, cy, outerR, startAngle);
    const oEnd = polarToCartesian(cx, cy, outerR, endAngle);
    const iStart = polarToCartesian(cx, cy, innerR, startAngle);
    const iEnd = polarToCartesian(cx, cy, innerR, endAngle);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${oStart.x} ${oStart.y} A ${outerR} ${outerR} 0 ${large} 1 ${oEnd.x} ${oEnd.y} L ${iEnd.x} ${iEnd.y} A ${innerR} ${innerR} 0 ${large} 0 ${iStart.x} ${iStart.y} Z`;
}

/** 圆帽描边弧（gauge 进度弧用）：只描 stroke，不闭合 */
function arcStroke(cx: number, cy: number, r: number, a0: number, a1: number): string {
    const p0 = polarToCartesian(cx, cy, r, a0);
    const p1 = polarToCartesian(cx, cy, r, a1);
    const lg = a1 - a0 > 180 ? 1 : 0;
    return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${lg} 1 ${p1.x} ${p1.y}`;
}

/** Catmull-Rom 平滑曲线（折线/排名/河流图共用），替代折角 polyline */
function smoothPath(pts: Array<[number, number]>): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
    }
    return d;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const EPSILON = 0.0001;
const TRANSLATE_RE = /translate\(\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)(?:[\s,]+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?))?\s*\)/i;

function nearZero(v: number): boolean {
    return Math.abs(v) < EPSILON;
}

function parseFloatSafe(raw: string | null, fallback = 0): number {
    const num = Number(raw ?? "");
    return Number.isFinite(num) ? num : fallback;
}

function formatTransformNumber(v: number): string {
    const normalized = nearZero(v) ? 0 : v;
    return Number(normalized.toFixed(4)).toString();
}

function mergeTranslateTransform(existingTransform: string, offsetX: number, offsetY: number): string {
    const trimmed = (existingTransform || "").trim();
    if (nearZero(offsetX) && nearZero(offsetY)) {
        return trimmed;
    }

    const mergedTranslate = `translate(${formatTransformNumber(offsetX)} ${formatTransformNumber(offsetY)})`;
    if (!trimmed) {
        return mergedTranslate;
    }

    const match = trimmed.match(TRANSLATE_RE);
    if (!match) {
        return `${mergedTranslate} ${trimmed}`.trim();
    }

    const currentX = parseFloatSafe(match[1], 0);
    const currentY = parseFloatSafe(match[2], 0);
    const nextTranslate = `translate(${formatTransformNumber(currentX + offsetX)} ${formatTransformNumber(currentY + offsetY)})`;
    return trimmed.replace(TRANSLATE_RE, nextTranslate).trim();
}

// ─── 图表样式默认值 ───

interface ChartStyle {
    fontSize: number;
    xAxisFontSize: number;
    yAxisFontSize: number;
    xAxisFontColor: string;
    yAxisFontColor: string;
    fontColor: string;
    backgroundColor: string;
    showLegend: boolean;
    showValues: boolean;
    showGrid: boolean;
    showXAxis: boolean;
    showYAxis: boolean;
    frameColor: string;
    frameWidth: number;
    frameRadius: number;
    gridColor: string;
    gridDasharray: string;
    axisColor: string;
    axisWidth: number;
    valueColor: string;
    valueFontSize: number;
    legendTextColor: string;
    legendFontSize: number;
    palette: string[];
    lineWidth: number;
    areaOpacity: number;
    barRadius: number;
    /** bar 专用：相邻柱体间距（px），undefined=按分类自动均分（原行为） */
    barGap?: number;
    donutInnerRatio: number;
    unit: string;
    /** gauge 上限值（style.max），<=0 视为未设、renderer 回退 100 */
    max: number;
    /** quadrant 横轴语义标注（style.xAxisLabel），空则不画 */
    xAxisLabel: string;
    /** quadrant 纵轴语义标注（style.yAxisLabel），空则不画 */
    yAxisLabel: string;
    /** table 专用：编辑面板显式设置的表头字号/颜色（复用 xAxis* 通道），undefined=渲染器自适应字号/accent 默认色。
     *  只认 slot.style 的显式值，不吃 theme 轴字号——theme 值面向坐标轴图，混进来会顶掉表格的自适应放大 */
    tableHeadFontSize?: number;
    tableHeadFontColor?: string;
    /** table 专用：单元格与行名的字号/颜色（复用 yAxis* 通道），undefined=随行高自适应/默认 ink・mut 配色 */
    tableCellFontSize?: number;
    tableCellFontColor?: string;
    /** table 专用：行名列宽（占表格总宽百分比），>0 生效，缺省按内容自动收缩 */
    tableLabelWidth?: number;
    /** table 专用：各数据列宽（百分比，按列出现顺序），0/缺省=该列按内容自动分宽 */
    tableColWidths?: number[];
    /** table 专用：行名列对齐（left/center/right），空=自动（短序号居中、长文本左对齐） */
    tableLabelAlign?: string;
    /** table 专用：各数据列对齐（按列出现顺序），空=默认居中；表头随列对齐 */
    tableColAligns?: string[];
    /** table 专用：各行对齐（按行出现顺序），优先级高于列对齐，空=跟随列 */
    tableRowAligns?: string[];
    /** horizontal-bar 专用：行间距（px，行内容底到下一行顶的呼吸空间），undefined=行高平分槽高（原行为）；
     *  设置后行高收敛为「内容高+间距」并整块垂直居中，行少的高槽不再被撑得过于松散 */
    barRowGap?: number;
}

interface DataItem {
    label: string;
    value: number;
    color: string;
    group?: string;
    /** 行级单位（kpi 图多指标量纲不同时使用，如 "%"、"s"），缺省回退 style.unit */
    unit?: string;
    /** kpi 行的语义角色（行序无关）：baseline=基准值（底部小字）、current=当前值（大数字） */
    role?: 'baseline' | 'current';
    /** table 纯文字单元格内容：有值时优先显示文字而非 value */
    text?: string;
    /** quadrant：横轴坐标（0~100 归一） */
    x?: number;
    /** quadrant：纵轴坐标（0~100 归一） */
    y?: number;
    /** quadrant：气泡权重 */
    r?: number;
    /** sankey：流量来源节点名 */
    from?: string;
    /** sankey：流量去向节点名 */
    to?: string;
}

function toNumber(v: unknown, fallback: number): number {
    const num = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(num) ? num : fallback;
}

function toOptNumber(v: unknown): number | undefined {
    if (v == null) return undefined;
    const num = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(num) ? num : undefined;
}

function toBool(v: unknown, fallback: boolean): boolean {
    return typeof v === 'boolean' ? v : fallback;
}

function toString(v: unknown): string {
    if (v == null) return '';
    return String(v).trim();
}

function toColorArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v
        .map((item) => toString(item))
        .filter((item) => item !== '');
}

/** V2 默认调色板（Apple 深色系统色，蓝系起步邻近色渐进），palette[0] 恒为 accent 语义位 */
const DEFAULT_PALETTE = ['#2997FF', '#64D2FF', '#5E5CE6', '#66D4CF', '#BF5AF2', '#FF9F0A', '#30D158', '#FF375F'];

/** 这些类型默认不画 Y 轴刻度（V2 约定：数值由数据标签承载，编辑面板可重新打开） */
const NO_Y_AXIS_DEFAULT = new Set(['bar', 'line', 'histogram', 'stacked-bar', 'horizontal-bar']);

function resolveStyle(slot: SlideChartSlot, theme?: SlideChartTheme | null): ChartStyle {
    const palette = toColorArray(slot.style?.palette).length > 0
        ? toColorArray(slot.style?.palette)
        : (theme?.palette && theme.palette.length > 0 ? theme.palette : DEFAULT_PALETTE);
    const yAxisDefault = !NO_Y_AXIS_DEFAULT.has(slot.chart_type);
    const style: ChartStyle = {
        fontSize: toNumber(slot.style?.fontSize ?? theme?.labelFontSize, 13),
        xAxisFontSize: toNumber(slot.style?.xAxisFontSize ?? theme?.xAxisFontSize ?? slot.style?.fontSize ?? theme?.labelFontSize, 13),
        yAxisFontSize: toNumber(slot.style?.yAxisFontSize ?? theme?.yAxisFontSize ?? Math.max(9, (slot.style?.fontSize ?? theme?.labelFontSize ?? 13) - 2), 11),
        xAxisFontColor: toString(slot.style?.xAxisFontColor ?? theme?.xAxisFontColor ?? slot.style?.fontColor ?? theme?.labelColor) || '#3A4453',
        yAxisFontColor: toString(slot.style?.yAxisFontColor ?? theme?.yAxisFontColor ?? slot.style?.fontColor ?? theme?.labelColor) || '#3A4453',
        fontColor: toString(slot.style?.fontColor ?? theme?.labelColor) || '#3A4453',
        backgroundColor: toString(slot.style?.backgroundColor ?? theme?.backgroundColor) || '#FFFFFF',
        showLegend: toBool(slot.style?.showLegend, true),
        showValues: toBool(slot.style?.showValues, true),
        showGrid: toBool(slot.style?.showGrid, true),
        showXAxis: toBool(slot.style?.showXAxis, true),
        showYAxis: toBool(slot.style?.showYAxis, yAxisDefault),
        frameColor: toString(slot.style?.frameColor ?? theme?.frameColor) || '#D9E2F2',
        frameWidth: Math.max(0, toNumber(slot.style?.frameWidth ?? theme?.frameWidth, 1)),
        frameRadius: Math.max(0, toNumber(slot.style?.frameRadius ?? theme?.frameRadius, 12)),
        gridColor: toString(slot.style?.gridColor ?? theme?.gridColor) || '#E9EEF7',
        gridDasharray: toString(slot.style?.gridDasharray ?? theme?.gridDasharray) || '4 4',
        axisColor: toString(slot.style?.axisColor ?? theme?.axisColor) || '#9AA4B2',
        axisWidth: Math.max(0.5, toNumber(slot.style?.axisWidth ?? theme?.axisWidth, 1.2)),
        valueColor: toString(slot.style?.valueColor ?? theme?.valueColor) || '#1F2D3D',
        valueFontSize: Math.max(9, toNumber(slot.style?.valueFontSize ?? theme?.valueFontSize, 12)),
        legendTextColor: toString(slot.style?.legendTextColor ?? theme?.legendTextColor) || '#3A4453',
        legendFontSize: Math.max(9, toNumber(slot.style?.legendFontSize ?? theme?.legendFontSize, 12)),
        palette,
        lineWidth: Math.max(1, toNumber(slot.style?.lineWidth ?? theme?.lineWidth, 3)),
        areaOpacity: Math.min(0.6, Math.max(0, toNumber(slot.style?.areaOpacity ?? theme?.areaOpacity, 0.2))),
        barRadius: Math.max(0, toNumber(slot.style?.barRadius ?? theme?.barRadius, 8)),
        barGap: toOptNumber(slot.style?.barGap),
        donutInnerRatio: Math.min(0.85, Math.max(0.35, toNumber(slot.style?.donutInnerRatio ?? theme?.donutInnerRatio, 0.62))),
        unit: toString(slot.style?.unit) || '',
        max: toNumber(slot.style?.max, 0),
        xAxisLabel: toString(slot.style?.xAxisLabel) || '',
        yAxisLabel: toString(slot.style?.yAxisLabel) || '',
        tableHeadFontSize: toOptNumber(slot.style?.xAxisFontSize),
        tableHeadFontColor: toString(slot.style?.xAxisFontColor) || undefined,
        tableCellFontSize: toOptNumber(slot.style?.yAxisFontSize),
        tableCellFontColor: toString(slot.style?.yAxisFontColor) || undefined,
        tableLabelWidth: toOptNumber(slot.style?.tableLabelWidth),
        tableColWidths: Array.isArray(slot.style?.tableColWidths) ? slot.style.tableColWidths.map((n) => toNumber(n, 0)) : undefined,
        tableLabelAlign: toString(slot.style?.tableLabelAlign) || undefined,
        tableColAligns: Array.isArray(slot.style?.tableColAligns) ? slot.style.tableColAligns.map((v) => toString(v)) : undefined,
        tableRowAligns: Array.isArray(slot.style?.tableRowAligns) ? slot.style.tableRowAligns.map((v) => toString(v)) : undefined,
        barRowGap: toOptNumber(slot.style?.barRowGap),
    };
    return normalizeTextColorsForContext(style, theme);
}

function colorLuminance(c: string): number | null {
    const rgb = parseColorToRgb(c);
    if (!rgb) return null;
    return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

/** 明暗语境判定（文字色护栏 + skipBg 共用）。
 *  绝不能优先信 slot.style.backgroundColor：初稿浅色模式常把 #FFFFFF 烤进槽位，正式设计换深色
 *  风格后若仍信白底会误判成浅色语境 → 铺一层白底 + 深字，正好和用户要的「深底白字」反着干。
 *  权威度：
 *  1. chart_theme 的 ink（valueColor/labelColor）——正式设计从 design_tokens 派生，深色风格是亮字，
 *     不被烤死的 slot.style 污染，是「这页是不是深色」最稳的信号；
 *  2. chart_theme.backgroundColor——仅当不透明且非默认白时采信；
 *  3. 槽位自身底色——同样跳过默认白 / 透明，只在真正画了深色/有色底时采信；
 *  4. 退回 isDarkChartContext 启发式。 */
function resolveDarkContext(s: ChartStyle, theme?: SlideChartTheme | null): boolean {
    const isDefaultLightBg = (c: string): boolean => {
        const t = c.trim().toLowerCase();
        return !t || t === 'transparent' || t === '#ffffff' || t === '#fff' || t === 'white';
    };
    if (theme) {
        const inkLum = colorLuminance(toString(theme.valueColor));
        if (inkLum != null) return inkLum > 0.6;
        const labelLum = colorLuminance(toString(theme.labelColor));
        if (labelLum != null) return labelLum > 0.6;
        const themeBg = toString(theme.backgroundColor);
        if (!isDefaultLightBg(themeBg) && parseColorAlpha(themeBg) >= 0.6) {
            const lum = colorLuminance(themeBg);
            if (lum != null) return lum < 0.45;
        }
    }
    const ownBg = s.backgroundColor.toLowerCase() === 'transparent' ? '' : s.backgroundColor;
    if (ownBg && !isDefaultLightBg(ownBg) && parseColorAlpha(ownBg) >= 0.6) {
        const lum = colorLuminance(ownBg);
        if (lum != null) return lum < 0.45;
    }
    return isDarkChartContext(s);
}

/** 文字色可读性护栏：slot.style 里烤死的文字色（初稿浅色模式写入的深字，如 fontColor:#0F172A）
 *  在正式设计换深色风格后不会被 theme 的亮色顶掉（前端合并优先级 slot.style > theme），文字直接
 *  消失在深色卡片上——表格非首行、轴刻度、图例等辅助文字均受害；反向（浅底配近白字）同理。
 *  按 resolveDarkContext 的明暗判定逐个检查文字色通道：深色语境亮度 <0.4 的深字、浅色语境亮度
 *  >0.82 的浅字替换为语境安全色；可正常辨认的颜色（accent 派生色、中灰等）原样保留。
 *  table 专用通道（tableHead/tableCell）同样过护栏——它们与通用通道一样可能被 AI 烤入错误明暗。 */
function normalizeTextColorsForContext(s: ChartStyle, theme?: SlideChartTheme | null): ChartStyle {
    const dark = resolveDarkContext(s, theme);
    const fix = (c: string, fallback: string): string => {
        const rgb = parseColorToRgb(c);
        if (!rgb) return c;
        const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
        return (dark ? lum < 0.4 : lum > 0.82) ? fallback : c;
    };
    const ink = dark ? '#F2F5F9' : '#1F2D3D';
    const mut = dark ? 'rgba(255,255,255,0.68)' : '#3A4453';
    s.valueColor = fix(s.valueColor, ink);
    s.fontColor = fix(s.fontColor, mut);
    s.xAxisFontColor = fix(s.xAxisFontColor, mut);
    s.yAxisFontColor = fix(s.yAxisFontColor, mut);
    s.legendTextColor = fix(s.legendTextColor, mut);
    if (s.tableHeadFontColor) s.tableHeadFontColor = fix(s.tableHeadFontColor, mut);
    if (s.tableCellFontColor) s.tableCellFontColor = fix(s.tableCellFontColor, ink);
    return s;
}

function isValidColor(c: string): boolean {
    if (!c) return false;
    // Accept hex colors and common CSS color names, reject url() gradients
    if (c.startsWith('#')) return true;
    if (c.startsWith('rgb')) return true;
    if (c.startsWith('hsl')) return true;
    if (/^[a-zA-Z]+$/.test(c) && !c.startsWith('url')) return true;
    return false;
}

/** 解析 hex (#rgb/#rrggbb) 或 rgb()/rgba() 为 [r,g,b]，无法解析返回 null */
function parseColorToRgb(c: string): [number, number, number] | null {
    if (!c) return null;
    const str = c.trim();
    if (str.startsWith('#')) {
        let hex = str.slice(1);
        if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
        if (hex.length !== 6) return null;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if ([r, g, b].some((n) => Number.isNaN(n))) return null;
        return [r, g, b];
    }
    const m = str.match(/rgba?\(([^)]+)\)/i);
    if (m) {
        const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
        if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
            return [parts[0], parts[1], parts[2]];
        }
    }
    return null;
}

/** 依据底色相对亮度选取可读文字色（深底用白、浅底用深），用于环带内置标签 */
function readableTextColor(bg: string, darkText = '#1C2D27', lightText = '#FFFFFF'): string {
    const rgb = parseColorToRgb(bg);
    if (!rgb) return lightText;
    const [r, g, b] = rgb;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? darkText : lightText;
}

/** 把 base 颜色向 target 混合 ratio（0~1），返回 #RRGGBB；任一解析失败原样返回 base */
function mixColor(base: string, target: string, ratio: number): string {
    const a = parseColorToRgb(base);
    const b = parseColorToRgb(target);
    if (!a || !b) return base;
    const r = Math.min(1, Math.max(0, ratio));
    const mix = (x: number, y: number) => Math.round(x + (y - x) * r);
    return `#${[mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
}

/** 颜色转 rgba() 字符串（透明度 a），解析失败原样返回 */
function rgbaStr(c: string, a: number): string {
    const p = parseColorToRgb(c);
    return p ? `rgba(${p[0]},${p[1]},${p[2]},${a})` : c;
}

/** 色相旋转：把颜色在 HSL 空间转 deg 度（双色相渐变的核心构件），解析失败原样返回 */
function shiftHue(c: string, deg: number): string {
    const rgb = parseColorToRgb(c);
    if (!rgb) return c;
    const [r, g, b] = rgb.map((n) => n / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    let hDeg = 0;
    let sat = 0;
    if (d !== 0) {
        sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) hDeg = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (mx === g) hDeg = ((b - r) / d + 2) * 60;
        else hDeg = ((r - g) / d + 4) * 60;
    }
    let hh = (hDeg + deg) % 360;
    if (hh < 0) hh += 360;
    const c2 = (1 - Math.abs(2 * l - 1)) * sat;
    const x2 = c2 * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = l - c2 / 2;
    let rr = 0;
    let gg = 0;
    let bb = 0;
    if (hh < 60) { rr = c2; gg = x2; } else if (hh < 120) { rr = x2; gg = c2; }
    else if (hh < 180) { gg = c2; bb = x2; } else if (hh < 240) { gg = x2; bb = c2; }
    else if (hh < 300) { rr = x2; bb = c2; } else { rr = c2; bb = x2; }
    return `#${[rr + m, gg + m, bb + m]
        .map((n) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`;
}

/** 解析颜色的透明度：rgba()/hsla() 第 4 个分量，其余格式视为不透明（1） */
function parseColorAlpha(c: string): number {
    const m = c.trim().match(/rgba?\(([^)]+)\)/i);
    if (!m) return 1;
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
    if (parts.length >= 4 && Number.isFinite(parts[3])) {
        return Math.min(1, Math.max(0, parts[3]));
    }
    return 1;
}

/**
 * 判断图表所处的风格明暗：底色足够不透明（≥0.6）时看底色亮度；
 * 底色透明或半透明（深色玻璃风常用 rgba(255,255,255,0.05)——RGB 是白、视觉是暗底，
 * 不能只看 RGB）时退而看数值文字色（深色风格派生的 valueColor 是亮色）。
 * 用于 KPI 大数字的渐变走向与是否附加微光，以及 V2 图表的焦点发光/中性色方向。
 */
function isDarkChartContext(s: ChartStyle): boolean {
    const bg = s.backgroundColor.toLowerCase() === 'transparent' ? '' : s.backgroundColor;
    const bgRgb = parseColorToRgb(bg);
    if (bgRgb && parseColorAlpha(bg) >= 0.6) {
        return (0.299 * bgRgb[0] + 0.587 * bgRgb[1] + 0.114 * bgRgb[2]) / 255 < 0.45;
    }
    const inkRgb = parseColorToRgb(s.valueColor);
    if (inkRgb) {
        return (0.299 * inkRgb[0] + 0.587 * inkRgb[1] + 0.114 * inkRgb[2]) / 255 > 0.6;
    }
    return false;
}

const SERIES_COLOR_CHART_TYPES = new Set(['bar', 'horizontal-bar', 'line', 'kpi', 'stacked-bar', 'radar', 'stream', 'bump']);

/** 单色 accent 图表：所有图形元素统一走 palette[0]，面板只暴露「主色」一个颜色单元 */
const ACCENT_ONLY_CHART_TYPES = new Set(['histogram', 'heatmap', 'gauge', 'rose', 'treemap', 'dumbbell', 'table']);

function shouldUseSeriesColor(slot: SlideChartSlot): boolean {
    if (!SERIES_COLOR_CHART_TYPES.has(slot.chart_type)) return false;
    return slot.data.some((item) => toString(item.group) !== '');
}

function resolveData(slot: SlideChartSlot, style: ChartStyle, theme?: SlideChartTheme | null): DataItem[] {
    // 当风格主题或槽位显式指定了调色板时，优先使用调色板颜色（覆盖数据项自身的颜色）
    // 否则保留数据项颜色（AI 初稿生成的配色）
    const hasExplicitPalette =
        (toColorArray(slot.style?.palette).length > 0) ||
        (theme?.palette != null && theme.palette.length > 0);
    const useSeriesColor = shouldUseSeriesColor(slot);
    const seriesColorMap = new Map<string, string>();

    if (useSeriesColor) {
        for (const row of slot.data) {
            const groupName = toString(row.group) || toString(row.label);
            if (!groupName || seriesColorMap.has(groupName)) continue;

            const itemColor = isValidColor(row.color) ? row.color : '';
            const paletteColor = style.palette[seriesColorMap.size % style.palette.length];
            const fallback = paletteColor || '#2997FF';
            const color = hasExplicitPalette
                ? (paletteColor || itemColor || fallback)
                : (itemColor || paletteColor || fallback);
            seriesColorMap.set(groupName, color);
        }
    }

    return slot.data.map((d, idx) => {
        const paletteColor = style.palette[idx % style.palette.length];
        const itemColor = isValidColor(d.color) ? d.color : '';
        const fallback = paletteColor || '#2997FF';
        const seriesColor = useSeriesColor
            ? seriesColorMap.get(toString(d.group) || toString(d.label))
            : '';
        const color = seriesColor || (hasExplicitPalette
            ? (paletteColor || itemColor || fallback)
            : (itemColor || fallback));
        // 表格纯文字单元格：字符串 value 挪到 text（value 归 0），渲染时优先显示文字
        let text = toString(d.text) || undefined;
        let value = typeof d.value === 'number' ? d.value : Number(d.value);
        if (!Number.isFinite(value)) {
            if (!text) text = toString(d.value) || undefined;
            value = 0;
        }
        return {
            // Labels are category keys for stacked charts. Normalize whitespace so
            // rows such as "2023" and " 2023 " are rendered in one stack.
            label: toString(d.label),
            value,
            color,
            group: toString(d.group) || undefined,
            unit: toString(d.unit) || undefined,
            role: d.role === 'baseline' || d.role === 'current' ? d.role : undefined,
            text,
            x: toOptNumber(d.x),
            y: toOptNumber(d.y),
            r: toOptNumber(d.r),
            from: toString(d.from) || undefined,
            to: toString(d.to) || undefined,
        };
    });
}

// ─── 图表可编辑颜色单元（供 ChartPropertiesPanel 配色 UI 使用） ───

export interface ChartColorUnit {
    /** 系列名（分组柱形/折线/条形）或数据项标签（饼/环/未分组） */
    label: string;
    /** 当前实际渲染色（与 resolveData 完全一致） */
    color: string;
}

/**
 * 返回图表当前可编辑的颜色单元列表：分组系列图表按系列（首次出现顺序）、
 * 单色 accent 图表只有「主色」（palette[0]）、sunburst 按父级、sankey 按左侧来源节点、
 * 其余按数据项顺序。顺序与渲染器实际取色序号一一对应，因此面板把修改后的颜色数组
 * 整体写回 slot.style.palette（槽位调色板优先级最高）即可精确控制每个单元的颜色。
 */
export function getChartColorUnits(slot: SlideChartSlot, theme?: SlideChartTheme | null): ChartColorUnit[] {
    const style = resolveStyle(slot, theme);
    const items = resolveData(slot, style, theme);
    // kpi 的大数字/徽标统一走调色板首色（renderKpiChart 内不再按系列取色），
    // 面板只暴露这一个真实生效的颜色单元，避免编辑第二系列色却看不到变化。
    if (slot.chart_type === 'kpi') {
        const numColor = isValidColor(style.palette[0]) ? style.palette[0] : '#2997FF';
        return [{ label: '大数字', color: numColor }];
    }
    if (ACCENT_ONLY_CHART_TYPES.has(slot.chart_type)) {
        const accent = isValidColor(style.palette[0]) ? style.palette[0] : '#2997FF';
        return [{ label: '主色', color: accent }];
    }
    if (slot.chart_type === 'sunburst') {
        const parents: string[] = [];
        for (const item of items) {
            const p = toString(item.group);
            if (p && !parents.includes(p)) parents.push(p);
        }
        return parents.map((p, i) => ({ label: p, color: style.palette[i % style.palette.length] }));
    }
    if (slot.chart_type === 'sankey') {
        const lefts: string[] = [];
        for (const item of items) {
            const f = toString(item.from);
            if (f && !lefts.includes(f)) lefts.push(f);
        }
        return lefts.map((n, i) => ({ label: n, color: style.palette[i % style.palette.length] }));
    }
    if (slot.chart_type === 'quadrant') {
        return items.map((item, i) => ({ label: item.label, color: style.palette[i % style.palette.length] }));
    }
    if (shouldUseSeriesColor(slot)) {
        const out: ChartColorUnit[] = [];
        const seen = new Set<string>();
        for (const item of items) {
            const key = toString(item.group) || toString(item.label);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push({ label: key, color: item.color });
        }
        return out;
    }
    return items.map((item) => ({ label: item.label, color: item.color }));
}

// ─── 通用格式化 ───

function formatValue(value: number, unit: string): string {
    // Summing decimal rows can expose binary floating-point tails (e.g.
    // 78.66999999999999). Keep useful precision while presenting a clean value.
    const clean = Number.isFinite(value) ? Number(value.toPrecision(15)) : value;
    return unit ? `${clean}${unit}` : `${clean}`;
}

/** 计算"友好"刻度步长，使 Y 轴上限紧贴数据范围而非远超数据 */
function niceTickStep(maxVal: number, ticks: number): number {
    if (maxVal <= 0) return 1;
    const rawStep = maxVal / ticks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    let niceNorm: number;
    if (normalized <= 1) niceNorm = 1;
    else if (normalized <= 2) niceNorm = 2;
    else if (normalized <= 5) niceNorm = 5;
    else niceNorm = 10;
    return niceNorm * magnitude;
}

/** 格式化刻度标签，避免浮点精度尾巴 */
function formatTickLabel(val: number): string {
    if (Number.isInteger(val)) return String(val);
    // 使用 toPrecision 清理浮点精度问题 (如 0.30000000000000004)
    const s = val.toPrecision(10);
    return String(parseFloat(s));
}

/** 估算文本宽度：CJK / 全角字符按 ~1em，其余按 ~0.55em（避免中文标签宽度被严重低估导致居中偏移/拥挤） */
function approxTextWidth(text: string, fontSize: number): number {
    let w = 0;
    for (const ch of text) {
        const wide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]/.test(ch);
        w += wide ? fontSize : fontSize * 0.55;
    }
    return w;
}

/** 将文本按可用宽度截断，超出部分以省略号替代（CJK 感知，复用 approxTextWidth）。maxWidth<=0 时返回空串。 */
function truncateToWidth(text: string, fontSize: number, maxWidth: number): string {
    if (maxWidth <= 0) return '';
    if (approxTextWidth(text, fontSize) <= maxWidth) return text;
    const ellipsis = '…';
    const ellipsisW = approxTextWidth(ellipsis, fontSize);
    let acc = '';
    let w = 0;
    for (const ch of text) {
        const cw = approxTextWidth(ch, fontSize);
        if (w + cw + ellipsisW > maxWidth) break;
        acc += ch;
        w += cw;
    }
    return acc.length > 0 ? acc + ellipsis : ellipsis;
}

/** 软换行断点：优先在这些标点/空格后断行（分隔符保留在行尾，符合中文行尾标点习惯） */
const WRAP_BREAK_RE = /[，,、；;：:。\/·｜|\s]/;

/** 将文本按可用宽度折成多行：优先在标点/空格后断行，单段仍超宽时按字符硬切（CJK 感知，复用 approxTextWidth）。
 *  返回至少一行；放得下或 maxWidth<=0 时原样单行返回。 */
function wrapTextToWidth(text: string, fontSize: number, maxWidth: number): string[] {
    if (maxWidth <= 0 || approxTextWidth(text, fontSize) <= maxWidth) return [text];
    // 先按断点切段（分隔符归属前段），再贪心拼行
    const segs: string[] = [];
    let seg = '';
    for (const ch of text) {
        seg += ch;
        if (WRAP_BREAK_RE.test(ch)) { segs.push(seg); seg = ''; }
    }
    if (seg) segs.push(seg);
    const lines: string[] = [];
    let line = '';
    let lineW = 0;
    // 行尾空格保留在行内（SVG 渲染时自动折叠、不影响对齐），使多行 join 回原文时不丢字符；纯空格行丢弃
    const flush = () => {
        if (line.replace(/\s+$/, '')) lines.push(line);
        line = '';
        lineW = 0;
    };
    for (const sg of segs) {
        const w = approxTextWidth(sg, fontSize);
        // 行首禁则：段以标点开头（连续分隔符场景）时不换行，让标点悬挂在上一行行尾
        if (lineW > 0 && lineW + w > maxWidth && !WRAP_BREAK_RE.test(sg.charAt(0))) flush();
        if (w <= maxWidth) { line += sg; lineW += w; continue; }
        // 单段（无断点的长词/长串）超过整行宽：按字符硬切（标点不落行首，悬挂在超宽行尾）
        for (const ch of sg) {
            const cw = approxTextWidth(ch, fontSize);
            if (lineW > 0 && lineW + cw > maxWidth && !WRAP_BREAK_RE.test(ch)) flush();
            line += ch;
            lineW += cw;
        }
    }
    flush();
    return lines.length > 0 ? lines : [text];
}

// ─── 视觉构件（渐变 / 发光 / 网格 / 图例） ───

/** 渐变/滤镜 defs 的全局自增序号：每次注入整组重建，单调递增即可防同屏 id 冲突 */
let chartUidSeq = 0;
function uid(prefix: string): string {
    return `${prefix}-${++chartUidSeq}`;
}

interface V2Ctx {
    /** 深色语境（决定发光开关与中性色方向） */
    dark: boolean;
    /** accent = palette[0] */
    acc: string;
    /** 不透明的图表底色（扇缝描边/空心点填充用），底色半透明时按明暗回退 */
    canvas: string;
    /** 数值文字色 */
    ink: string;
    /** 辅助文字色 */
    mut: string;
    /** 点状网格线色 */
    grid: string;
    /** 发丝基线色 */
    base: string;
    /** 中性叠加色（轨道/中性块）：深色语境白系、浅色语境墨系 */
    neutral: (alpha: number) => string;
}

function v2ctx(s: ChartStyle): V2Ctx {
    const dark = isDarkChartContext(s);
    const acc = isValidColor(s.palette[0]) ? s.palette[0] : '#2997FF';
    const bg = s.backgroundColor.toLowerCase() === 'transparent' ? '' : s.backgroundColor;
    const bgRgb = parseColorToRgb(bg);
    const canvas = bgRgb && parseColorAlpha(bg) >= 0.6
        ? mixColor(bg, bg, 0)
        : (dark ? '#0E1013' : '#FFFFFF');
    return {
        dark,
        acc,
        canvas,
        ink: s.valueColor,
        mut: s.fontColor,
        grid: s.gridColor,
        base: s.axisColor,
        neutral: (alpha: number) => (dark ? `rgba(255,255,255,${alpha})` : `rgba(20,30,45,${alpha})`),
    };
}

/** 柱体纵向渐变（双色相设计）：亮端=系列色向冷邻色微转+轻微提亮，暗端=向暖邻色转 22° 再沉入底色。
 *  色相在渐变里流动（蓝→靛、绿→青），替代「同一主色变深」的呆板渐变。 */
function vGrad(id: string, c: string, ctx: V2Ctx): string {
    const top = mixColor(shiftHue(c, -12), '#FFFFFF', 0.10);
    const bot = ctx.dark ? mixColor(shiftHue(c, 22), ctx.canvas, 0.22) : mixColor(shiftHue(c, 18), '#FFFFFF', 0.28);
    return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bot}" stop-opacity="0.92"/></linearGradient>`;
}

/** 条带横向渐变（排行榜数据条用）：数值端（右）亮、起点端（左）向暖邻色沉入 */
function hGrad(id: string, c: string, ctx: V2Ctx): string {
    const head = mixColor(shiftHue(c, -12), '#FFFFFF', 0.10);
    const tail = ctx.dark ? mixColor(shiftHue(c, 22), ctx.canvas, 0.22) : mixColor(shiftHue(c, 18), '#FFFFFF', 0.28);
    return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${tail}" stop-opacity="0.92"/><stop offset="1" stop-color="${head}"/></linearGradient>`;
}

/** 大数字同色系渐变（donut/gauge/sunburst 中心数字）：向冷邻色转 18° 后深色提亮、浅色加深（与 kpi 同一套语言） */
function numGrad(id: string, c: string, dark: boolean): string {
    const end = dark ? mixColor(shiftHue(c, -18), '#FFFFFF', 0.38) : mixColor(shiftHue(c, -14), '#10131A', 0.24);
    return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0.25"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${end}"/></linearGradient>`;
}

/** 发光滤镜：只在元素背后铺柔和同色光晕，不加亮或加粗本体。 */
function glowF(id: string, c: string): string {
    return `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="${c}" flood-opacity="0.45"/></filter>`;
}

/** 单条点状网格线（横向），网格与基线共用同一款式 */
function gridLine(x0: number, x1: number, y: number, ctx: V2Ctx): string {
    return `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${ctx.grid}" stroke-width="1" stroke-dasharray="1 7" stroke-linecap="round"/>`;
}

/** 点状横向网格（showGrid 控制）+ 基线。基线与网格完全同款（点状虚线同色），不再用实线抢视觉 */
function softGrid(x0: number, y0: number, w: number, h: number, n: number, ctx: V2Ctx, showGrid: boolean): string {
    let s = '';
    if (showGrid) {
        for (let i = 1; i <= n; i++) {
            const y = y0 + h - (h * i) / n;
            s += gridLine(x0, x0 + w, y, ctx);
        }
    }
    s += gridLine(x0, x0 + w, y0 + h, ctx);
    return s;
}

/** 焦点数值角标（rose 峰值用）：胶囊底 + 同色文字 */
function valueChip(x: number, y: number, text: string, c: string): string {
    const fs = 11.5;
    const pw = approxTextWidth(text, fs) + 16;
    const ph = 20;
    const bx = x - pw / 2;
    const by = y - ph - 10;
    return `<rect x="${bx}" y="${by}" width="${pw}" height="${ph}" rx="10" fill="${rgbaStr(c, 0.14)}" stroke="${rgbaStr(c, 0.5)}" stroke-width="1"/>`
        + `<text x="${x}" y="${by + ph / 2 + 3.8}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${c}">${esc(text)}</text>`;
}

interface LegendItem { label: string; color: string }

/** 提取去重后的图例项（按 group 优先、回退 label），颜色取该系列首次出现的颜色 */
function extractLegendItems(data: DataItem[]): LegendItem[] {
    const items: LegendItem[] = [];
    const seen = new Set<string>();
    for (const item of data) {
        const name = item.group || item.label;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        items.push({ label: name, color: item.color });
    }
    return items;
}

/** 顶部横排图例：圆角方点 + 名称，不带数值、无发光，整行居中。 */
function legendRowV2(items: LegendItem[], x0: number, availW: number, y: number, fs: number, textColor: string): string {
    const sw = 11;
    const gap = 22;
    const iw = (it: LegendItem) => sw + 8 + approxTextWidth(it.label, fs);
    const total = items.reduce((t, i) => t + iw(i), 0) + (items.length - 1) * gap;
    let cx = x0 + Math.max(0, (availW - total) / 2);
    let s = '';
    for (const it of items) {
        s += `<rect x="${cx}" y="${y - sw / 2}" width="${sw}" height="${sw}" rx="3.5" fill="${it.color}"/>`;
        s += `<text x="${cx + sw + 8}" y="${y + 4}" font-size="${fs}" fill="${textColor}">${esc(it.label)}</text>`;
        cx += iw(it) + gap;
    }
    return s;
}

/** 右侧竖排图例（饼/环/旭日），垂直居中 */
function legendColV2(items: LegendItem[], x: number, totalH: number, fs: number, textColor: string): string {
    const sw = 12;
    const lineH = Math.max(24, fs + 14);
    const y0 = (totalH - items.length * lineH) / 2 + lineH / 2;
    let s = '';
    items.forEach((it, i) => {
        const y = y0 + i * lineH;
        s += `<rect x="${x}" y="${y - sw / 2}" width="${sw}" height="${sw}" rx="4" fill="${it.color}"/>`;
        s += `<text x="${x + sw + 10}" y="${y + 4}" font-size="${fs}" fill="${textColor}" font-weight="500">${esc(it.label)}</text>`;
    });
    return s;
}

/** 按 label 分组（保持出现顺序） */
function groupByLabel(data: DataItem[]): { labels: string[]; groups: Record<string, DataItem[]> } {
    const labels: string[] = [];
    const groups: Record<string, DataItem[]> = {};
    for (const item of data) {
        if (!groups[item.label]) {
            labels.push(item.label);
            groups[item.label] = [];
        }
        groups[item.label].push(item);
    }
    return { labels, groups };
}

/** 按 group 分组（保持出现顺序，空 group 归入 'default'） */
function groupBySeries(data: DataItem[]): { names: string[]; series: Record<string, DataItem[]> } {
    const names: string[] = [];
    const series: Record<string, DataItem[]> = {};
    for (const item of data) {
        const name = item.group || 'default';
        if (!series[name]) {
            names.push(name);
            series[name] = [];
        }
        series[name].push(item);
    }
    return { names, series };
}

// ─── 20 种图表 SVG 生成器 ───

function renderBarChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    const ctx = v2ctx(s);
    const { labels, groups } = groupByLabel(data);
    // 量纲/量级兜底：前后对比形态（1~3 个类目、每类目恰好 2 行）下行级单位不一致（如 "行" vs "天"），
    // 或类目间峰值差超 20 倍（如 500行 vs 14天）时，共享线性 Y 轴必然画出「一根顶天 + 几根趴地 3px」的畸形柱组。
    // 插件以普通数据表保留跨量纲数据，不使用大字报。
    if (labels.length >= 1 && labels.length <= 3 && labels.every((l) => groups[l].length === 2)) {
        const units = new Set(data.map((d) => (d.unit || s.unit || '').trim()));
        const peaks = labels.map((l) => Math.max(...groups[l].map((d) => Math.abs(d.value))));
        const positive = peaks.filter((p) => p > 0);
        const hugeGap = positive.length > 1 && Math.max(...positive) / Math.min(...positive) > 20;
        if (units.size > 1 || hugeGap) return renderTableChart(w, h, data, s);
    }
    const series = extractLegendItems(data);
    const multi = series.length > 1 && data.some((d) => toString(d.group) !== '');
    const cmp = h < 180;
    const legendOn = s.showLegend && multi;
    const padL = s.showYAxis ? 46 : 18;
    const padR = 14;
    const padT = legendOn ? (cmp ? 40 : 54) : (cmp ? 26 : 38);
    const padB = s.showXAxis ? (cmp ? 24 : 30) : 12;
    const vFS = cmp ? Math.max(8.5, s.valueFontSize - 2.5) : Math.max(9, s.valueFontSize - 1);
    const xFS = cmp ? Math.max(9, s.xAxisFontSize - 3) : Math.max(10, s.xAxisFontSize - 1);
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxVal = Math.max(...data.map((d) => d.value), 1);

    let defs = '';
    const gm: Record<string, string> = {};
    if (multi) {
        for (const sr of series) {
            const id = uid('bg');
            gm[sr.label] = id;
            defs += vGrad(id, sr.color, ctx);
        }
    } else {
        for (const d of data) {
            if (!gm[d.label]) {
                const id = uid('bg');
                gm[d.label] = id;
                defs += vGrad(id, d.color, ctx);
            }
        }
    }

    let svg = `<defs>${defs}</defs>`;
    // 域支持负值：有负值时零线上移、负柱向下伸；此时不画刻度（避免混排歧义）
    const minVal = Math.min(...data.map((d) => d.value), 0);
    const hasNeg = minVal < 0;
    let hi: number;
    let lo: number;
    if (hasNeg) {
        hi = Math.max(maxVal, 0) * 1.14 || 1;
        lo = minVal * 1.14;
        svg += softGrid(padL, padT, plotW, plotH, 4, ctx, s.showGrid);
    } else if (s.showYAxis) {
        // 编辑面板显式打开 Y 轴：按友好步长画刻度（点状网格同款基线，刻度字弱化）
        const step = niceTickStep(maxVal, 4);
        hi = step * 4;
        lo = 0;
        for (let i = 1; i <= 4; i++) {
            const y = padT + plotH - (plotH * i) / 4;
            if (s.showGrid) svg += gridLine(padL, padL + plotW, y, ctx);
            svg += `<text x="${padL - 10}" y="${y + 4}" text-anchor="end" font-size="${s.yAxisFontSize}" fill="${s.yAxisFontColor}" opacity="0.55">${formatTickLabel(step * i)}</text>`;
        }
        svg += gridLine(padL, padL + plotW, padT + plotH, ctx);
    } else {
        hi = maxVal * 1.14;
        lo = 0;
        svg += softGrid(padL, padT, plotW, plotH, 4, ctx, s.showGrid);
    }
    const span = hi - lo || 1;
    const zeroY = padT + (hi / span) * plotH;
    if (hasNeg) svg += `<line x1="${padL}" y1="${zeroY}" x2="${padL + plotW}" y2="${zeroY}" stroke="${ctx.base}" stroke-width="1"/>`;

    const groupW = plotW / labels.length;
    // 少分类宽槽自适应：只有 1~2 个分类时柱宽上限放宽（单系列 48→84、分组 34→56），宽槽里孤柱不再细得发虚
    const fewCats = labels.length <= 2;
    const singleCap = fewCats ? 84 : 48;
    const groupCap = fewCats ? 56 : 34;
    const autoBarWidths = labels.map((label) => {
        const itemCount = groups[label].length;
        return Math.max(4, multi ? Math.min(groupCap, (groupW * 0.72) / itemCount - 4) : Math.min(singleCap, groupW * 0.52));
    });

    // 显式柱间距把全部柱体视为一条连续序列并整体居中；空间不足时优先收窄柱宽，
    // 再把过大的间距限制到至少能容纳 4px 柱体，避免用户输入极值后画出槽位外。
    const requestedGap = s.barGap != null && Number.isFinite(s.barGap) ? Math.max(0, s.barGap) : undefined;
    const totalBars = data.length;
    const gapCount = Math.max(0, totalBars - 1);
    let manualGap = requestedGap;
    let manualScale = 1;
    let manualCursor = 0;
    if (manualGap != null) {
        if (gapCount > 0) manualGap = Math.min(manualGap, Math.max(0, (plotW - totalBars * 4) / gapCount));
        const naturalBarsWidth = labels.reduce((sum, label, i) => sum + groups[label].length * autoBarWidths[i], 0);
        const availableBarsWidth = Math.max(totalBars * 4, plotW - manualGap * gapCount);
        manualScale = naturalBarsWidth > 0 ? Math.min(1, availableBarsWidth / naturalBarsWidth) : 1;
        const contentWidth = naturalBarsWidth * manualScale + manualGap * gapCount;
        manualCursor = padL + Math.max(0, (plotW - contentWidth) / 2);
    }

    labels.forEach((label, i) => {
        const items = groups[label];
        // 自动模式保持经典比例；手动模式使用面板填写的相邻柱体像素间距。
        const barW = autoBarWidths[i] * manualScale;
        const itemGap = manualGap ?? 5;
        const tw = items.length * barW + (items.length - 1) * itemGap;
        const sx = manualGap == null ? padL + groupW * i + (groupW - tw) / 2 : manualCursor;
        const gcx = sx + tw / 2;
        items.forEach((it, j) => {
            const x = sx + j * (barW + itemGap);
            const neg = it.value < 0;
            const bh = Math.max((Math.abs(it.value) / span) * plotH, 3);
            // 四角全圆角（柱顶柱底同款），半径受柱高一半约束避免两端圆角互相吃掉
            const r = Math.min(8, s.barRadius, barW / 2, bh / 2);
            const y = neg ? zeroY : zeroY - bh;
            svg += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="${r}" fill="url(#${gm[it.group || it.label]})"/>`;
            if (s.showValues) {
                const ty = neg ? zeroY + bh + vFS + 4 : y - 6;
                svg += `<text x="${x + barW / 2}" y="${ty}" text-anchor="middle" font-size="${vFS}" fill="${ctx.ink}" opacity="0.8" font-weight="600">${esc(formatValue(it.value, s.unit))}</text>`;
            }
        });
        if (manualGap != null) manualCursor += tw + manualGap;
        if (s.showXAxis) {
            svg += `<text x="${gcx}" y="${padT + plotH + (cmp ? 16 : 20)}" text-anchor="middle" font-size="${xFS}" fill="${s.xAxisFontColor}" opacity="0.85" font-weight="500">${esc(label)}</text>`;
        }
    });

    if (legendOn) svg += legendRowV2(series, padL, plotW, cmp ? 14 : 20, s.legendFontSize, s.legendTextColor);
    return svg;
}

function renderLineChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    const ctx = v2ctx(s);
    const labels: string[] = [];
    for (const item of data) {
        if (!labels.includes(item.label)) labels.push(item.label);
    }
    const { names, series } = groupBySeries(data);
    const multi = names.length > 1;
    const cmp = h < 180;
    const legendOn = s.showLegend && multi;
    const padL = s.showYAxis ? 46 : 22;
    const padR = 40;
    const padT = legendOn ? (cmp ? 42 : 56) : (cmp ? 32 : 46);
    const padB = s.showXAxis ? (cmp ? 24 : 30) : 12;
    const vFS = cmp ? Math.max(8.5, s.valueFontSize - 2.5) : Math.max(9, s.valueFontSize - 1);
    const xFS = cmp ? Math.max(9, s.xAxisFontSize - 3) : Math.max(10, s.xAxisFontSize - 1);
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    let defs = '';
    const gradIds: string[] = [];
    names.forEach((name) => {
        const c = series[name][0]?.color || ctx.acc;
        const id = uid('la');
        gradIds.push(id);
        defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="${Math.max(0.12, Math.min(0.3, s.areaOpacity * 1.5))}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`;
    });
    const fg = uid('lf');
    defs += glowF(fg, ctx.acc);

    let svg = `<defs>${defs}</defs>`;
    // 标度域三种情况：
    // ① 有负值 → 域取 [min*1.1, max*1.16]，零线可见、负值画在零线以下
    // ② 大基数小波动（min/max > 0.55，如 13.9 万→14.1 万）→ 域裁剪到数据附近，不从 0 起（否则曲线压成一条平线）
    // ③ 常规 → 0 起
    const vals = data.map((d) => d.value);
    const mx = Math.max(...vals, 0);
    const mn = Math.min(...vals, 0);
    const dataMin = Math.min(...vals);
    let lo: number;
    let hi: number;
    if (mn < 0) {
        const spanRaw = mx - mn || 1;
        lo = mn - spanRaw * 0.10;
        hi = mx + spanRaw * 0.16;
    } else if (mx > 0 && dataMin / mx > 0.55 && mx > dataMin) {
        const spanRaw = mx - dataMin;
        lo = Math.max(0, dataMin - spanRaw * 0.45);
        hi = mx + spanRaw * 0.4;
    } else {
        lo = 0;
        hi = mx * 1.18 || 1;
    }
    const span = hi - lo || 1;
    const Y = (v: number) => padT + plotH - ((v - lo) / span) * plotH;
    if (s.showYAxis) {
        // 刻度沿裁剪后的域按友好步长铺设（点状网格同款，刻度字弱化）
        const step = niceTickStep(span, 4);
        for (let tv = Math.ceil(lo / step) * step; tv <= hi + EPSILON; tv += step) {
            const y = Y(tv);
            if (y < padT - EPSILON) break;
            if (s.showGrid) svg += gridLine(padL, padL + plotW, y, ctx);
            svg += `<text x="${padL - 10}" y="${y + 4}" text-anchor="end" font-size="${s.yAxisFontSize}" fill="${s.yAxisFontColor}" opacity="0.55">${formatTickLabel(tv)}</text>`;
        }
        svg += gridLine(padL, padL + plotW, padT + plotH, ctx);
    } else {
        svg += softGrid(padL, padT, plotW, plotH, 4, ctx, s.showGrid);
    }
    // 面积闭合到零线（有负值）或绘图区底部（无负值）
    const baseY = mn < 0 ? Y(0) : padT + plotH;
    if (mn < 0) svg += `<line x1="${padL}" y1="${Y(0)}" x2="${padL + plotW}" y2="${Y(0)}" stroke="${ctx.base}" stroke-width="1"/>`;

    names.forEach((name, idx) => {
        const c = series[name][0]?.color || ctx.acc;
        const focus = idx === 0;
        const pts: Array<[number, number, number]> = [];
        for (const it of series[name]) {
            const i = labels.indexOf(it.label);
            if (i < 0) continue;
            pts.push([
                padL + (i / Math.max(labels.length - 1, 1)) * plotW,
                Y(it.value),
                it.value,
            ]);
        }
        if (pts.length === 0) return;
        const path = smoothPath(pts.map((p) => [p[0], p[1]] as [number, number]));
        svg += `<path d="${path} L ${pts[pts.length - 1][0]} ${baseY} L ${pts[0][0]} ${baseY} Z" fill="url(#${gradIds[idx]})"/>`;
        svg += `<path d="${path}" fill="none" stroke="${c}" stroke-width="${focus ? s.lineWidth : Math.max(1.5, s.lineWidth - 0.8)}" stroke-linecap="round"${focus && ctx.dark ? ` filter="url(#${fg})"` : ''} opacity="${focus ? 1 : 0.78}"/>`;
        pts.forEach((p, i) => {
            const last = i === pts.length - 1;
            svg += `<circle cx="${p[0]}" cy="${p[1]}" r="${last ? 4 : 2.8}" fill="${c}"/>`;
            // 无 Y 轴刻度时数值由数据标签承载：单系列每点带小字，多系列由末点数值承载（数值平权，无 chip/光环）
            if (!s.showValues) return;
            if (!multi) {
                svg += `<text x="${p[0]}" y="${p[1] - 10}" text-anchor="middle" font-size="${vFS}" fill="${ctx.ink}" opacity="0.75" font-weight="600">${esc(formatValue(p[2], s.unit))}</text>`;
            } else if (last) {
                svg += `<text x="${p[0] + 11}" y="${p[1] + 4}" font-size="${vFS}" fill="${c}" font-weight="600">${esc(formatValue(p[2], s.unit))}</text>`;
            }
        });
    });

    if (s.showXAxis) {
        labels.forEach((label, i) => {
            svg += `<text x="${padL + (i / Math.max(labels.length - 1, 1)) * plotW}" y="${padT + plotH + (cmp ? 16 : 20)}" text-anchor="middle" font-size="${xFS}" fill="${s.xAxisFontColor}" opacity="0.85" font-weight="500">${esc(label)}</text>`;
        });
    }
    if (legendOn) svg += legendRowV2(extractLegendItems(data), padL, plotW, cmp ? 14 : 20, s.legendFontSize, s.legendTextColor);
    return svg;
}

/** 饼/环扇区径向渐变（与柱体 vGrad 同一套双色相语言）：圆心亮端（向冷邻色微转+提亮）→ 外缘沉端（向暖邻色转再沉入底色）。
 *  gradientUnits=userSpaceOnUse 固定在图形圆心，环带/外移焦点扇区共用同一光源。 */
function pieGrad(id: string, c: string, ctx: V2Ctx, cx: number, cy: number, r: number, innerOffset = 0): string {
    const inner = mixColor(shiftHue(c, -12), '#FFFFFF', 0.14);
    const outer = ctx.dark ? mixColor(shiftHue(c, 20), ctx.canvas, 0.18) : mixColor(shiftHue(c, 16), '#FFFFFF', 0.24);
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}"><stop offset="${innerOffset}" stop-color="${inner}"/><stop offset="1" stop-color="${outer}"/></radialGradient>`;
}

function renderPieChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    const ctx = v2ctx(s);
    const narrow = w < 380 || !s.showLegend; // 窄槽自动隐藏图例、图形居中
    const cx = narrow ? w / 2 : w * 0.34;
    const cy = h / 2;
    const r = Math.max(10, Math.min((narrow ? w / 2 : cx) - 16, cy - 16));
    const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0) || 1;
    const maxIdx = data.reduce((mi, d, i) => (d.value > data[mi].value ? i : mi), 0);
    let defs = '';
    const gradIds = data.map((it) => {
        const id = uid('pg');
        defs += pieGrad(id, it.color, ctx, cx, cy, r + 10);
        return id;
    });
    let a = 0;
    let svg = `<defs>${defs}</defs>`;
    data.forEach((it, i) => {
        const val = Math.max(0, it.value);
        const sw = (val / total) * 360;
        if (sw <= 0) return;
        const mid = a + sw / 2;
        // 最大扇区沿中线外移 8px 成焦点扇区
        let ox = 0;
        let oy = 0;
        if (i === maxIdx) {
            const p = polarToCartesian(0, 0, 8, mid);
            ox = p.x;
            oy = p.y;
        }
        svg += `<path d="${describeSector(cx + ox, cy + oy, r, a, a + sw)}" fill="url(#${gradIds[i]})" stroke="${ctx.canvas}" stroke-width="3"/>`;
        if (s.showValues && sw > 18) {
            const lp = polarToCartesian(cx + ox, cy + oy, r * 0.66, mid);
            svg += `<text x="${lp.x}" y="${lp.y}" text-anchor="middle" dominant-baseline="central" font-size="${Math.max(9.5, Math.min(12.5, r * 0.16))}" fill="${readableTextColor(it.color)}" font-weight="700">${Math.round((val / total) * 100)}%</text>`;
        }
        a += sw;
    });
    if (!narrow) svg += legendColV2(data, w * 0.66, h, s.legendFontSize, s.legendTextColor);
    return svg;
}

function renderDonutChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    const ctx = v2ctx(s);
    const narrow = w < 380 || !s.showLegend;
    const cx = narrow ? w / 2 : w * 0.33;
    const cy = h / 2;
    // 经典实心环带：ringSegment 填充 + 焦点扇段外扩发光；整体缩至可用半径 90%（环体略收、留呼吸感）
    const outerR = Math.max(10, Math.min((narrow ? w / 2 : cx) - 20, cy - 16) * 0.9);
    const innerR = outerR * s.donutInnerRatio;
    const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0) || 1;
    const maxIdx = data.reduce((mi, d, i) => (d.value > data[mi].value ? i : mi), 0);
    const gid = uid('dg');
    const fid = uid('df');
    let defs = `${numGrad(gid, ctx.acc, ctx.dark)}${glowF(fid, ctx.acc)}`;
    // 环带径向渐变：从内缘到外缘（含焦点扇段外扩 7px），渐变起点钉在内环半径处
    const maxRo = outerR + 7;
    const gradIds = data.map((it) => {
        const id = uid('dsg');
        defs += pieGrad(id, it.color, ctx, cx, cy, maxRo, innerR / maxRo);
        return id;
    });
    let svg = `<defs>${defs}</defs>`;
    let a = 0;
    const GAP = 1.8;
    data.forEach((it, i) => {
        const val = Math.max(0, it.value);
        const sw = (val / total) * 360;
        const focus = i === maxIdx;
        const ro = focus ? outerR + 7 : outerR;
        if (sw > GAP) {
            svg += `<path d="${ringSegment(cx, cy, ro, innerR, a + GAP / 2, a + sw - GAP / 2)}" fill="url(#${gradIds[i]})"${focus && ctx.dark ? ` filter="url(#${fid})"` : ''} opacity="${focus ? 1 : 0.9}"/>`;
        }
        a += sw;
    });
    // 环心大数字 = 最大项占比（accent 渐变 + 深色微光），下方灰字标注项名
    const pct = Math.round((Math.max(0, data[maxIdx].value) / total) * 100);
    const numFs = Math.max(20, Math.min(34, outerR * 0.42));
    svg += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="${numFs}" font-weight="700" fill="url(#${gid})"${ctx.dark ? ` filter="url(#${fid})"` : ''}>${pct}%</text>`;
    svg += `<text x="${cx}" y="${cy + numFs * 0.66}" text-anchor="middle" font-size="${Math.max(9.5, Math.min(11.5, outerR * 0.14))}" fill="${ctx.mut}">${esc(data[maxIdx].label)}</text>`;
    if (!narrow) svg += legendColV2(data, w * 0.64, h, s.legendFontSize, s.legendTextColor);
    return svg;
}

function renderHorizontalBarChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 排行榜结构：名称 + 右对齐数值 + 下方全宽轨道条（无轴无网格无名次编号，榜单顺序自明）
    const ctx = v2ctx(s);
    const n = data.length;
    if (n === 0) return '';
    // 行高默认平分槽高；面板设置了行间距（barRowGap）时行高收敛为「内容高约 30px + 间距」
    // 并整块垂直居中——行少的高槽不再被平分撑得过于松散
    const naturalRowH = (h - 24) / n;
    let rowH = naturalRowH;
    let yTop = 12;
    if (s.barRowGap != null) {
        rowH = Math.min(naturalRowH, Math.max(30, 30 + s.barRowGap));
        yTop = 12 + Math.max(0, (h - 24 - rowH * n) / 2);
    }
    const maxVal = Math.max(...data.map((d) => d.value), 1);
    const x0 = 20;
    const x1 = w - 20;
    const trackW = x1 - x0;
    let defs = '';
    const fg = uid('hf');
    defs += glowF(fg, data[0].color);
    const gradIds = data.map((d) => {
        const id = uid('hg');
        defs += hGrad(id, d.color, ctx);
        return id;
    });
    let svg = `<defs>${defs}</defs>`;
    data.forEach((it, i) => {
        const y = yTop + rowH * i;
        const trackY = y + rowH * 0.62;
        const top = i === 0;
        svg += `<text x="${x0}" y="${y + rowH * 0.30}" font-size="12.5" fill="${top ? ctx.ink : ctx.mut}" font-weight="${top ? 700 : 500}">${esc(truncateToWidth(it.label, 12.5, trackW * 0.6))}</text>`;
        if (s.showValues) {
            svg += `<text x="${x1}" y="${y + rowH * 0.30}" text-anchor="end" font-size="13" font-weight="700" fill="${top ? it.color : ctx.ink}" opacity="${top ? 1 : 0.85}">${esc(formatValue(it.value, s.unit))}</text>`;
        }
        svg += `<rect x="${x0}" y="${trackY - 5}" width="${trackW}" height="10" rx="5" fill="${ctx.neutral(0.055)}"/>`;
        svg += `<rect x="${x0}" y="${trackY - 5}" width="${Math.max((Math.max(0, it.value) / maxVal) * trackW, 10)}" height="10" rx="5" fill="url(#${gradIds[i]})"${top && ctx.dark ? ` filter="url(#${fg})"` : ''}/>`;
    });
    return svg;
}

function renderStackedBarChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    const ctx = v2ctx(s);
    const { labels, groups } = groupByLabel(data);
    const series = extractLegendItems(data);
    const cmp = h < 180;
    const legendOn = s.showLegend && series.length > 1;
    const padL = s.showYAxis ? 46 : 18;
    const padR = 14;
    const padT = legendOn ? (cmp ? 40 : 52) : (cmp ? 26 : 38);
    const padB = s.showXAxis ? (cmp ? 24 : 30) : 12;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const totals = labels.map((l) => groups[l].reduce((t, d) => t + Math.max(0, d.value), 0));
    const maxVal = Math.max(...totals, 1);

    let defs = '';
    const gm: Record<string, string> = {};
    for (const sr of series) {
        const id = uid('sg');
        gm[sr.label] = id;
        defs += vGrad(id, sr.color, ctx);
    }
    let svg = `<defs>${defs}</defs>`;
    let ceiling: number;
    if (s.showYAxis) {
        const step = niceTickStep(maxVal, 4);
        ceiling = step * 4;
        for (let i = 1; i <= 4; i++) {
            const y = padT + plotH - (plotH * i) / 4;
            if (s.showGrid) svg += gridLine(padL, padL + plotW, y, ctx);
            svg += `<text x="${padL - 10}" y="${y + 4}" text-anchor="end" font-size="${s.yAxisFontSize}" fill="${s.yAxisFontColor}" opacity="0.55">${formatTickLabel(step * i)}</text>`;
        }
        svg += gridLine(padL, padL + plotW, padT + plotH, ctx);
    } else {
        ceiling = maxVal * 1.14;
        svg += softGrid(padL, padT, plotW, plotH, 4, ctx, s.showGrid);
    }

    const groupW = plotW / labels.length;
    const barW = Math.max(6, Math.min(42, groupW * 0.5));
    labels.forEach((label, i) => {
        const x = padL + groupW * i + groupW / 2 - barW / 2;
        let cy2 = padT + plotH;
        const items = groups[label];
        items.forEach((it, j) => {
            const bh = Math.max((Math.max(0, it.value) / ceiling) * plotH - 2, 2);
            cy2 -= bh + 2;
            const isTop = j === items.length - 1;
            const r = isTop ? Math.min(barW / 2, 10) : 3;
            svg += `<path d="M ${x} ${cy2 + bh} L ${x} ${cy2 + r} A ${r} ${r} 0 0 1 ${x + r} ${cy2} L ${x + barW - r} ${cy2} A ${r} ${r} 0 0 1 ${x + barW} ${cy2 + r} L ${x + barW} ${cy2 + bh} Z" fill="url(#${gm[it.group || it.label]})" opacity="0.94"/>`;
        });
        if (s.showValues) {
            svg += `<text x="${x + barW / 2}" y="${cy2 - 9}" text-anchor="middle" font-size="${cmp ? 10 : 11.5}" fill="${ctx.ink}" font-weight="700">${esc(formatValue(totals[i], s.unit))}</text>`;
        }
        if (s.showXAxis) {
            svg += `<text x="${x + barW / 2}" y="${padT + plotH + (cmp ? 16 : 20)}" text-anchor="middle" font-size="${cmp ? 10 : 12}" fill="${s.xAxisFontColor}" opacity="0.85">${esc(label)}</text>`;
        }
    });
    if (legendOn) svg += legendRowV2(series, padL, plotW, cmp ? 14 : 20, s.legendFontSize, s.legendTextColor);
    return svg;
}

function renderHistogramChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    const ctx = v2ctx(s);
    const cmp = h < 180;
    const padL = s.showYAxis ? 42 : 16;
    const padR = 14;
    const padT = cmp ? 28 : 36;
    const padB = s.showXAxis ? (cmp ? 24 : 30) : 12;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxVal = Math.max(...data.map((d) => d.value), 1);
    const gid = uid('hg2');
    let svg = `<defs>${vGrad(gid, ctx.acc, ctx)}</defs>`;
    let ceiling: number;
    if (s.showYAxis) {
        const step = niceTickStep(maxVal, 4);
        ceiling = step * 4;
        for (let i = 1; i <= 4; i++) {
            const y = padT + plotH - (plotH * i) / 4;
            if (s.showGrid) svg += gridLine(padL, padL + plotW, y, ctx);
            svg += `<text x="${padL - 10}" y="${y + 4}" text-anchor="end" font-size="${s.yAxisFontSize}" fill="${s.yAxisFontColor}" opacity="0.55">${formatTickLabel(step * i)}</text>`;
        }
        svg += gridLine(padL, padL + plotW, padT + plotH, ctx);
    } else {
        ceiling = maxVal * 1.12;
        svg += softGrid(padL, padT, plotW, plotH, 4, ctx, s.showGrid);
    }
    // 柱体连续无组间距（bin 语义）；所有柱统一 accent 渐变、柱顶小字数值，不给众数柱加特效
    const bw = plotW / data.length;
    data.forEach((it, i) => {
        const bh = Math.max((Math.max(0, it.value) / ceiling) * plotH, 2);
        const x = padL + bw * i + 1.5;
        const y = padT + plotH - bh;
        const r = Math.min((bw - 3) / 2, 6);
        svg += `<path d="M ${x} ${y + bh} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} L ${x + bw - 3 - r} ${y} A ${r} ${r} 0 0 1 ${x + bw - 3} ${y + r} L ${x + bw - 3} ${y + bh} Z" fill="url(#${gid})" opacity="0.9"/>`;
        if (s.showValues) {
            svg += `<text x="${x + (bw - 3) / 2}" y="${y - 7}" text-anchor="middle" font-size="${cmp ? 9 : 10.5}" fill="${ctx.ink}" opacity="0.8" font-weight="600">${esc(formatValue(it.value, s.unit))}</text>`;
        }
        if (s.showXAxis && i % 2 === 0) {
            svg += `<text x="${padL + bw * i + bw / 2}" y="${padT + plotH + (cmp ? 16 : 20)}" text-anchor="middle" font-size="${cmp ? 10 : 11}" fill="${s.xAxisFontColor}" opacity="0.8">${esc(it.label)}</text>`;
        }
    });
    return svg;
}

function renderHeatmapChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // label=行、group=列、value=强度。圆点矩阵形态（气泡热力）：半径 + 透明度双编码强度，
    // 峰值点满色 + 外圈光环 + 数值；与常见「方格填色」热力图明确区分
    const ctx = v2ctx(s);
    const rows: string[] = [];
    const cols: string[] = [];
    for (const d of data) {
        if (!rows.includes(d.label)) rows.push(d.label);
        const g = toString(d.group);
        if (g && !cols.includes(g)) cols.push(g);
    }
    if (rows.length === 0 || cols.length === 0) return '';
    const rowLabelW = rows.reduce((m, r) => Math.max(m, approxTextWidth(r, s.yAxisFontSize)), 0);
    const padL = Math.min(w * 0.3, rowLabelW + 18);
    const padR = 16;
    const padT = 14;
    const legendOn = s.showLegend && h >= 170;
    const padB = (s.showXAxis ? 30 : 10) + (legendOn ? 16 : 0);
    const cw = (w - padL - padR) / cols.length;
    const ch = (h - padT - padB) / rows.length;
    const maxVal = Math.max(...data.map((d) => d.value), 1);
    const rMax = Math.max(4, Math.min(cw, ch) / 2 - 3);
    let svg = '';
    data.forEach((d) => {
        const ri = rows.indexOf(d.label);
        const ci = cols.indexOf(toString(d.group));
        if (ri < 0 || ci < 0) return;
        const v = Math.max(0, d.value) / maxVal;
        const hot = v >= 0.85;
        const cxp = padL + cw * ci + cw / 2;
        const cyp = padT + ch * ri + ch / 2;
        // 半径按 sqrt 缩放贴合面积感知，最低 28% 保证低值可见
        const r = rMax * (0.28 + 0.72 * Math.sqrt(v));
        if (hot) {
            svg += `<circle cx="${cxp}" cy="${cyp}" r="${Math.min(rMax + 3, r + 3.5)}" fill="none" stroke="${rgbaStr(ctx.acc, 0.4)}" stroke-width="1.5"/>`;
            svg += `<circle cx="${cxp}" cy="${cyp}" r="${r}" fill="${ctx.acc}"/>`;
            if (s.showValues && r >= 11) {
                svg += `<text x="${cxp}" y="${cyp + 3.8}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${readableTextColor(ctx.acc)}">${d.value}</text>`;
            }
        } else {
            svg += `<circle cx="${cxp}" cy="${cyp}" r="${r}" fill="${rgbaStr(ctx.acc, 0.16 + v * 0.6)}"/>`;
        }
    });
    rows.forEach((r, i) => {
        svg += `<text x="${padL - 10}" y="${padT + ch * i + ch / 2 + 4}" text-anchor="end" font-size="${s.yAxisFontSize}" fill="${s.yAxisFontColor}">${esc(truncateToWidth(r, s.yAxisFontSize, padL - 14))}</text>`;
    });
    if (s.showXAxis) {
        cols.forEach((c, i) => {
            svg += `<text x="${padL + cw * i + cw / 2}" y="${padT + ch * rows.length + 20}" text-anchor="middle" font-size="${Math.max(9, s.xAxisFontSize - 2)}" fill="${s.xAxisFontColor}" opacity="0.85">${esc(c)}</text>`;
        });
    }
    if (legendOn) {
        // 尺寸图例：小中大三枚圆点
        const ly = h - 12;
        let lx = w - 118;
        svg += `<text x="${lx - 8}" y="${ly + 3}" text-anchor="end" font-size="10" fill="${ctx.mut}" opacity="0.7">低</text>`;
        [[3.5, 0.25], [5.5, 0.5], [7.5, 0.9]].forEach(([r, a]) => {
            svg += `<circle cx="${lx + r}" cy="${ly}" r="${r}" fill="${rgbaStr(ctx.acc, a)}"/>`;
            lx += r * 2 + 10;
        });
        svg += `<text x="${lx + 2}" y="${ly + 3}" font-size="10" fill="${ctx.mut}" opacity="0.7">高</text>`;
    }
    return svg;
}

function renderRadarChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    const ctx = v2ctx(s);
    const axes: string[] = [];
    for (const d of data) {
        if (!axes.includes(d.label)) axes.push(d.label);
    }
    const n = axes.length;
    if (n < 3) return '';
    const { names, series } = groupBySeries(data);
    const cx = w / 2;
    const cy = h / 2 + 8;
    const R = Math.max(20, Math.min(w, h) / 2 - 42);
    const maxVal = Math.max(...data.map((d) => d.value), 1);
    let svg = '';
    // 点状同心多边形网格
    if (s.showGrid) {
        for (let k = 1; k <= 4; k++) {
            const pts = axes.map((_, i) => {
                const p = polarToCartesian(cx, cy, (R * k) / 4, (i * 360) / n);
                return `${p.x},${p.y}`;
            }).join(' ');
            svg += `<polygon points="${pts}" fill="none" stroke="${ctx.grid}" stroke-dasharray="1 5" stroke-linecap="round"/>`;
        }
    }
    axes.forEach((axis, i) => {
        const p = polarToCartesian(cx, cy, R, (i * 360) / n);
        const pl = polarToCartesian(cx, cy, R + 22, (i * 360) / n);
        svg += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="${ctx.grid}"/>`;
        svg += `<text x="${pl.x}" y="${pl.y + 4}" text-anchor="middle" font-size="${Math.max(9.5, s.xAxisFontSize - 2)}" fill="${s.xAxisFontColor}">${esc(axis)}</text>`;
    });
    const fid = uid('rf');
    svg += `<defs>${glowF(fid, ctx.acc)}</defs>`;
    names.forEach((name, idx) => {
        const c = series[name][0]?.color || ctx.acc;
        const focus = idx === 0;
        const pts = axes.map((axis, i) => {
            const it = series[name].find((d) => d.label === axis);
            const p = polarToCartesian(cx, cy, R * (it ? Math.max(0, it.value) / maxVal : 0), (i * 360) / n);
            return [p.x, p.y] as [number, number];
        });
        svg += `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${rgbaStr(c, 0.16)}" stroke="${c}" stroke-width="${focus ? 2.6 : 2}"${focus && ctx.dark ? ` filter="url(#${fid})"` : ''} opacity="${focus ? 1 : 0.8}"/>`;
        pts.forEach((p) => {
            svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${c}"/>`;
        });
    });
    if (s.showLegend && names.length > 1) svg += legendRowV2(extractLegendItems(data), 0, w, 14, s.legendFontSize, s.legendTextColor);
    return svg;
}

function renderQuadrantChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 数据行需 x/y（0~100 归一坐标）+ r（气泡权重）；右上象限自动铺 accent 低透明 wash
    const ctx = v2ctx(s);
    const items = data.filter((d) => d.x != null && d.y != null);
    if (items.length === 0) return '';
    const padL = 54;
    const padR = 26;
    const padT = 30;
    const padB = 42;
    const x0 = padL;
    const y0 = padT;
    const pw = w - padL - padR;
    const ph = h - padT - padB;
    const cx = x0 + pw / 2;
    const cy = y0 + ph / 2;
    let svg = `<rect x="${cx}" y="${y0}" width="${pw / 2}" height="${ph / 2}" rx="10" fill="${rgbaStr(ctx.acc, 0.055)}"/>`;
    svg += `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y0 + ph}" stroke="${ctx.grid}" stroke-dasharray="2 6" stroke-linecap="round"/>`;
    svg += `<line x1="${x0}" y1="${cy}" x2="${x0 + pw}" y2="${cy}" stroke="${ctx.grid}" stroke-dasharray="2 6" stroke-linecap="round"/>`;
    svg += `<text x="${cx + pw / 4}" y="${y0 + 18}" text-anchor="middle" font-size="11" fill="${ctx.acc}" font-weight="600" opacity="0.85">领先区</text>`;
    const fid = uid('qf');
    svg += `<defs>${glowF(fid, ctx.acc)}</defs>`;
    const maxR = Math.max(...items.map((d) => d.r ?? 0), 1);
    items.forEach((it, i) => {
        const px = x0 + (Math.min(100, Math.max(0, it.x!)) / 100) * pw;
        const py = y0 + ph - (Math.min(100, Math.max(0, it.y!)) / 100) * ph;
        const rr = 8 + (it.r ?? 18) * 0.22;
        const c = s.palette[i % s.palette.length] || ctx.acc;
        const focus = (it.x! >= 50) && (it.y! >= 50) && ((it.r ?? 0) >= maxR * 0.99);
        svg += `<circle cx="${px}" cy="${py}" r="${rr}" fill="${rgbaStr(c, 0.30)}" stroke="${c}" stroke-width="2"${focus && ctx.dark ? ` filter="url(#${fid})"` : ''}/>`;
        svg += `<text x="${px}" y="${py - rr - 7}" text-anchor="middle" font-size="11" fill="${focus ? ctx.ink : ctx.mut}" font-weight="${focus ? 700 : 500}">${esc(it.label)}</text>`;
    });
    if (s.xAxisLabel) svg += `<text x="${x0 + pw}" y="${y0 + ph + 26}" text-anchor="end" font-size="11" fill="${ctx.mut}" opacity="0.7">${esc(s.xAxisLabel)} →</text>`;
    if (s.yAxisLabel) svg += `<text x="${x0 - 8}" y="${y0 - 8}" text-anchor="start" font-size="11" fill="${ctx.mut}" opacity="0.7">↑ ${esc(s.yAxisLabel)}</text>`;
    return svg;
}

function renderSankeyChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 数据行为 from/to/value 流量三元组；流带 = 左节点色→右节点色渐变、42% 透明度
    const ctx = v2ctx(s);
    const flows = data.filter((d) => toString(d.from) !== '' && toString(d.to) !== '' && d.value > 0);
    if (flows.length === 0) return '';
    const lNames: string[] = [];
    const rNames: string[] = [];
    for (const f of flows) {
        if (!lNames.includes(f.from!)) lNames.push(f.from!);
        if (!rNames.includes(f.to!)) rNames.push(f.to!);
    }
    const lSum = (name: string) => flows.filter((d) => d.from === name).reduce((t, d) => t + d.value, 0);
    const rSum = (name: string) => flows.filter((d) => d.to === name).reduce((t, d) => t + d.value, 0);
    const total = flows.reduce((t, d) => t + d.value, 0) || 1;
    const padT = 18;
    const padB = 18;
    const gapN = 14;
    const fs = Math.max(10, s.fontSize - 1);
    const maxLW = lNames.reduce((m, name) => Math.max(m, approxTextWidth(name, fs)), 0);
    const maxRW = rNames.reduce((m, name) => Math.max(m, approxTextWidth(name, fs)), 0);
    const x0 = Math.max(70, Math.min(w * 0.28, maxLW + 22));
    const x1 = w - Math.max(70, Math.min(w * 0.28, maxRW + 22));
    const NW = 14;
    const availH = h - padT - padB - gapN * (Math.max(lNames.length, rNames.length) - 1);
    interface NodePos { y: number; h: number; c: string; cur: number }
    const lc: Record<string, NodePos> = {};
    const rc: Record<string, NodePos> = {};
    let defs = '';
    let svg = '';
    let ly = padT;
    lNames.forEach((name, i) => {
        const bh = (lSum(name) / total) * availH;
        lc[name] = { y: ly, h: bh, c: s.palette[i % s.palette.length] || ctx.acc, cur: ly };
        ly += bh + gapN;
    });
    let ry = padT;
    rNames.forEach((name, i) => {
        const bh = (rSum(name) / total) * availH;
        rc[name] = { y: ry, h: bh, c: s.palette[(i + 3) % s.palette.length] || ctx.acc, cur: ry };
        ry += bh + gapN;
    });
    flows.forEach((f) => {
        const L = lc[f.from!];
        const R2 = rc[f.to!];
        const fh = (f.value / total) * availH;
        const gid = uid('sk');
        defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${L.c}" stop-opacity="0.42"/><stop offset="1" stop-color="${R2.c}" stop-opacity="0.42"/></linearGradient>`;
        const mx = (x0 + NW + x1 - NW) / 2;
        svg += `<path d="M ${x0 + NW} ${L.cur} C ${mx} ${L.cur}, ${mx} ${R2.cur}, ${x1 - NW} ${R2.cur} L ${x1 - NW} ${R2.cur + fh} C ${mx} ${R2.cur + fh}, ${mx} ${L.cur + fh}, ${x0 + NW} ${L.cur + fh} Z" fill="url(#${gid})"/>`;
        L.cur += fh;
        R2.cur += fh;
    });
    lNames.forEach((name) => {
        const N = lc[name];
        svg += `<rect x="${x0}" y="${N.y}" width="${NW}" height="${Math.max(2, N.h)}" rx="7" fill="${N.c}"/>`;
        svg += `<text x="${x0 - 10}" y="${N.y + N.h / 2 - 2}" text-anchor="end" font-size="${fs}" fill="${ctx.ink}" font-weight="600">${esc(truncateToWidth(name, fs, x0 - 14))}</text>`;
        if (s.showValues) svg += `<text x="${x0 - 10}" y="${N.y + N.h / 2 + 13}" text-anchor="end" font-size="10.5" fill="${ctx.mut}" opacity="0.8">${formatValue(lSum(name), s.unit)}</text>`;
    });
    rNames.forEach((name) => {
        const N = rc[name];
        svg += `<rect x="${x1 - NW}" y="${N.y}" width="${NW}" height="${Math.max(2, N.h)}" rx="7" fill="${N.c}"/>`;
        svg += `<text x="${x1 + 10}" y="${N.y + N.h / 2 - 2}" font-size="${fs}" fill="${ctx.ink}" font-weight="600">${esc(truncateToWidth(name, fs, w - x1 - 14))}</text>`;
        if (s.showValues) svg += `<text x="${x1 + 10}" y="${N.y + N.h / 2 + 13}" font-size="10.5" fill="${ctx.mut}" opacity="0.8">${formatValue(rSum(name), s.unit)}</text>`;
    });
    return `<defs>${defs}</defs>` + svg;
}

function renderGaugeChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 240° 粗盘体圆帽弧（带宽 ≈ 半径 30%）+ 渐变进度；中心大数字 font-weight 800
    const ctx = v2ctx(s);
    const max = s.max > 0 ? s.max : 100;
    const unit = s.unit || '%';
    const v = data[0].value;
    const pct = Math.min(1, Math.max(0, v / max));
    const cx = w / 2;
    const cy = h / 2 + 24;
    const R = Math.max(30, Math.min(w / 2.6, h / 1.9) - 8);
    const band = Math.max(24, R * 0.30);
    const A0 = -120;
    const A1 = 120;
    const gid = uid('gg');
    const fid = uid('gf');
    let svg = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${mixColor(shiftHue(ctx.acc, 22), ctx.canvas, 0.18)}"/><stop offset="1" stop-color="${mixColor(shiftHue(ctx.acc, -10), '#FFFFFF', 0.08)}"/></linearGradient>${numGrad(`${gid}t`, ctx.acc, ctx.dark)}${glowF(fid, ctx.acc)}</defs>`;
    svg += `<path d="${arcStroke(cx, cy, R, A0, A1)}" fill="none" stroke="${ctx.neutral(0.08)}" stroke-width="${band}" stroke-linecap="round"/>`;
    if (pct > 0.01) {
        svg += `<path d="${arcStroke(cx, cy, R, A0, A0 + (A1 - A0) * pct)}" fill="none" stroke="url(#${gid})" stroke-width="${band}" stroke-linecap="round"${ctx.dark ? ` filter="url(#${fid})"` : ''}/>`;
    }
    // 中心字号随半径线性缩放且不设高下限：小槽（R≈60）时约 30px，避免数字撑破盘体
    const numFs = Math.max(20, Math.min(48, R * 0.5));
    const lblFs = Math.max(10, Math.min(13, R * 0.18));
    svg += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="${numFs}" font-weight="800" fill="url(#${gid}t)">${v}${esc(unit)}</text>`;
    svg += `<text x="${cx}" y="${cy + Math.max(16, Math.min(24, R * 0.32))}" text-anchor="middle" font-size="${lblFs}" font-weight="600" fill="${ctx.mut}">${esc(data[0].label)}</text>`;
    const pMin = polarToCartesian(cx, cy, R, A0);
    const pMax = polarToCartesian(cx, cy, R, A1);
    svg += `<text x="${pMin.x}" y="${pMin.y + 28}" text-anchor="middle" font-size="10.5" fill="${ctx.mut}" opacity="0.6">0</text>`;
    svg += `<text x="${pMax.x}" y="${pMax.y + 28}" text-anchor="middle" font-size="10.5" fill="${ctx.mut}" opacity="0.6">${max}</text>`;
    return svg;
}

/** 哑铃图下降行的方向色（上升走 accent，下降固定红） */
const DUMBBELL_DOWN_COLOR = '#FF375F';

function renderDumbbellChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    const ctx = v2ctx(s);
    const { labels, groups } = groupByLabel(data);
    if (labels.length === 0) return '';
    const gnames: string[] = [];
    for (const d of data) {
        const g = toString(d.group);
        if (g && !gnames.includes(g)) gnames.push(g);
    }
    const yFS = Math.max(10, s.yAxisFontSize);
    const maxLW = labels.reduce((m, l) => Math.max(m, approxTextWidth(l, yFS)), 0);
    const padL = Math.max(60, Math.min(w * 0.34, maxLW + 22));
    const padR = 76;
    const legendOn = s.showLegend && gnames.length >= 2;
    const padT = legendOn ? 36 : 18;
    const padB = 14;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const rowH = plotH / labels.length;
    // 标度支持负值：域取 [min(0,最小值), 最大值]，值为负时点不会跑出绘图区
    const vals = data.map((d) => d.value);
    const hi = Math.max(...vals, 1) * 1.08;
    const lo = Math.min(0, ...vals) * 1.08;
    const X = (v: number) => padL + ((v - lo) / (hi - lo)) * plotW;
    let svg = '';
    if (lo < 0) svg += `<line x1="${X(0)}" y1="${padT - 6}" x2="${X(0)}" y2="${padT + plotH}" stroke="${ctx.base}" stroke-width="1"/>`;
    // 收集每行终点实际用色，供图例取色（全下降的图上没有一个 accent 点，图例不能再画 accent）
    const endColors: string[] = [];
    labels.forEach((label, i) => {
        const items = groups[label];
        const a = items[0];
        const b = items[items.length - 1];
        const y = padT + rowH * i + rowH / 2;
        const xa = X(a.value);
        const xb = X(b.value);
        // 方向语义：上升行 accent、下降行红，连接线/终点圆/差值同色
        const delta = b.value - a.value;
        const c = delta < 0 ? DUMBBELL_DOWN_COLOR : ctx.acc;
        endColors.push(c);
        svg += `<text x="${padL - 14}" y="${y + 4}" text-anchor="end" font-size="${yFS}" fill="${s.yAxisFontColor}">${esc(truncateToWidth(label, yFS, padL - 18))}</text>`;
        if (s.showGrid) svg += `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${ctx.grid}" stroke-dasharray="1 6" stroke-linecap="round"/>`;
        // 连接线用实色：线性渐变作用在零高度 line 的 objectBoundingBox 上会整条不渲染
        svg += `<line x1="${Math.min(xa, xb)}" y1="${y}" x2="${Math.max(xa, xb)}" y2="${y}" stroke="${rgbaStr(c, 0.5)}" stroke-width="5" stroke-linecap="round"/>`;
        // 端点与图例同款实心圆角方点（无描边）：起点中性色、终点方向色，终点画在上层
        const sq = 13;
        svg += `<rect x="${xa - sq / 2}" y="${y - sq / 2}" width="${sq}" height="${sq}" rx="4" fill="${rgbaStr(ctx.mut, 0.7)}"/>`;
        svg += `<rect x="${xb - sq / 2}" y="${y - sq / 2}" width="${sq}" height="${sq}" rx="4" fill="${c}"/>`;
        if (s.showValues) {
            const deltaText = `${delta >= 0 ? '+' : ''}${formatTickLabel(delta)}${s.unit}`;
            svg += `<text x="${padL + plotW + 12}" y="${y + 4}" font-size="11.5" font-weight="700" fill="${c}">${esc(deltaText)}</text>`;
        }
    });
    if (legendOn) {
        // 终点图例色跟随实际端点用色：全部行同方向就用该方向色（如"耗时缩短"类全下降图终点全是红，
        // 图例不能再画 accent 蓝）；升降混合时退回 accent（差值文字每行已各自带方向色）
        const uniqueEnds = Array.from(new Set(endColors));
        const endLegendColor = uniqueEnds.length === 1 ? uniqueEnds[0] : ctx.acc;
        svg += legendRowV2(
            [{ label: gnames[0], color: rgbaStr(ctx.mut, 0.7) }, { label: gnames[gnames.length - 1], color: endLegendColor }],
            padL, plotW, 14, s.legendFontSize, s.legendTextColor,
        );
    }
    return svg;
}

function renderRoseChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 半径 ∝ 数值，accent 单色透明度梯度（避免彩虹）；峰值花瓣满色 + 发光 + chip
    const ctx = v2ctx(s);
    const cx = w / 2;
    const cy = h / 2 + 6;
    const R = Math.max(24, Math.min(w, h) / 2 - 40);
    const maxVal = Math.max(...data.map((d) => d.value), 1);
    const n = data.length;
    if (n === 0) return '';
    const sw = 360 / n;
    const gap = 4;
    const maxIdx = data.reduce((mi, d, i) => (d.value > data[mi].value ? i : mi), 0);
    const fid = uid('rsf');
    let svg = `<defs>${glowF(fid, ctx.acc)}</defs>`;
    if (s.showGrid) {
        for (let k = 1; k <= 3; k++) {
            svg += `<circle cx="${cx}" cy="${cy}" r="${(R * k) / 3}" fill="none" stroke="${ctx.grid}" stroke-dasharray="1 6" stroke-linecap="round"/>`;
        }
    }
    data.forEach((it, i) => {
        const r = Math.max((Math.max(0, it.value) / maxVal) * R, 6);
        const a0 = i * sw + gap / 2;
        const a1 = (i + 1) * sw - gap / 2;
        const hot = i === maxIdx;
        svg += `<path d="${describeSector(cx, cy, r, a0, a1)}" fill="${hot ? rgbaStr(ctx.acc, 0.9) : rgbaStr(ctx.acc, 0.16 + (Math.max(0, it.value) / maxVal) * 0.4)}"${hot && ctx.dark ? ` filter="url(#${fid})"` : ''}/>`;
        const pl = polarToCartesian(cx, cy, R + 18, i * sw + sw / 2);
        svg += `<text x="${pl.x}" y="${pl.y + 4}" text-anchor="middle" font-size="10.5" fill="${hot ? ctx.ink : ctx.mut}" font-weight="${hot ? 700 : 400}">${esc(it.label)}</text>`;
        if (hot && s.showValues) {
            const cp = polarToCartesian(cx, cy, r + 26, i * sw + sw / 2);
            svg += valueChip(cp.x, cp.y + 10, formatValue(it.value, s.unit), ctx.acc);
        }
    });
    return svg;
}

function renderTreemapChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 递归对半切分布局（值降序）；只有最大块用 accent 上色，其余一律中性灰
    const ctx = v2ctx(s);
    const items = [...data].sort((a, b) => b.value - a.value).filter((d) => d.value > 0);
    if (items.length === 0) return '';
    const total = items.reduce((t, d) => t + d.value, 0) || 1;
    interface Cell { label: string; value: number; x: number; y: number; w: number; h: number }
    const out: Cell[] = [];
    const split = (arr: DataItem[], x: number, y: number, ww: number, hh: number) => {
        if (arr.length === 0) return;
        if (arr.length === 1) {
            out.push({ label: arr[0].label, value: arr[0].value, x, y, w: ww, h: hh });
            return;
        }
        const sum = arr.reduce((t, d) => t + d.value, 0);
        let acc = 0;
        let i = 0;
        do {
            acc += arr[i].value;
            i++;
        } while (i < arr.length - 1 && acc < sum / 2);
        const A = arr.slice(0, i);
        const B = arr.slice(i);
        const fr = acc / sum;
        if (ww >= hh) {
            split(A, x, y, ww * fr, hh);
            split(B, x + ww * fr, y, ww * (1 - fr), hh);
        } else {
            split(A, x, y, ww, hh * fr);
            split(B, x, y + hh * fr, ww, hh * (1 - fr));
        }
    };
    split(items, 10, 10, w - 20, h - 20);
    let svg = '';
    out.forEach((c, i) => {
        const hot = i === 0;
        const fill = hot ? rgbaStr(ctx.acc, 0.24) : ctx.neutral(0.05);
        const stroke = hot ? rgbaStr(ctx.acc, 0.85) : ctx.neutral(0.14);
        svg += `<rect x="${c.x + 3}" y="${c.y + 3}" width="${Math.max(2, c.w - 6)}" height="${Math.max(2, c.h - 6)}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${hot ? 1.6 : 1}"/>`;
        if (c.w > 78 && c.h > 52) {
            svg += `<text x="${c.x + 16}" y="${c.y + 26}" font-size="${hot ? 14 : 12}" fill="${hot ? ctx.ink : ctx.mut}" font-weight="${hot ? 700 : 500}">${esc(truncateToWidth(c.label, hot ? 14 : 12, c.w - 28))}</text>`;
            if (s.showValues) {
                svg += `<text x="${c.x + 16}" y="${c.y + 26 + (hot ? 24 : 19)}" font-size="${hot ? 17 : 13}" fill="${hot ? ctx.acc : ctx.ink}" opacity="${hot ? 1 : 0.7}" font-weight="700">${((c.value / total) * 100).toFixed(0)}%</text>`;
            }
        }
    });
    return svg;
}

function renderSunburstChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // group=父级（内环），label=子级（外环）；子级色 = 父级色透明度阶梯；中心合计大数字
    const ctx = v2ctx(s);
    const parents: string[] = [];
    for (const d of data) {
        const p = toString(d.group);
        if (p && !parents.includes(p)) parents.push(p);
    }
    if (parents.length === 0) return '';
    const pcolor: Record<string, string> = {};
    parents.forEach((p, i) => { pcolor[p] = s.palette[i % s.palette.length] || ctx.acc; });
    const psum = (p: string) => data.filter((d) => toString(d.group) === p).reduce((t, d) => t + Math.max(0, d.value), 0);
    const total = data.reduce((t, d) => t + Math.max(0, d.value), 0) || 1;
    const narrow = w < 380 || !s.showLegend;
    const cx = narrow ? w / 2 : w * 0.36;
    const cy = h / 2;
    const R = Math.max(20, Math.min((narrow ? w / 2 : cx) - 14, cy - 14));
    const r0 = R * 0.42;
    const r1 = R * 0.72;
    const r2i = r1 + 6;
    const r2o = R;
    const gid = uid('sbg');
    const fid = uid('sbf');
    let svg = `<defs>${numGrad(gid, ctx.acc, ctx.dark)}${glowF(fid, ctx.acc)}</defs>`;
    let a = 0;
    const GAP = 1.6;
    parents.forEach((p) => {
        const sw = (psum(p) / total) * 360;
        const c = pcolor[p];
        if (sw > GAP) svg += `<path d="${ringSegment(cx, cy, r1, r0, a + GAP / 2, a + sw - GAP / 2)}" fill="${c}" opacity="0.95"/>`;
        let ca = a;
        data.filter((d) => toString(d.group) === p).forEach((child, j) => {
            const csw = (Math.max(0, child.value) / total) * 360;
            if (csw > GAP) svg += `<path d="${ringSegment(cx, cy, r2o, r2i, ca + GAP / 2, ca + csw - GAP / 2)}" fill="${rgbaStr(c, Math.max(0.15, 0.55 - j * 0.12))}"/>`;
            ca += csw;
        });
        a += sw;
    });
    svg += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="${Math.max(16, Math.min(24, R * 0.24))}" font-weight="700" fill="url(#${gid})"${ctx.dark ? ` filter="url(#${fid})"` : ''}>${formatTickLabel(total)}</text>`;
    svg += `<text x="${cx}" y="${cy + 19}" text-anchor="middle" font-size="10.5" fill="${ctx.mut}">合计</text>`;
    if (!narrow) svg += legendColV2(parents.map((p) => ({ label: p, color: pcolor[p] })), w * 0.70, h, s.legendFontSize, s.legendTextColor);
    return svg;
}

function renderBumpChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // label=期数、group=实体、value=用于排名的分值（按期内降序换算名次，Y 轴 = 名次）
    const ctx = v2ctx(s);
    const periods: string[] = [];
    const entities: string[] = [];
    for (const d of data) {
        if (!periods.includes(d.label)) periods.push(d.label);
        const g = toString(d.group);
        if (g && !entities.includes(g)) entities.push(g);
    }
    if (periods.length < 2 || entities.length === 0) return '';
    const rank: Record<string, number> = {};
    periods.forEach((p) => {
        const rows = data.filter((d) => d.label === p).sort((a, b) => b.value - a.value);
        rows.forEach((r, i) => { rank[`${toString(r.group)}|${p}`] = i + 1; });
    });
    const lastPeriod = periods[periods.length - 1];
    const finalTop = entities.find((e) => rank[`${e}|${lastPeriod}`] === 1);
    const entFS = Math.max(10, s.yAxisFontSize);
    const maxEntW = entities.reduce((m, e) => Math.max(m, approxTextWidth(e, entFS)), 0);
    const padL = Math.max(70, Math.min(w * 0.3, maxEntW + 30));
    const padR = 64;
    const padT = 34;
    const padB = 16;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const rowH = plotH / entities.length;
    const fid = uid('bpf');
    let svg = `<defs>${glowF(fid, ctx.acc)}</defs>`;
    if (s.showXAxis) {
        periods.forEach((p, i) => {
            svg += `<text x="${padL + (plotW * i) / (periods.length - 1)}" y="${padT - 14}" text-anchor="middle" font-size="${Math.max(9.5, s.xAxisFontSize - 2)}" fill="${s.xAxisFontColor}">${esc(p)}</text>`;
        });
    }
    entities.forEach((e, idx) => {
        const focus = e === finalTop;
        const first = data.find((d) => toString(d.group) === e);
        const c = first?.color || s.palette[idx % s.palette.length] || ctx.acc;
        const pts: Array<[number, number]> = periods.map((p, i) => [
            padL + (plotW * i) / (periods.length - 1),
            padT + ((rank[`${e}|${p}`] || entities.length) - 1) * rowH + rowH / 2,
        ]);
        svg += `<path d="${smoothPath(pts)}" fill="none" stroke="${c}" stroke-width="${focus ? 3.2 : 2}" stroke-linecap="round" opacity="${focus ? 1 : 0.5}"${focus && ctx.dark ? ` filter="url(#${fid})"` : ''}/>`;
        pts.forEach((pt) => {
            svg += `<circle cx="${pt[0]}" cy="${pt[1]}" r="${focus ? 5 : 4}" fill="${ctx.canvas}" stroke="${c}" stroke-width="${focus ? 3 : 2.2}" opacity="${focus ? 1 : 0.65}"/>`;
        });
        svg += `<text x="${padL - 16}" y="${pts[0][1] + 4}" text-anchor="end" font-size="${entFS}" fill="${focus ? ctx.ink : ctx.mut}" font-weight="${focus ? 700 : 400}">${esc(truncateToWidth(e, entFS, padL - 20))}</text>`;
        const last = pts[pts.length - 1];
        svg += `<text x="${last[0] + 18}" y="${last[1] + 4}" font-size="12" font-weight="700" fill="${c}" opacity="${focus ? 1 : 0.7}">#${rank[`${e}|${lastPeriod}`] || '-'}</text>`;
    });
    return svg;
}

function renderStreamChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 中轴对称堆叠（wiggle），层边界平滑曲线；层填充为系列色上下透明度渐变
    const ctx = v2ctx(s);
    const xs: string[] = [];
    const snames: string[] = [];
    for (const d of data) {
        if (!xs.includes(d.label)) xs.push(d.label);
        const g = toString(d.group);
        if (g && !snames.includes(g)) snames.push(g);
    }
    if (xs.length < 2 || snames.length === 0) return '';
    const val = (g: string, x: string) => {
        const it = data.find((d) => toString(d.group) === g && d.label === x);
        return it ? Math.max(0, it.value) : 0;
    };
    const legendOn = s.showLegend && snames.length > 1;
    const padL = 20;
    const padR = 20;
    const padT = legendOn ? 34 : 18;
    const padB = s.showXAxis ? 34 : 14;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const totals = xs.map((x) => snames.reduce((t, g) => t + val(g, x), 0));
    const maxT = Math.max(...totals, 1);
    const cy = padT + plotH / 2;
    const scale = (plotH / maxT) * 0.92;
    let defs = '';
    let svg = '';
    const seriesColor = (g: string, k: number) => {
        const first = data.find((d) => toString(d.group) === g);
        return first?.color || s.palette[k % s.palette.length] || ctx.acc;
    };
    snames.forEach((g, k) => {
        const c = seriesColor(g, k);
        const tops: Array<[number, number]> = [];
        const bots: Array<[number, number]> = [];
        xs.forEach((x, i) => {
            const px = padL + (plotW * i) / (xs.length - 1);
            let cum = 0;
            for (let j = 0; j < k; j++) cum += val(snames[j], x);
            const base = cy - (totals[i] * scale) / 2;
            tops.push([px, base + cum * scale]);
            bots.push([px, base + (cum + val(g, x)) * scale]);
        });
        const gid = uid('st');
        defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.62"/><stop offset="1" stop-color="${c}" stop-opacity="0.34"/></linearGradient>`;
        const topPath = smoothPath(tops);
        const botR = [...bots].reverse();
        let botPath = `L ${botR[0][0]} ${botR[0][1]}`;
        for (let i = 0; i < botR.length - 1; i++) {
            const p0 = botR[Math.max(0, i - 1)];
            const p1 = botR[i];
            const p2 = botR[i + 1];
            const p3 = botR[Math.min(botR.length - 1, i + 2)];
            botPath += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
        }
        svg += `<path d="${topPath} ${botPath} Z" fill="url(#${gid})"/>`;
    });
    if (s.showXAxis) {
        xs.forEach((x, i) => {
            if (i % 2 !== 0) return;
            svg += `<text x="${padL + (plotW * i) / (xs.length - 1)}" y="${h - 10}" text-anchor="middle" font-size="${Math.max(9.5, s.xAxisFontSize - 2)}" fill="${s.xAxisFontColor}" opacity="0.8">${esc(x)}</text>`;
        });
    }
    if (legendOn) svg += legendRowV2(snames.map((g, k) => ({ label: g, color: seriesColor(g, k) })), padL, plotW, 14, s.legendFontSize, s.legendTextColor);
    return `<defs>${defs}</defs>` + svg;
}

/** 表格内容底线校验（renderChartSvg 门槛用，宽松版）：真实业务表格天然有空格/合并格与 0 值，
 *  不再要求满矩阵——缺失的单元格由 renderTableChart 画 "-" 占位，value=0 视为有效业务数据。
 *  仅当整表毫无实际内容（所有行既无 text/unit、value 也全为 0，且表级无 unit）时放弃渲染，
 *  拦住 AI 整表 value:0 的纯占位空表（后端 normalizeTableChartData 同款语义）。 */
function tableHasAnyContent(data: DataItem[], s: ChartStyle): boolean {
    if (s.unit !== '') return true;
    return data.some((d) => !!d.text || !!d.unit || d.value !== 0);
}

function renderTableChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 数据表格：label=行名、group=列名、value=数值或 text=纯文字；无 group 时退化为「名称 | 数值」两列。
    // 表头 accent 色（不画下方分隔线——首行高亮衬底紧贴表头，横线与衬底描边叠在一起很脏），
    // 首行数据整行高亮（accent wash 圆角衬底），行间点状发丝线（showGrid 控制）；
    // 表头与数据单元格默认居中，行名长文本左对齐、短序号居中。
    // 版式自适应：行高按可用高度平分撑满容器（上限 60），行高充裕时字号随之放大（上限 15），
    // 行高截断后的剩余空白上下均分——高容器里少行数的表不再全部堆在顶部、底部留一大块空白。
    const ctx = v2ctx(s);
    const rows: string[] = [];
    const cols: string[] = [];
    for (const d of data) {
        if (!rows.includes(d.label)) rows.push(d.label);
        const g = toString(d.group);
        if (g && !cols.includes(g)) cols.push(g);
    }
    if (rows.length === 0) return '';
    const single = cols.length === 0;
    const colNames = single ? ['数值'] : cols;
    const cellOf = (r: string, c: string): DataItem | undefined =>
        single ? data.find((d) => d.label === r) : data.find((d) => d.label === r && toString(d.group) === c);
    const padX = 14;
    const padT = 10;
    const padB = 10;
    const availH = h - padT - padB;
    // 单元格文本：text 字段优先；兼容旧数据把文字塞进行级 unit + value 写 0 的形态（显示文字、去掉无意义的 0 前缀）
    const cellText = (cell: DataItem): string => {
        if (cell.text) return cell.text;
        if (cell.value === 0 && cell.unit) return cell.unit;
        return formatValue(cell.value, cell.unit || s.unit);
    };
    // 单元格字号：编辑面板显式值（yAxis 通道）优先；否则从基础钳制值起步，行高充裕时按行高 34% 放大（上限 15），
    // 同时受最长单元格文本约束——放大后仍须放得下最宽的一格（留 8% 余量），避免字大了反而截字出省略号
    let fs = Math.max(10.5, Math.min(12.5, s.fontSize - 1));
    const totalW = w - padX * 2;
    // 行名列宽：按最长行名收缩，短序号（1/2/3）不再被 64px 地板撑出大片空白
    const fitLabelW = (font: number, avail: number): number => {
        const textW = rows.reduce((m, r) => Math.max(m, approxTextWidth(r, font)), 0);
        const shortIdx = rows.every((r) => /^\d{1,3}$/.test(r.trim()));
        const pad = shortIdx ? 14 : 20;
        const floor = shortIdx ? Math.max(22, textW + pad) : Math.max(36, Math.min(52, textW + pad));
        return Math.max(floor, Math.min(avail * 0.34, textW + pad));
    };
    // 行名列宽：编辑面板手动值（占表格总宽百分比）优先，否则按内容自适应
    const labelWOf = (font: number): number => {
        if (s.tableLabelWidth != null && s.tableLabelWidth > 0) {
            return Math.max(20, Math.min(totalW * 0.6, (s.tableLabelWidth / 100) * totalW));
        }
        return fitLabelW(font, totalW);
    };
    // 各数据列分宽：编辑面板手动列宽（百分比×表格总宽）优先占位，其余"自动列"按内容权重分剩余空间；
    // 全部手动时按百分比相对比例填满（不留缝/不溢出），手动列挤占过头时整体缩到给自动列留出下限
    const fitColWidths = (font: number, availForCols: number): number[] => {
        const nCol = colNames.length;
        if (nCol === 0) return [];
        const minCol = Math.max(36, font * 2.2);
        const manual = colNames.map((_, j) => {
            const pct = s.tableColWidths?.[j] ?? 0;
            return pct > 0 ? Math.max(24, (pct / 100) * totalW) : 0;
        });
        const autoIdx: number[] = [];
        manual.forEach((v, j) => { if (v <= 0) autoIdx.push(j); });
        if (autoIdx.length === 0) {
            const sumM = manual.reduce((a, b) => a + b, 0) || 1;
            return manual.map((m) => (m / sumM) * availForCols);
        }
        let manualSum = manual.reduce((a, b) => a + b, 0);
        if (manualSum > 0) {
            const minAuto = Math.max(24, font * 1.6);
            const maxManualSum = availForCols - minAuto * autoIdx.length;
            if (manualSum > maxManualSum) {
                const k = Math.max(0.1, maxManualSum) / manualSum;
                for (let j = 0; j < nCol; j++) if (manual[j] > 0) manual[j] *= k;
                manualSum = manual.reduce((a, b) => a + b, 0);
            }
        }
        const autoSpace = availForCols - manualSum;
        const weights = autoIdx.map((j) => {
            const c = colNames[j];
            const headW = approxTextWidth(c, font);
            let bodyW = 0;
            for (const r of rows) {
                const cell = cellOf(r, c);
                bodyW = Math.max(bodyW, approxTextWidth(cell ? cellText(cell) : '-', font));
            }
            // 权重地板避免零宽；短列（序号/容量）自然权重小
            return Math.max(headW, bodyW, font * 1.2);
        });
        const sum = weights.reduce((a, b) => a + b, 0) || 1;
        // 先按权重分，再把低于下限的列抬到下限，超出部分从宽列按比例扣
        let autoW = weights.map((wt) => (wt / sum) * autoSpace);
        let deficit = 0;
        const flexible: number[] = [];
        autoW = autoW.map((cw, i) => {
            if (cw < minCol) {
                deficit += minCol - cw;
                return minCol;
            }
            flexible.push(i);
            return cw;
        });
        if (deficit > 0 && flexible.length > 0) {
            const flexSum = flexible.reduce((a, i) => a + autoW[i], 0) || 1;
            for (const i of flexible) {
                const cut = deficit * (autoW[i] / flexSum);
                autoW[i] = Math.max(minCol, autoW[i] - cut);
            }
        }
        // 浮点误差：把自动列总和校正到 autoSpace（手动列宽保持用户设定不动）
        const total = autoW.reduce((a, b) => a + b, 0) || 1;
        if (Math.abs(total - autoSpace) > 0.5 && autoSpace > 0) {
            const scale = autoSpace / total;
            autoW = autoW.map((cw) => cw * scale);
        }
        const widths = manual.slice();
        autoIdx.forEach((j, k) => { widths[j] = autoW[k]; });
        return widths;
    };
    if (s.tableCellFontSize != null) {
        fs = Math.max(8, s.tableCellFontSize);
    } else {
        const roughRowH = (availH - (fs + 12)) / rows.length;
        if (roughRowH >= 26) {
            const roughLabelW = labelWOf(fs);
            const roughCols = fitColWidths(fs, w - padX * 2 - roughLabelW);
            const roughColW = Math.min(...roughCols, (w - padX * 2 - roughLabelW) / Math.max(1, colNames.length));
            const maxCellUnitW = data.reduce((m, d) => Math.max(m, approxTextWidth(cellText(d), 1)), 0.1);
            const fsFit = ((roughColW - 12) * 0.92) / maxCellUnitW;
            fs = Math.min(15, Math.max(fs, Math.min(roughRowH * 0.34, fsFit)));
        }
    }
    const headFs = s.tableHeadFontSize != null ? Math.max(8, s.tableHeadFontSize) : Math.max(9.5, fs - 1);
    const headColor = s.tableHeadFontColor || ctx.acc;
    const headH = Math.max(22, Math.max(fs, headFs) + 12);
    const rowH = Math.max(16, Math.min(60, (availH - headH) / rows.length));
    const contentH = headH + rowH * rows.length;
    const topY = padT + Math.max(0, (availH - contentH) / 2);
    const x0 = padX;
    const x1 = w - padX;
    const labelW = labelWOf(fs);
    const colWidths = fitColWidths(fs, x1 - x0 - labelW);
    // ─── 对齐解析：行对齐 > 列对齐 > 默认（数据格居中、行名短序号居中/长文本左对齐）
    type CellAlign = 'left' | 'center' | 'right';
    const normAlign = (v?: string): CellAlign | '' =>
        v === 'left' || v === 'center' || v === 'right' ? v : '';
    const rowAlignAt = (i: number) => normAlign(s.tableRowAligns?.[i]);
    const colAlignAt = (j: number) => normAlign(s.tableColAligns?.[j]);
    const dataAlign = (i: number, j: number): CellAlign => rowAlignAt(i) || colAlignAt(j) || 'center';
    // 取最窄列作字号收缩试探（保守：最窄列能放下则其它列更宽裕）；绘制用 colWidths[j]
    const colW = colWidths.length > 0 ? Math.min(...colWidths) : x1 - x0 - labelW;
    // ─── 长文本自适应（替代"截断加省略号"）：单元格放不下时先把字号缩小一点（最多缩到 78%、
    // 地板 8px），再按标点软换行折成多行塞进行高；编辑面板显式设置过字号时不缩、只折行。
    const cellPadW = 12;
    const linesFitAt = (f: number) => Math.max(1, Math.floor((rowH - 4) / (f * 1.25)));
    const allCellsFitAt = (f: number): boolean => {
        const fit = linesFitAt(f);
        if (rows.some((r) => wrapTextToWidth(r, f, labelW - cellPadW).length > fit)) return false;
        return colNames.every((c, j) => {
            const cw = colWidths[j] ?? colW;
            return !rows.some((r) => {
                const cell = cellOf(r, c);
                return wrapTextToWidth(cell ? cellText(cell) : '-', f, cw - cellPadW).length > fit;
            });
        });
    };
    let cellFs = fs;
    if (s.tableCellFontSize == null) {
        const fsFloor = Math.max(8, fs * 0.78);
        while (cellFs > fsFloor && !allCellsFitAt(cellFs)) cellFs = Math.max(fsFloor, cellFs - 0.5);
    }
    const cellLineH = cellFs * 1.25;
    const cellMaxLines = linesFitAt(cellFs);
    // 折行并钳制行数：行高实在装不下时（极矮行的兜底），末行合并剩余文本截断加省略号
    const cellLines = (text: string, maxW: number): string[] => {
        const lines = wrapTextToWidth(text, cellFs, maxW);
        if (lines.length <= cellMaxLines) return lines;
        const kept = lines.slice(0, cellMaxLines);
        kept[cellMaxLines - 1] = truncateToWidth(lines.slice(cellMaxLines - 1).join(''), cellFs, maxW);
        return kept;
    };
    // 多行单元格文本：行块整体垂直居中于行格，首行 <text> 定基线、后续行 <tspan dy> 下移；align 控制 text-anchor
    const multilineText = (lines: string[], x: number, rowCenterY: number, align: CellAlign, attrs: string): string => {
        const firstY = rowCenterY - ((lines.length - 1) / 2) * cellLineH + cellFs * 0.36;
        const anchor = align === 'center' ? ' text-anchor="middle"' : align === 'right' ? ' text-anchor="end"' : '';
        let t = `<text x="${x}" y="${firstY}"${anchor} font-size="${cellFs}" ${attrs}>`;
        lines.forEach((ln, k) => {
            t += k === 0 ? esc(ln) : `<tspan x="${x}" dy="${cellLineH}">${esc(ln)}</tspan>`;
        });
        return t + '</text>';
    };
    let svg = '';
    // 数据列左缘 x：按列宽累加；配合对齐算文本锚点 x
    const colLeftX = (j: number): number => {
        let x = x0 + labelW;
        for (let k = 0; k < j; k++) x += colWidths[k] ?? 0;
        return x;
    };
    const alignX = (left: number, width: number, align: CellAlign): number =>
        align === 'left' ? left + 6 : align === 'right' ? left + width - 6 : left + width / 2;
    // 表头：随所在列的对齐方式（默认居中），accent 色（表头与数据的分隔交给首行高亮衬底，不画横线）；
    // 表头只有一行位置，列名放不下时缩字号适配（地板 8），截断省略号仅作最终兜底
    colNames.forEach((c, j) => {
        const cw = colWidths[j] ?? colW;
        const headFsEff = s.tableHeadFontSize != null
            ? headFs
            : Math.min(headFs, Math.max(8, (cw - cellPadW) / Math.max(0.1, approxTextWidth(c, 1))));
        const align = colAlignAt(j) || 'center';
        const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
        svg += `<text x="${alignX(colLeftX(j), cw, align)}" y="${topY + headH - 8}" text-anchor="${anchor}" font-size="${headFsEff}" font-weight="600" fill="${headColor}" opacity="0.9">${esc(truncateToWidth(c, headFsEff, cw - 12))}</text>`;
    });
    rows.forEach((r, i) => {
        const y = topY + headH + rowH * i;
        const first = i === 0;
        if (first) {
            // 首行高亮：整行使用主色浅色圆角衬底。
            svg += `<rect x="${x0 - 6}" y="${y + 2.5}" width="${x1 - x0 + 12}" height="${rowH - 5}" rx="8" fill="${rgbaStr(ctx.acc, 0.08)}" stroke="${rgbaStr(ctx.acc, 0.3)}" stroke-width="1"/>`;
        } else if (s.showGrid) {
            svg += gridLine(x0, x1, y, ctx);
        }
        const cy = y + rowH / 2;
        const rowColor = s.tableCellFontColor || (first ? ctx.ink : ctx.mut);
        // 行名列：行对齐 > 行名列对齐 > 默认（短序号居中、长文本左对齐便于扫读）
        const labelIsShortIdx = /^\d{1,3}$/.test(r.trim());
        const labelAlign: CellAlign = rowAlignAt(i) || normAlign(s.tableLabelAlign) || (labelIsShortIdx ? 'center' : 'left');
        svg += multilineText(cellLines(r, labelW - cellPadW), alignX(x0, labelW, labelAlign), cy, labelAlign, `fill="${rowColor}" font-weight="${first ? 700 : 500}"`);
        colNames.forEach((c, j) => {
            const cell = cellOf(r, c);
            // 稀疏矩阵缺失的单元格画 "-" 占位（真实表格的空格/合并格），与后端补格语义一致
            const content = cell ? cellText(cell) : '-';
            const cw = colWidths[j] ?? colW;
            // 数据单元格：行对齐 > 列对齐 > 默认居中（长短文本统一），避免右对齐在宽列里左边空一大块
            const align = dataAlign(i, j);
            svg += multilineText(cellLines(content, cw - cellPadW), alignX(colLeftX(j), cw, align), cy, align, `fill="${rowColor}" opacity="${first ? 1 : 0.9}" font-weight="${first ? 700 : 500}"`);
        });
    });
    // 画布列宽拖拽的几何锚点（不可见元数据）：本地坐标系的 x0|行名列宽|表体顶 y|表体高|各数据列宽，
    // SvgInteractiveCanvas 解析后经组 CTM 换算为屏幕坐标，在列边界画拖拽手柄
    svg += `<g data-table-metrics="${x0.toFixed(1)}|${labelW.toFixed(1)}|${topY.toFixed(1)}|${contentH.toFixed(1)}|${colWidths.map((cw) => cw.toFixed(1)).join(',')}"/>`;
    return svg;
}

// ─── KPI 图时间单位换算表（统一折算为"天"） ───
// 前后值单位不同（如 "2个月 → 10天"）时按此表换算后再算变化幅度；换算不了的单位组合不显示徽标（避免拿原始数值硬算出错误百分比）。
const TIME_UNIT_DAYS: Record<string, number> = {
    '毫秒': 1 / 86400000, 'ms': 1 / 86400000,
    '秒': 1 / 86400, 's': 1 / 86400, 'sec': 1 / 86400,
    '分钟': 1 / 1440, '分': 1 / 1440, 'min': 1 / 1440,
    '小时': 1 / 24, '时': 1 / 24, 'h': 1 / 24, 'hr': 1 / 24,
    '天': 1, '日': 1, 'd': 1, 'day': 1, 'days': 1,
    '周': 7, '星期': 7, 'w': 7, 'week': 7, 'weeks': 7,
    '月': 30, '个月': 30, 'mo': 30, 'month': 30, 'months': 30,
    '年': 365, 'y': 365, 'yr': 365, 'year': 365, 'years': 365,
};

function timeUnitToDays(unit: string): number | null {
    const key = unit.trim().toLowerCase();
    if (!key) return null;
    return TIME_UNIT_DAYS[key] ?? null;
}

/**
 * 从一个指标的行组里取基准行/当前行：优先按显式 role 标注（内容策划阶段每行必填，行序无关），
 * 没有 role 的历史数据回退行序契约（首行=基准、末行=当前）。
 */
function pickKpiRows(items: DataItem[]): { before: DataItem | null; after: DataItem } {
    const baseline = items.find((d) => d.role === 'baseline');
    const current = items.find((d) => d.role === 'current');
    if (current) return { before: baseline ?? (items.length > 1 ? items.find((d) => d !== current) ?? null : null), after: current };
    if (baseline && items.length > 1) {
        const rest = items.filter((d) => d !== baseline);
        return { before: baseline, after: rest[rest.length - 1] };
    }
    return { before: items.length > 1 ? items[0] : null, after: items[items.length - 1] };
}

// KPI 渐变/微光定义的全局自增序号：每次注入都整组重建，旧 id 随旧组一起被替换，
// 单调递增即可保证同页多图、缩略图多页同屏时 id 不冲突。
let kpiRenderSeq = 0;

function formatKpiNumber(value: number): string {
    if (Number.isInteger(value)) return String(value);
    const s = value.toPrecision(10);
    return String(parseFloat(s));
}

/** kpi 单值大字报数据形态判定（与 renderKpiChart 内 posterMode 同语义）：每个 label 恰好一行、无成对基准/当前 */
function isKpiPosterData(data: DataItem[]): boolean {
    const counts: Record<string, number> = {};
    for (const d of data) counts[d.label] = (counts[d.label] ?? 0) + 1;
    const labels = Object.keys(counts);
    return labels.length > 0 && labels.every((lb) => counts[lb] === 1);
}

function renderKpiChart(w: number, h: number, data: DataItem[], s: ChartStyle): string {
    // 按 label 聚合指标（保持出现顺序）。两种版式：
    // ① 对比卡（至少一组有基准+当前）：大数字=当前值，底部基准小字 + ▲/▼ 变化幅度（现有样式）。
    // ② 大字报（全部指标都只有单值、无前后对比）：数字大 + 单位缩小贴右，标题放数字下方左对齐
    //    （如 16次 / 投标次数），避免「标题钉顶、单位与数字同号」的臃肿感。
    const labels: string[] = [];
    const grouped: Record<string, DataItem[]> = {};
    for (const item of data) {
        if (!grouped[item.label]) {
            labels.push(item.label);
            grouped[item.label] = [];
        }
        grouped[item.label].push(item);
    }
    const n = labels.length;
    if (n === 0) return '';
    const single = n === 1;
    // 任一指标有基准行 → 走对比卡；否则整卡按大字报处理（例：采用率/转化率/满意度三个单值）
    const posterMode = !labels.some((lb) => !!pickKpiRows(grouped[lb]).before);

    // 矮槽（如 540×90）上下 padding 与高度占比都收一收，让数字/单位/标题整体更大一点；
    // 高槽仍用宽松留白，避免大字顶满发闷。
    const compact = h < 140;
    const PAD = compact
        ? { top: 6, right: 8, bottom: 8, left: 8 }
        : { top: 14, right: 10, bottom: 16, left: 10 };
    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const colW = plotW / n;

    const labelFont = Math.max(10, s.xAxisFontSize);   // 指标名（xAxis 通道）
    const subFont = Math.max(9, s.valueFontSize);      // 变化幅度徽标（数值通道）
    const baseFont = Math.max(9, s.yAxisFontSize);     // 底部基准小字（yAxis 通道）

    // 大数字配色遵循设计风格：统一取调色板首色（后端从 design_tokens.accent 派生、
    // 属性面板编辑的也是这一位），不再按系列序号取第二色——KPI 的大数字就是页面的强调色。
    const numColor = isValidColor(s.palette[0]) ? s.palette[0] : '#2F80ED';
    // 与页面标题强调同一套语言：数字裁进同色系渐变（深色向白提亮、浅色向深加深），
    // 深色风格再垫一层薄薄的同色微光（对齐结构契约的 titleGrad/textGlow 档位）。
    const dark = isDarkChartContext(s);
    const gradEnd = dark ? mixColor(numColor, '#FFFFFF', 0.45) : mixColor(numColor, '#10131A', 0.3);
    const uidNum = ++kpiRenderSeq;
    const gradId = `kpiNumGrad-${uidNum}`;
    const glowId = `kpiNumGlow-${uidNum}`;
    let defs = `<linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0.25"><stop offset="0" stop-color="${numColor}"/><stop offset="1" stop-color="${gradEnd}"/></linearGradient>`;
    if (dark) {
        defs += `<filter id="${glowId}" x="-40%" y="-160%" width="180%" height="420%"><feGaussianBlur in="SourceAlpha" stdDeviation="6" result="blur"/><feFlood flood-color="${numColor}" flood-opacity="0.32" result="col"/><feComposite in="col" in2="blur" operator="in" result="halo"/><feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    }
    const glowAttr = dark ? ` filter="url(#${glowId})"` : '';

    // ─── 整卡统一大数字字号 ───
    // 字号若逐列按各自内容宽度适配，同一张卡会出现"84座 37px / 179组 28px / 10元/天 27px"
    // 各配一号的杂乱观感；先对所有列试算适配值，取最小者作为整卡统一字号（基线随之对齐）。
    const unitRatio = 0.42;
    let posterBigFont = 0;
    if (posterMode) {
        const hRatio = single ? (compact ? 0.52 : 0.46) : (compact ? 0.50 : 0.38);
        let fit = Infinity;
        for (const lb of labels) {
            const { after } = pickKpiRows(grouped[lb]);
            const ut = (after.unit || s.unit || '').trim();
            const unitExtra = ut ? approxTextWidth(ut, 1) * unitRatio + 0.2 : 0;
            const packUnitW = approxTextWidth(formatKpiNumber(after.value), 1) + unitExtra;
            fit = Math.min(fit, packUnitW > 0 ? (colW - 16) / packUnitW : 32);
        }
        posterBigFont = Math.min(plotH * hRatio, fit);
        posterBigFont = Math.max(16, Math.min(single ? 64 : (compact ? 48 : 44), posterBigFont));
    }
    let compareBigFont = 0;
    if (!posterMode && !single) {
        let fit = Infinity;
        for (const lb of labels) {
            const { after } = pickKpiRows(grouped[lb]);
            const ut = (after.unit || s.unit || '').trim();
            const btW = approxTextWidth(formatValue(after.value, ut), 1);
            fit = Math.min(fit, btW > 0 ? (colW - 16) / btW : 32);
        }
        compareBigFont = Math.min(plotH * 0.34, fit);
        compareBigFont = Math.max(14, Math.min(40, compareBigFont));
    }

    let svg = `<defs>${defs}</defs>`;
    for (let i = 0; i < n; i++) {
        const items = grouped[labels[i]];
        // 基准/当前值优先按行上的显式 role 标注取（行序无关，AI 把"优化后"写在前面也不会把旧值放成大数字）
        const { before, after } = pickKpiRows(items);
        const cx = PAD.left + colW * i + colW / 2;
        const unitText = (after.unit || s.unit || '').trim();
        const numText = formatKpiNumber(after.value);
        const bigText = formatValue(after.value, unitText);

        // 对比卡才画列间分隔线；大字报模式不需要分割线
        if (!posterMode && i > 0 && s.showGrid) {
            const dx = PAD.left + colW * i;
            svg += `<line x1="${dx}" y1="${PAD.top + plotH * 0.12}" x2="${dx}" y2="${PAD.top + plotH * 0.88}" stroke="${s.gridColor}" stroke-width="1"/>`;
        }

        // ─── 大字报版式：数字大 + 单位缩小贴右，标题在数字下方左对齐 ───
        if (posterMode) {
            // 字号整卡统一（posterBigFont 已按最宽列适配），单位约数字的 42%，标题更小、偏灰；
            // 逐列各自适配会导致"84座 37px / 179组 28px"大小不一、基线错位的杂乱观感。
            const bigFont = posterBigFont;
            const unitFont = Math.max(10, bigFont * unitRatio);
            const titleFont = Math.max(compact ? 11 : 10, Math.min(labelFont + 1, bigFont * (compact ? 0.32 : 0.28)));
            const numW = approxTextWidth(numText, bigFont);
            const unitW = unitText ? approxTextWidth(unitText, unitFont) : 0;
            // 单位间距收小并改为 tspan 相对排版：单位若按估算的 numW 绝对定位，
            // "."/"1" 等窄字符按 0.55em 高估的误差会随位数累积，长数字时单位被推得离数字很远。
            const numUnitGap = unitText ? Math.max(2, bigFont * 0.08) : 0;
            const packW = numW + numUnitGap + unitW;
            // 多列：内容块列内偏左；单列：数字+单位整行在槽内居中
            const colLeft = PAD.left + colW * i;
            const blockLeft = single
                ? colLeft + Math.max(0, (colW - packW) / 2)
                : colLeft + Math.max(8, (colW - packW) * 0.18);
            // 标题上方留间距；矮槽略收一点，把垂直空间让给数字
            const gap = Math.round(bigFont * (compact ? 0.26 : 0.36));
            const bigAsc = bigFont * 0.78;
            const titleAsc = titleFont * 0.8;
            const showTitle = s.showXAxis;
            const blockH = bigAsc + (showTitle ? gap + titleAsc : 0) + bigFont * 0.1;
            const bigY = (h - blockH) / 2 + bigAsc;
            // 单位放进同一 <text> 用 tspan dx 相对定位——间距由浏览器按真实字宽排出，
            // 不再依赖 approxTextWidth 估宽；dy 让单位基线略抬、视觉贴着数字脚部（更像「16次」）
            const unitTspan = unitText
                ? `<tspan dx="${numUnitGap}" dy="${-(bigFont - unitFont) * 0.12}" font-size="${unitFont}" font-weight="600" fill-opacity="0.88">${esc(unitText)}</tspan>`
                : '';
            svg += `<text x="${blockLeft}" y="${bigY}" font-size="${bigFont}" fill="url(#${gradId})" font-weight="700"${glowAttr}>${esc(numText)}${unitTspan}</text>`;
            if (showTitle) {
                const titleY = bigY + gap + titleAsc;
                // 单指标：小标题相对「数字+单位」那一行居中；多指标：与数字左对齐
                if (single) {
                    const title = truncateToWidth(labels[i], titleFont, colW - 16);
                    svg += `<text x="${blockLeft + packW / 2}" y="${titleY}" text-anchor="middle" font-size="${titleFont}" fill="${s.xAxisFontColor}" font-weight="500" opacity="0.78">${esc(title)}</text>`;
                } else {
                    const title = truncateToWidth(labels[i], titleFont, colW - (blockLeft - colLeft) - 8);
                    svg += `<text x="${blockLeft}" y="${titleY}" font-size="${titleFont}" fill="${s.xAxisFontColor}" font-weight="500" opacity="0.78">${esc(title)}</text>`;
                }
            }
            continue;
        }

        // ─── 对比卡版式（有前后值）：保留现有样式 ───
        // 变化幅度徽标文本：箭头方向承载正负号，颜色跟随当前值系列色。
        // 前后单位不同（如 2个月 → 10天）时先按时间单位换算表折算到同一量纲再算百分比；换算不了则不显示徽标。
        let badgeText = '';
        if (before && s.showValues) {
            const beforeUnit = (before.unit || s.unit || '').trim();
            const afterUnit = (after.unit || s.unit || '').trim();
            let beforeVal = before.value;
            let afterVal = after.value;
            let comparable = true;
            if (beforeUnit !== afterUnit) {
                const bf = timeUnitToDays(beforeUnit);
                const af = timeUnitToDays(afterUnit);
                if (bf != null && af != null) {
                    beforeVal = before.value * bf;
                    afterVal = after.value * af;
                } else {
                    comparable = false;
                }
            }
            if (comparable && beforeVal !== 0) {
                const pct = ((afterVal - beforeVal) / Math.abs(beforeVal)) * 100;
                const absPct = Math.abs(pct);
                const pctText = `${absPct >= 10 ? Math.round(absPct) : Math.round(absPct * 10) / 10}%`;
                badgeText = `${pct >= 0 ? '▲' : '▼'} ${pctText}`;
            }
        }
        // 基准值小字文本（showYAxis 控制显隐）：如 "应用前 45%"
        let baseText = '';
        if (before && s.showYAxis) {
            const beforeName = toString(before.group);
            baseText = `${beforeName ? `${beforeName} ` : ''}${formatValue(before.value, before.unit || s.unit)}`;
        }

        // 大数字：单指标按自身内容适配（高占比 0.44、上限 60）；多指标用整卡统一字号
        // （compareBigFont 已按最宽列适配），避免各列大数字一列一个字号。
        let bigFont: number;
        if (single) {
            const maxBigW = colW - 16;
            const bigTextUnitW = approxTextWidth(bigText, 1);
            bigFont = Math.min(plotH * 0.44, bigTextUnitW > 0 ? maxBigW / bigTextUnitW : 32);
            bigFont = Math.max(14, Math.min(60, bigFont));
        } else {
            bigFont = compareBigFont;
        }

        if (single) {
            // 单指标版式：指标名 / 大数字 / 信息行（徽标+基准值合并一行）按行高与间距累加成一个内容块，
            // 整体在槽内垂直居中——原版式指标名钉在槽顶、大数字按固定高占比放置，三行齐全时
            // 下方留白明显大于上方，视觉重心偏上。
            const hasInfo = !!(badgeText || baseText);
            const infoFont = Math.max(subFont, baseFont);
            const gap = Math.round(bigFont * 0.3);
            const labelAsc = labelFont * 0.8;
            const bigAsc = bigFont * 0.78;
            const infoAsc = infoFont * 0.8;
            // 末行基线以下的下伸量（数字/CJK 约 0.1em）也计入块高，否则纯大数字版式会略微偏下
            const descent = (hasInfo ? infoFont : bigFont) * 0.1;
            const blockH = (s.showXAxis ? labelAsc + gap : 0) + bigAsc + (hasInfo ? gap + infoAsc : 0) + descent;
            let baseline = (h - blockH) / 2;
            if (s.showXAxis) {
                baseline += labelAsc;
                svg += `<text x="${cx}" y="${baseline}" text-anchor="middle" font-size="${labelFont}" fill="${s.xAxisFontColor}" font-weight="500">${esc(truncateToWidth(labels[i], labelFont, colW - 12))}</text>`;
                baseline += gap;
            }
            baseline += bigAsc;
            const bigY = baseline;
            svg += `<text x="${cx}" y="${bigY}" text-anchor="middle" font-size="${bigFont}" fill="url(#${gradId})" font-weight="700"${glowAttr}>${esc(bigText)}</text>`;
            if (hasInfo) {
                const gapW = badgeText && baseText ? 14 : 0;
                const badgeW = badgeText ? approxTextWidth(badgeText, infoFont) : 0;
                const totalW = badgeW + gapW + (baseText ? approxTextWidth(baseText, infoFont) : 0);
                const sx = cx - totalW / 2;
                const infoY = bigY + gap + infoAsc;
                if (badgeText) {
                    svg += `<text x="${sx}" y="${infoY}" font-size="${infoFont}" fill="${numColor}" font-weight="600">${esc(badgeText)}</text>`;
                }
                if (baseText) {
                    svg += `<text x="${sx + badgeW + gapW}" y="${infoY}" font-size="${infoFont}" fill="${s.yAxisFontColor}" opacity="0.75">${esc(truncateToWidth(baseText, infoFont, colW - badgeW - gapW - 16))}</text>`;
                }
            }
        } else {
            // 指标名（顶部，showXAxis 控制显隐）
            if (s.showXAxis) {
                svg += `<text x="${cx}" y="${PAD.top + labelFont}" text-anchor="middle" font-size="${labelFont}" fill="${s.xAxisFontColor}" font-weight="500">${esc(truncateToWidth(labels[i], labelFont, colW - 12))}</text>`;
            }
            // 顶部指标名/下方信息隐藏时，大数字向空出的方向微调，保持视觉重心居中
            let bigRatio = (before && s.showYAxis) ? 0.52 : 0.6;
            if (!s.showXAxis) bigRatio -= 0.08;
            const bigY = PAD.top + plotH * bigRatio;
            svg += `<text x="${cx}" y="${bigY}" text-anchor="middle" font-size="${bigFont}" fill="url(#${gradId})" font-weight="700"${glowAttr}>${esc(bigText)}</text>`;
            const badgeY = bigY + subFont + 8;
            const baseY = PAD.top + plotH - 2;
            // 矮槽自适应：徽标行与基准行的基线间距不足一行字高（如高度 95 的扁槽，四行竖排必然叠字）时，
            // 徽标 + 基准小字并成一行整体居中放在大数字下方（与单指标版式同款），不再各占一行。
            const crowded = !!badgeText && !!baseText && baseY - badgeY < baseFont + 6;
            if (crowded) {
                const infoFont = Math.max(subFont, baseFont);
                const gapW = 10;
                const badgeW = approxTextWidth(badgeText, infoFont);
                const baseTrunc = truncateToWidth(baseText, infoFont, colW - badgeW - gapW - 16);
                const totalW = badgeW + gapW + approxTextWidth(baseTrunc, infoFont);
                const sx = cx - totalW / 2;
                const infoY = Math.min(bigY + infoFont + 10, baseY);
                svg += `<text x="${sx}" y="${infoY}" font-size="${infoFont}" fill="${numColor}" font-weight="600">${esc(badgeText)}</text>`;
                svg += `<text x="${sx + badgeW + gapW}" y="${infoY}" font-size="${infoFont}" fill="${s.yAxisFontColor}" opacity="0.75">${esc(baseTrunc)}</text>`;
            } else {
                // 多指标分栏（原版式）：徽标独立一行居中、基准值贴列底
                if (badgeText) {
                    svg += `<text x="${cx}" y="${badgeY}" text-anchor="middle" font-size="${subFont}" fill="${numColor}" font-weight="600">${esc(badgeText)}</text>`;
                }
                if (baseText) {
                    svg += `<text x="${cx}" y="${baseY}" text-anchor="middle" font-size="${baseFont}" fill="${s.yAxisFontColor}" opacity="0.75">${esc(truncateToWidth(baseText, baseFont, colW - 8))}</text>`;
                }
            }
        }
    }
    return svg;
}

// ─── 图表渲染派发 ───

const RENDERERS: Record<string, (w: number, h: number, data: DataItem[], s: ChartStyle) => string> = {
    'bar': renderBarChart,
    'line': renderLineChart,
    'pie': renderPieChart,
    'donut': renderDonutChart,
    'horizontal-bar': renderHorizontalBarChart,
    'kpi': renderTableChart,
    'stacked-bar': renderStackedBarChart,
    'histogram': renderHistogramChart,
    'heatmap': renderHeatmapChart,
    'radar': renderRadarChart,
    'quadrant': renderQuadrantChart,
    'sankey': renderSankeyChart,
    'gauge': renderGaugeChart,
    'dumbbell': renderDumbbellChart,
    'rose': renderRoseChart,
    'treemap': renderTreemapChart,
    'sunburst': renderSunburstChart,
    'bump': renderBumpChart,
    'stream': renderStreamChart,
    'table': renderTableChart,
};

function renderChartSvg(slot: SlideChartSlot, theme?: SlideChartTheme | null): string | null {
    const renderer = RENDERERS[slot.chart_type];
    if (!renderer) return null;
    const style = resolveStyle(slot, theme);
    const data = resolveData(slot, style, theme);
    if (data.length === 0) return null;
    if ((slot.chart_type === 'pie' || slot.chart_type === 'donut') && data.length < 2) return null;
    // 特殊 schema 图表的最低数据要求：缺关键字段/行数不足时放弃渲染（保留占位符，避免画出空图）
    if (slot.chart_type === 'sankey' && !data.some((d) => d.from && d.to)) return null;
    if (slot.chart_type === 'quadrant' && !data.some((d) => d.x != null && d.y != null)) return null;
    if (slot.chart_type === 'heatmap' && !data.some((d) => toString(d.group) !== '')) return null;
    if (slot.chart_type === 'radar' && new Set(data.map((d) => d.label)).size < 3) return null;
    // 哑铃图门槛：至少 2 个分类（≥4 行数据），单分类前后对比一根孤零零的哑铃很难看——放弃渲染，AI 应改用 kpi
    if (slot.chart_type === 'dumbbell' && (new Set(data.map((d) => d.label)).size < 2 || data.length < 4)) return null;
    if (slot.chart_type === 'table' && (data.length < 2 || !tableHasAnyContent(data, style))) return null;
    try {
        const chartContent = renderer(slot.width, slot.height, data, style);
        if (!chartContent) return null;
        // 深色语境下所有图表都不铺底色（对齐"大字报"槽位的处理）：派生的 surface_alt 常是
        // 半透明白，叠在暗卡上是一层发灰的奶白膜；初稿烤死的 #FFFFFF 更不能在深色页上铺白底——
        // 用 resolveDarkContext（优先信 theme 亮字信号）判定，让底下的深色卡片直接透出来。
        // 浅色语境才铺底。
        const darkCtx = resolveDarkContext(style, theme);
        // 「边框填充」一体：frameWidth 同时控制外边框与外填充。
        // 全部图表类型默认关（未显式写 frameWidth）——图表内容直接坐在模块卡上，浅色也不铺白底
        // （否则叠出卡片套卡片）；用户在面板打开后两者一起回来。
        // 深色语境仍始终 skip 填充（半透明白底叠暗卡发灰），只恢复描边框。
        const chromeOn = slot.style?.frameWidth != null && style.frameWidth > 0;
        const skipBg = style.backgroundColor.toLowerCase() === 'transparent' || darkCtx || !chromeOn;
        const bgRect = skipBg
            ? ''
            : `<rect x="0" y="0" width="${slot.width}" height="${slot.height}" rx="${style.frameRadius}" fill="${style.backgroundColor}" />`;
        const frameRect = chromeOn
            ? `<rect x="${style.frameWidth / 2}" y="${style.frameWidth / 2}" width="${Math.max(0, slot.width - style.frameWidth)}" height="${Math.max(0, slot.height - style.frameWidth)}" rx="${Math.max(0, style.frameRadius - style.frameWidth / 2)}" fill="none" stroke="${style.frameColor}" stroke-width="${style.frameWidth}" />`
            : '';
        return `${bgRect}${frameRect}${chartContent}`;
    } catch (e) {
        console.error(`[ChartSlot] render failed: ${slot.slot_id}`, e);
        return null;
    }
}

// ─── 主入口：将图表注入 SVG ───

/**
 * 将图表配置注入到 SVG 中，替换 <g data-chart-slot-id="chart-N"> 占位符。
 * 纯字符串 SVG 生成，无 React 依赖。
 */
export const applyChartSlotsToSvg = (svg: string, designData: SlideDesignData | null): string => {
    if (!svg || !designData?.chart_slots || designData.chart_slots.length === 0) return svg;
    if (typeof window === 'undefined') return svg;

    // Quick check: if no placeholder exists in the SVG string, skip DOM parsing entirely
    if (!svg.includes('data-chart-slot-id')) return svg;

    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return svg;

    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') return svg;

    let replaced = false;
    const chartTheme = designData.chart_theme ?? null;

    for (const slot of designData.chart_slots) {
        const placeholder = doc.querySelector(`[data-chart-slot-id="${slot.slot_id}"]`);
        if (!placeholder) continue;

        // 幂等性关键：区分「首次注入占位符」与「在已渲染图表上重注入」。
        // 已渲染组带 data-chart-rendered="1"，其内层 <rect> 已是图表自身的背景/边框，
        // 不能再当占位几何来读——否则 transform 会被反复叠加偏移、宽高逐次收缩，
        // 表现为刷新后图表漂移/丢失或图例重复。改为复用首次记录的原始几何。
        const isRendered = placeholder.getAttribute('data-chart-rendered') === '1';

        let renderW: number;
        let renderH: number;
        let mergedTransform: string;

        if (isRendered) {
            // 重注入（编辑数据 / 换风格主题 / 刷新加载）：用首次记录的基准几何，transform 保持不变
            const baseW = parseFloatSafe(placeholder.getAttribute('data-chart-base-w'), 0);
            const baseH = parseFloatSafe(placeholder.getAttribute('data-chart-base-h'), 0);
            renderW = baseW > 50 ? baseW : slot.width;
            renderH = baseH > 50 ? baseH : slot.height;
            mergedTransform = (placeholder.getAttribute('transform') || '').trim();
        } else {
            // 首次注入：从占位符内层 <rect> 读取 AI 的真实布局几何
            const placeholderRect = placeholder.querySelector('rect');
            const actualW = placeholderRect ? parseFloat(placeholderRect.getAttribute('width') || '0') : 0;
            const actualH = placeholderRect ? parseFloat(placeholderRect.getAttribute('height') || '0') : 0;
            const actualX = placeholderRect ? parseFloatSafe(placeholderRect.getAttribute('x'), 0) : 0;
            const actualY = placeholderRect ? parseFloatSafe(placeholderRect.getAttribute('y'), 0) : 0;
            renderW = actualW > 50 ? actualW : slot.width;
            renderH = actualH > 50 ? actualH : slot.height;
            // 把占位符内 rect 的 x/y 偏移并入已有 transform（AI 已在 SVG 树中定位好）
            mergedTransform = mergeTranslateTransform(placeholder.getAttribute('transform') || '', actualX, actualY);
        }

        const renderSlot = {
            ...slot,
            width: renderW,
            height: renderH,
        };

        const chartInner = renderChartSvg(renderSlot, chartTheme);
        if (!chartInner) continue;

        // 新组保留 data-chart-slot-id（选中/图层/属性面板依赖），并补充：
        //  - data-chart-rendered="1"：已渲染标志，驱动后续重注入走幂等分支
        //  - data-chart-base-w/-h：首次记录的基准几何，供重注入稳定复用
        const baseAttrs = ` data-chart-rendered="1" data-chart-base-w="${formatTransformNumber(renderW)}" data-chart-base-h="${formatTransformNumber(renderH)}"`;
        const wrapperSvg = `<svg xmlns="http://www.w3.org/2000/svg"><g data-chart-slot-id="${esc(slot.slot_id)}" data-chart-type="${esc(slot.chart_type)}"${baseAttrs}${mergedTransform ? ` transform="${esc(mergedTransform)}"` : ''}>${chartInner}</g></svg>`;

        const fragDoc = parser.parseFromString(wrapperSvg, 'image/svg+xml');
        if (fragDoc.querySelector('parsererror')) continue;

        const newGroup = fragDoc.documentElement.firstElementChild;
        if (!newGroup) continue;

        const imported = doc.importNode(newGroup, true);
        if (placeholder.parentNode) {
            placeholder.parentNode.replaceChild(imported, placeholder);
            replaced = true;
        }
    }

    if (!replaced) return svg;

    return new XMLSerializer().serializeToString(doc);
};
