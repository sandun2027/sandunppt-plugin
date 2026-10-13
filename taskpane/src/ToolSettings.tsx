import { useEffect, useState, type ReactNode } from "react";
import { Check, CircleCheck, CircleAlert, LoaderCircle, ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight, Focus, ArrowRight } from "lucide-react";
import { windowCommand } from "./WindowShell";
import "./tool-settings.css";
import { AdvancedToolSettings, advancedPanelIds } from "./AdvancedToolSettings";

const definitions: Record<string, { title: string; description: string; action: string }> = {
  "round-corners": { title: "圆角", description: "柔化形状的拐角，保留原有文字与样式。", action: "应用圆角" },
  zoom: { title: "整体缩放", description: "调整选区大小，让文字与细节一起恰到好处。", action: "应用缩放" },
  mask: { title: "遮罩", description: "为选定对象或整页叠加一层颜色。", action: "添加遮罩" },
  merge: { title: "布尔运算", description: "组合形状，得到你需要的新轮廓。", action: "执行运算" },
  "export-images": { title: "导出图片", description: "将选区或幻灯片导出为清晰的 PNG 图片。", action: "导出图片" },
  "export-video": { title: "导出视频", description: "将选定幻灯片制作成 1080p MP4 视频。", action: "开始导出" },
  "video-progress": { title: "视频导出", description: "让精彩的演示，成为随时可以播放的视频。", action: "完成" },
  notice: { title: "操作结果", description: "", action: "知道了" },
};
export const panelIds = [...Object.keys(definitions), ...advancedPanelIds];
type Context = { wps?: boolean; count?: number; width?: number; height?: number; slides?: number; title?: string; message?: string; error?: boolean; busy?: boolean; path?: string };
const bridge = () => (globalThis as any).chrome?.webview?.hostObjects?.sandunOffice;
function Choices({ label, value, onChange, options }: { label: string; value: string | number; onChange: (value: any) => void; options: [string | number, string, string?][] }) {
  return <fieldset className="tool-field"><legend>{label}</legend><div className="tool-choices" role="radiogroup" aria-label={label}>{options.map(([key, text, detail]) => <button key={key} type="button" role="radio" aria-checked={key === value} className={key === value ? "selected" : ""} onClick={() => onChange(key)}><span>{text}</span>{detail && <small>{detail}</small>}</button>)}</div></fieldset>;
}
function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="tool-toggle"><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="tool-switch" aria-hidden="true" /></label>;
}
export function ToolSettings({ id }: { id: string }) {
  return advancedPanelIds.includes(id) ? <AdvancedToolSettings id={id} /> : <BasicToolSettings id={id} />;
}
function BasicToolSettings({ id }: { id: string }) {
  const definition = definitions[id];
  const [context, setContext] = useState<Context>({});
  const [radius, setRadius] = useState("8");
  const [percent, setPercent] = useState("100");
  const [anchor, setAnchor] = useState("center");
  const [flags, setFlags] = useState({ positions: true, fonts: true, lines: true, effects: true });
  const [transparency, setTransparency] = useState(20);
  const [color, setColor] = useState("#202124");
  const [operation, setOperation] = useState(1);
  const [dpi, setDpi] = useState(300);
  const [scope, setScope] = useState("slides");
  const [separate, setSeparate] = useState(false);
  const [seconds, setSeconds] = useState("5");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => { try { if (bridge()) { const state = JSON.parse(await bridge().GetToolState(id)); if (alive) setContext(state); } } catch { /* The panel remains usable while Office is changing its selection. */ } };
    void refresh(); const timer = setInterval(() => void refresh(), id === "video-progress" || id === "notice" ? 750 : 1800);
    return () => { alive = false; clearInterval(timer); };
  }, [id]);
  if (!definition) return <div className="tool-settings">未找到此工具</div>;
  const statusOnly = id === "notice" || id === "video-progress";
  const valid = id === "round-corners" ? radius.trim() !== "" && Number(radius) > 0 && Number(radius) <= 1000 : id === "zoom" ? percent.trim() !== "" && Number(percent) >= 1 && Number(percent) <= 10000 : id === "mask" ? /^#[\da-f]{6}$/i.test(color) : id === "export-video" ? seconds.trim() !== "" && Number.isInteger(Number(seconds)) && Number(seconds) >= 1 && Number(seconds) <= 300 : true;
  async function apply() {
    if (!valid || running) return;
    if (!bridge()) { setError(true); setMessage("请从 PowerPoint 或 WPS 的 SANDUN 插件打开此工具。"); return; }
    setRunning(true); setMessage(""); setError(false);
    const rgb = color.slice(1).match(/.{2}/g)?.map(v => parseInt(v, 16)) || [0, 0, 0];
    const options = id === "round-corners" ? { radius: Number(radius) } : id === "zoom" ? { percent: Number(percent), anchor, ...flags } : id === "mask" ? { transparency, color: rgb[0] + rgb[1] * 256 + rgb[2] * 65536 } : id === "merge" ? { operation } : id === "export-video" ? { seconds: Number(seconds) } : { dpi, scope, separate, all: scope === "all" };
    try { setMessage(await bridge().ExecuteTool(id, JSON.stringify(options))); }
    catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : "操作未完成，请检查当前选区后重试。"); }
    finally { setRunning(false); }
  }
  const selection = context.count ? `已选择 ${context.count} 个对象` : "可在幻灯片中选择对象";
  let settings: ReactNode;
  if (id === "zoom") settings = <>
    <div className="tool-selection"><span>{selection}</span>{context.width != null && context.count ? <span>{context.width.toFixed(2)} × {context.height?.toFixed(2)} cm</span> : null}</div>
    <label className="tool-field" htmlFor="tool-percent">缩放比例<div className="tool-number"><input id="tool-percent" type="number" min="1" max="10000" step="0.1" value={percent} onChange={e => setPercent(e.target.value)} /><span>%</span></div></label>
    <div className="tool-presets">{[50, 75, 100, 125, 150, 200].map(value => <button key={value} type="button" aria-pressed={Number(percent) === value} onClick={() => setPercent(String(value))}>{value}%</button>)}</div>
    <div className="tool-anchor"><div><strong>缩放基点</strong><p>{({ center: "围绕选区中心缩放", "top-left": "固定选区左上角", "top-right": "固定选区右上角", "bottom-left": "固定选区左下角", "bottom-right": "固定选区右下角" } as Record<string, string>)[anchor]}</p></div><div className="tool-anchor-grid" role="radiogroup" aria-label="缩放基点">{[["top-left", "左上角", ArrowUpLeft], ["top-right", "右上角", ArrowUpRight], ["center", "选区中心", Focus], ["bottom-left", "左下角", ArrowDownLeft], ["bottom-right", "右下角", ArrowDownRight]].map(([key, label, Glyph]: any) => <button key={key} type="button" role="radio" aria-label={label} title={label} aria-checked={anchor === key} className={`anchor-${key}`} onClick={() => setAnchor(key)}><Glyph size={16} strokeWidth={1.6} /></button>)}</div></div>
    <div className="tool-toggle-list">{([['positions', '同步缩放对象间距'], ['fonts', '同步缩放字体'], ['lines', '同步缩放线宽'], ['effects', '同步缩放阴影、发光、映像和柔化']] as const).map(([key, label]) => <Toggle key={key} label={label} checked={flags[key]} onChange={checked => setFlags({ ...flags, [key]: checked })} />)}</div>
  </>;
  else if (id === "round-corners") settings = <>
    <div className="tool-selection">{selection}</div>
    <div className="tool-rounding-preview"><svg viewBox="0 0 200 100" width="144" height="72" aria-label="圆角示意"><path d="M25 80V20H105L175 50L105 80Z" fill="none" stroke="#d2dfd1" strokeWidth="2" /><path d="M35 80Q25 80 25 70V30Q25 20 35 20H103Q106 20 110 22L167 46Q175 50 167 54L110 78Q106 80 103 80Z" fill="#e8eee6" stroke="#5f735e" strokeWidth="2" /></svg><small>矩形、箭头、多边形和自由曲线</small></div>
    <label className="tool-field" htmlFor="tool-radius">圆角半径<div className="tool-number"><input id="tool-radius" type="number" min="0.1" max="1000" step="0.1" value={radius} onChange={e => setRadius(e.target.value)} /><span>pt</span></div></label>
    <div className="tool-presets">{[2, 4, 8, 12, 20, 32].map(value => <button key={value} type="button" aria-pressed={Number(radius) === value} onClick={() => setRadius(String(value))}>{value} pt</button>)}</div>
    <p className="tool-hint">短边会自动限制圆角大小，避免相邻圆角重叠。光滑曲线保持原状，处理后可继续编辑顶点。</p>
  </>;
  else if (id === "mask") settings = <>
    <div className="tool-selection">{context.count ? selection : "未选对象时，遮罩覆盖整页"}</div>
    <div className="tool-mask-preview" style={{ backgroundImage: "linear-gradient(135deg,#e7edf4,#d2dfd1 45%,#b4c9c7)" }}><div style={{ backgroundColor: /^#[\da-f]{6}$/i.test(color) ? color : "#202124", opacity: 1 - transparency / 100 }} /><span>遮罩预览</span></div>
    <fieldset className="tool-field"><legend>遮罩颜色</legend><div className="tool-colors">{["#202124", "#FFFFFF", "#5F7392", "#A4B8A0", "#D3BA98"].map(value => <button key={value} type="button" aria-label={`颜色 ${value}`} aria-pressed={value.toLowerCase() === color.toLowerCase()} style={{ background: value, color: value === "#202124" ? "white" : "#334155" }} onClick={() => setColor(value)}>{value.toLowerCase() === color.toLowerCase() && <Check size={16} />}</button>)}<input aria-label="颜色值" value={color} maxLength={7} spellCheck={false} onChange={e => setColor(e.target.value)} /></div></fieldset>
    <label className="tool-field" htmlFor="tool-transparency"><span className="tool-field-line">透明度 <span>{transparency}%</span></span><input id="tool-transparency" type="range" min="0" max="100" value={transparency} onChange={e => setTransparency(Number(e.target.value))} /><span className="tool-range-labels"><small>不透明</small><small>完全透明</small></span></label>
  </>;
  else if (id === "merge") settings = <>
    <div className="tool-selection">{selection} · 至少选择两个形状</div>
    <Choices label="运算方式" value={operation} onChange={setOperation} options={[[1, "联合", "合为一个轮廓"], [2, "组合", "镂空重叠区域"], [5, "拆分", "切成独立部分"], [3, "相交", "保留重叠区域"], [4, "剪除", "从首个形状中减去"]]} />
    <p className="tool-hint">剪除运算以第一个选中的形状为基准。</p>
  </>;
  else if (id === "export-video") settings = <>
    <div className="tool-selection">选定幻灯片 {context.slides ? `· ${context.slides} 页` : ""}</div>
    <div className="tool-output-summary"><span>MP4 视频</span><strong>1080p <span>· 30 fps</span></strong><small>保留已有动画与页面计时</small></div>
    <label className="tool-field" htmlFor="tool-seconds">无计时页面停留<div className="tool-number"><input id="tool-seconds" type="number" min="1" max="300" step="1" value={seconds} onChange={e => setSeconds(e.target.value)} /><span>秒</span></div></label>
    <p className="tool-hint">已设置计时的页面使用原有时长。</p>
  </>;
  else if (statusOnly) settings = <div className="tool-result">{context.busy ? <LoaderCircle className="spin" size={34} strokeWidth={1.4} /> : context.error ? <CircleAlert size={34} strokeWidth={1.4} /> : <CircleCheck size={34} strokeWidth={1.4} />}<h2>{context.message || "正在读取操作结果…"}</h2>{context.path && <p>{context.path}</p>}{context.busy && <><div className="tool-progress" role="progressbar" aria-label="视频导出进度"><span /></div><small>关闭窗口后，导出仍会继续。</small></>}</div>;
  else settings = <>
    <Choices label="导出范围" value={scope} onChange={setScope} options={id === "export-images" && !context.wps ? [["shapes", "选定对象"], ["slides", "选定幻灯片"], ["all", "全部幻灯片"]] : [["slides", "选定幻灯片"], ["all", "全部幻灯片"]]} />
    <Choices label="图片清晰度" value={dpi} onChange={setDpi} options={[[144, "144 DPI", "适合屏幕"], [300, "300 DPI", "清晰细腻"], [600, "600 DPI", "适合印刷"]]} />
    {id === "export-images" && scope === "shapes" && <Toggle label="每个对象分别导出" detail="关闭后，将整个选区导出为一张图片" checked={separate} onChange={setSeparate} />}
    <p className="tool-hint">对象导出保留透明背景，幻灯片保留页面背景。</p>
  </>;
  return <form className={`tool-settings settings-${id}`} onSubmit={event => { event.preventDefault(); if (statusOnly) windowCommand("close"); else void apply(); }}>
    <div className="tool-settings-scroll"><header className="tool-settings-heading">{!statusOnly && <img src={`/tools/${id}.svg`} width="28" height="28" alt="" />}<h1>{context.title || definition.title}</h1>{definition.description && <p>{definition.description}</p>}</header><div className="tool-settings-fields">{settings}</div></div>
    {message && <div className={`tool-feedback ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error ? <CircleAlert size={17} /> : <CircleCheck size={17} />}<span>{message}</span></div>}
    <footer className="tool-settings-footer"><span>{statusOnly ? "SANDUN" : ["zoom", "mask", "merge", "round-corners"].includes(id) ? "Ctrl+Z 可撤销" : "选择位置后保存"}</span><button type="submit" disabled={running || !valid}>{running ? <LoaderCircle className="spin" size={17} /> : null}{statusOnly ? context.busy ? "关闭窗口" : "完成" : definition.action}{!running && !statusOnly && <ArrowRight size={16} />}</button></footer>
  </form>;
}
