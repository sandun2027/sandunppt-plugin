// Chart data and theme types used by the PPT plugin.
export const CHART_TYPE_VALUES = [
    'bar', 'line', 'pie', 'donut', 'horizontal-bar', 'kpi',
    'stacked-bar', 'histogram', 'heatmap', 'radar', 'quadrant', 'sankey',
    'gauge', 'dumbbell', 'rose', 'treemap', 'sunburst', 'bump', 'stream', 'table',
] as const;

export type SlideChartType = typeof CHART_TYPE_VALUES[number];

/** 图表数据行：quadrant 用 x/y/r，sankey 用 from/to，其余 label/value(/group/unit)；kpi 行带 role */
export interface SlideChartDataRow {
    label: string;
    value: number;
    color: string;
    group?: string;
    unit?: string;
    /** kpi 行的语义角色（内容策划阶段输出，行序无关）：baseline=基准值（底部小字）、current=当前值（大数字） */
    role?: 'baseline' | 'current';
    /** table 纯文字单元格内容：有值时渲染端优先显示文字（AI 把字符串写进 value 时解析层会自动挪到这里） */
    text?: string;
    x?: number;
    y?: number;
    r?: number;
    from?: string;
    to?: string;
}

export interface SlideChartSlot {
    slot_id: string;
    chart_type: SlideChartType;
    x: number;
    y: number;
    width: number;
    height: number;
    data: SlideChartDataRow[];
    style?: {
        fontSize?: number;
        fontColor?: string;
        backgroundColor?: string;
        showLegend?: boolean;
        showValues?: boolean;
        showXAxis?: boolean;
        showYAxis?: boolean;
        showGrid?: boolean;
        xAxisFontSize?: number;
        yAxisFontSize?: number;
        xAxisFontColor?: string;
        yAxisFontColor?: string;
        frameColor?: string;
        frameWidth?: number;
        frameRadius?: number;
        gridColor?: string;
        gridDasharray?: string;
        axisColor?: string;
        axisWidth?: number;
        valueColor?: string;
        valueFontSize?: number;
        legendTextColor?: string;
        legendFontSize?: number;
        palette?: string[];
        lineWidth?: number;
        areaOpacity?: number;
        barRadius?: number;
        /** bar：相邻柱体间距（px），缺省=按分类自动均分 */
        barGap?: number;
        donutInnerRatio?: number;
        unit?: string;
        /** gauge 上限值（默认 100） */
        max?: number;
        /** quadrant 横轴语义标注 */
        xAxisLabel?: string;
        /** quadrant 纵轴语义标注 */
        yAxisLabel?: string;
        /** table：行名列宽（占表格总宽的百分比），0/缺省=按内容自动 */
        tableLabelWidth?: number;
        /** table：各数据列宽（百分比，按列出现顺序），0=该列自动 */
        tableColWidths?: number[];
        /** table：行名列对齐（left/center/right，空=自动：短序号居中、长文本左对齐） */
        tableLabelAlign?: string;
        /** table：各数据列对齐（按列出现顺序，空=默认右对齐） */
        tableColAligns?: string[];
        /** table：各行对齐（按行出现顺序，优先级高于列对齐，空=跟随列） */
        tableRowAligns?: string[];
        /** horizontal-bar：行间距（px），缺省=行高平分槽高 */
        barRowGap?: number;
    };
}

export interface SlideChartTheme {
    palette?: string[];
    backgroundColor?: string;
    frameColor?: string;
    frameWidth?: number;
    frameRadius?: number;
    gridColor?: string;
    gridDasharray?: string;
    axisColor?: string;
    axisWidth?: number;
    xAxisFontSize?: number;
    yAxisFontSize?: number;
    xAxisFontColor?: string;
    yAxisFontColor?: string;
    labelColor?: string;
    labelFontSize?: number;
    valueColor?: string;
    valueFontSize?: number;
    legendTextColor?: string;
    legendFontSize?: number;
    lineWidth?: number;
    areaOpacity?: number;
    barRadius?: number;
    donutInnerRatio?: number;
}


export interface SlideDesignData { chart_slots?: SlideChartSlot[]; chart_theme?: SlideChartTheme; }
