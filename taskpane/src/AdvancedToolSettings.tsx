import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ArrowRight, Check, CircleAlert, CircleCheck, LoaderCircle, Paintbrush } from "lucide-react";
import { windowCommand } from "./WindowShell";
import "./tool-settings.css";
import { FontPicker } from "./FontPicker";
import { collagePresets } from "./collage-presets";

export const advancedPanelIds = ["unify-fonts", "super-brush", "collage", "version"];
const bridge = () => (globalThis as any).chrome?.webview?.hostObjects?.sandunOffice;
const groups: [string, [string, string][]][] = [
  ["位置与尺寸", [["left", "左侧位置"], ["top", "顶部位置"], ["width", "宽度"], ["height", "高度"], ["rotation", "旋转"], ["crop", "图片裁剪"]]],
  ["形状格式", [["round", "圆角"], ["adjustments", "控点"], ["soft", "柔化边缘"], ["fill", "填充"], ["line", "轮廓"], ["shadow", "阴影"], ["reflection", "映像"], ["glow", "发光"], ["threeD", "三维格式"], ["threeDRotation", "三维旋转"]]],
  ["文字格式", [["text", "文字属性"], ["text-fill", "填充"], ["text-line", "轮廓"], ["text-shadow", "阴影"], ["text-reflection", "映像"], ["text-glow", "发光"], ["text-threeD", "三维格式"], ["text-threeDRotation", "三维旋转"]]],
];
function CheckOption({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="advanced-check"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span>{label}</span></label>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return <label className="advanced-field"><span id={labelId}>{label}</span>{isValidElement(children) ? cloneElement(children as ReactElement<any>, { "aria-labelledby": labelId }) : children}</label>;
}

export function AdvancedToolSettings({ id }: { id: string }) {
  const [context, setContext] = useState<any>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(false);
  const [fonts, setFonts] = useState({ chineseEnabled: true, englishEnabled: true, chinese: "微软雅黑", english: "Arial", mode: "force" });
  const [properties, setProperties] = useState(["fill", "line", "text"]), [withinGroups, setWithinGroups] = useState(true);
  const [collage, setCollage] = useState({ width: 1200, columns: 2, margin: 24, gap: 12, background: "#FFFFFF", backgroundStyle: "solid", backgroundColors: "#FFFFFF", backgroundAngle: 145, texture: "none", cardRadius: 0, cardShadow: false, cover: false, back: false, pad: true, watermark: "none", text: "SANDUN", textColor: "#808080", outlineColor: "#FFFFFF", outlineWidth: 0, font: "Arial", fontSize: 32, transparency: 70, rotation: -30, density: 40, scope: "all", range: "", hidden: false });
  const [preview, setPreview] = useState<{ preview: string; width: number; height: number; slides: number } | null>(null);
  const [previewStale, setPreviewStale] = useState(false), [imageName, setImageName] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false), [previewError, setPreviewError] = useState("");
  const [previewScale, setPreviewScale] = useState(1);
  const formRef = useRef<HTMLFormElement>(null), previewFlight = useRef(false);
  async function refresh() { try { if (bridge()) setContext(JSON.parse(await bridge().GetToolState(id))); } catch { /* Office may be switching documents. */ } }
  useEffect(() => { void refresh(); const timer = id === "super-brush" || id === "unify-fonts" ? setInterval(() => void refresh(), 2000) : undefined; return () => clearInterval(timer); }, [id]);
  useEffect(() => {
    if (id !== "super-brush" || !bridge() || context.source || !context.count || busy) return;
    void execute("capture");
  }, [id, context.source, context.count]);
  function updateCollage(key: string, value: string | number | boolean) { setCollage(prev => ({ ...prev, [key]: value })); setPreviewStale(true); }
  useEffect(() => {
    if (id !== "collage" || busy || !bridge()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!formRef.current?.checkValidity()) { setPreviewError("请先补全有效的设置，预览会自动更新。"); return; }
      if (collage.watermark === "image" && !imageName) { setPreviewError("选择水印图片后自动预览。"); return; }
      while (previewFlight.current && !cancelled) await new Promise(resolve => setTimeout(resolve, 80));
      if (cancelled) return;
      previewFlight.current = true; setPreviewBusy(true); setPreviewError("");
      try {
        const result = JSON.parse(await bridge().ExecuteTool("collage", JSON.stringify({ ...collage, action: "preview" })));
        if (!cancelled) { setPreview(result); setPreviewStale(false); }
      } catch (cause) { if (!cancelled) setPreviewError(cause instanceof Error ? cause.message : String(cause)); }
      finally { previewFlight.current = false; if (!cancelled) setPreviewBusy(false); }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); setPreviewBusy(false); };
  }, [id, collage, imageName, busy]);
  async function execute(action = "apply") {
    if (busy) return;
    if (id === "version") { windowCommand("close"); return; }
    if (!bridge()) { setError(true); setMessage("请从 PowerPoint 或 WPS 的 SANDUN 插件打开此工具。"); return; }
    setBusy(true); setMessage(""); setError(false);
    try {
      const options = id === "unify-fonts" ? fonts : id === "super-brush" ? { action, properties, groups: withinGroups } : { ...collage, action: action === "apply" ? "save" : action };
      const result = await bridge().ExecuteTool(id, JSON.stringify(options));
      if (id === "collage" && action === "preview") { setPreview(JSON.parse(result)); setPreviewStale(false); }
      else if (id === "collage" && action === "image") { if (result) { setImageName(result); setPreviewStale(true); } }
      else setMessage(result);
      await refresh();
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const availableGroups = groups.map(([name, entries]) => [name, entries.filter(([key]) => !context.wps || !["shadow", "text-shadow"].includes(key))] as [string, [string, string][]]);
  const title = ({ "unify-fonts": "统一字体", "super-brush": "超级刷", collage: "PPT 拼图", version: "插件版本" } as Record<string, string>)[id];
  const description = ({ "unify-fonts": "分别指定中文与英文字体，让整套演示风格一致。", "super-brush": "读取一次样式，按需应用到多个对象。", collage: "把多页演示拼成一张图片，预览后直接保存。", version: "让每一次表达，都更从容。" } as Record<string, string>)[id];
  const numberField = (key: keyof typeof collage, label: string, min: number, max: number) => <Field label={label}><input type="number" min={min} max={max} value={collage[key] as number} onChange={e => updateCollage(key, e.target.value === "" ? "" : Number(e.target.value))} required /></Field>;
  let content: ReactNode;
  if (id === "unify-fonts") content = <>
    <div className="document-fonts"><span>本 PPT 使用 {context.documentFonts?.length ?? "…"} 种字体</span><p>{context.documentFonts?.join(" · ") || "正在读取文稿字体…"}</p></div>
    {([['chinese', '中文字体', 'chineseEnabled'], ['english', '英文字体', 'englishEnabled']] as const).map(([key, label, enabled]) => <div key={key} className="font-picker"><CheckOption label={label} checked={fonts[enabled]} onChange={value => setFonts({ ...fonts, [enabled]: value })} /><FontPicker label={`选择${label}`} disabled={!fonts[enabled]} value={fonts[key]} onChange={value => setFonts({ ...fonts, [key]: value })} installed={context.fonts || []} documentFonts={context.documentFonts || []} /></div>)}
    <div className="font-live-preview"><span style={{ fontFamily: fonts.chineseEnabled ? fonts.chinese : undefined }}>中文字体 · 山川与远方</span><span style={{ fontFamily: fonts.englishEnabled ? fonts.english : undefined }}>English Font, 0123456789</span></div>
    <fieldset className="tool-field"><legend>应用模式</legend><div className="tool-choices" role="radiogroup" aria-label="应用模式">{[["force", "强制模式", "只处理当前选中的页面，连同组合、表格与图表文字一起统一。"], ["theme", "主题模式", "更新母版的标题和正文主题字体，保留手动指定的文字。"], ["core", "核心模式", "另存新文稿，统一页面、母版、版式和图表内部字体。"]].map(([key, label, hint]) => <button key={key} type="button" role="radio" aria-checked={fonts.mode === key} className={fonts.mode === key ? "selected" : ""} onClick={() => setFonts({ ...fonts, mode: key })}>{label}<small>{hint}</small></button>)}</div></fieldset>
    <p className="tool-hint font-scope">{fonts.mode === "force" ? `当前将处理 ${context.slides || 0} 个选定页面。` : fonts.mode === "core" ? "完成后选择保存位置，原文稿不会被覆盖。" : "主题字体会应用到使用该主题的页面。"}</p>
  </>;
  else if (id === "super-brush") content = <>
    <div className="brush-source"><div><small>01 · 读取样式源</small><strong>{context.source || "在 PPT 中选择一个参考对象"}</strong></div><button type="button" className="advanced-secondary" disabled={busy} onClick={() => void execute("capture")}><Paintbrush size={15} />{context.source ? "重新读取" : "读取样式"}</button></div>
    <div className="brush-presets"><span>02 · 选择要刷的属性</span>{([['size', '大小刷', context.sourceHasText ? ['text'] : ['width', 'height', 'rotation', 'crop']], ['color', '颜色刷', ['fill', 'line', 'text-fill', 'text-line']], ['font', '字体刷', ['text']]] as [string, string, string[]][]).map(([key, label, props]) => <button key={key} type="button" aria-pressed={props.every(p => properties.includes(p))} onClick={async () => { setProperties(props); if (!context.source && context.count) await execute("capture"); }}>{label}</button>)}<button type="button" onClick={() => setProperties(context.wps ? ["fill", "line", "glow", "text", "text-fill"] : ["fill", "line", "shadow", "glow", "text", "text-fill"])}>常用样式</button><button type="button" onClick={() => setProperties(availableGroups.flatMap(g => g[1].map(p => p[0])))}>全选</button><button type="button" onClick={() => setProperties([])}>清空</button></div>
    <div className="brush-groups">{availableGroups.map(([name, entries]) => <fieldset key={name}><legend>{name}</legend>{entries.map(([key, label]) => <CheckOption key={key} label={label} checked={properties.includes(key)} onChange={value => setProperties(prev => value ? [...prev, key] : prev.filter(p => p !== key))} />)}</fieldset>)}</div>
    {!context.wps && <div className="brush-gradient"><span>转换渐变</span><button type="button" disabled={busy} onClick={() => void execute("shape-to-text")}>形状 → 文字</button><button type="button" disabled={busy} onClick={() => void execute("text-to-shape")}>文字 → 形状</button></div>}
    {context.wps && <p className="tool-hint">WPS 支持基础样式与图片填充；不支持阴影刷取和渐变转换。</p>}
    <CheckOption label="应用到组合内部对象" checked={withinGroups} onChange={setWithinGroups} />
  </>;
  else if (id === "collage") content = <div className="collage-layout"><div className="collage-options">
    <fieldset className="tool-field"><legend>背景样式</legend><div className="collage-presets">{collagePresets.map(preset => <button type="button" key={preset.id} aria-pressed={collage.backgroundStyle === preset.id} onClick={() => { setCollage(prev => ({ ...prev, backgroundStyle: preset.id, backgroundColors: preset.colors, backgroundAngle: preset.angle, texture: preset.texture })); setPreviewStale(true); }}><span style={{ background: preset.id === "solid" ? collage.background : `linear-gradient(${preset.angle}deg,${preset.colors})` }} /><small>{preset.name}</small></button>)}</div></fieldset>
    <div className="collage-checks">{([["cover", "独立封面"], ["back", "独立封底"], ["pad", "不足补白"]] as const).map(([key, label]) => <CheckOption key={key} label={label} checked={collage[key]} onChange={v => updateCollage(key, v)} />)}</div>
    <div className="advanced-grid">{numberField("width", "图片宽度（px）", 200, 12000)}{numberField("columns", "横向列数", 1, 12)}{numberField("margin", "外围边距（px）", 0, 1000)}{numberField("gap", "页面间距（px）", 0, 1000)}</div>
    {collage.backgroundStyle === "solid" && <Field label="背景颜色"><input type="color" value={collage.background} onChange={e => updateCollage("background", e.target.value)} /></Field>}
    <div className="advanced-grid">{numberField("cardRadius", "页面圆角（px）", 0, 64)}<div className="advanced-field"><span>页面效果</span><CheckOption label="轻柔阴影" checked={collage.cardShadow} onChange={v => updateCollage("cardShadow", v)} /></div></div>
    <Field label="幻灯片范围"><select value={collage.scope} onChange={e => updateCollage("scope", e.target.value)}><option value="all">全部幻灯片</option><option value="selected">当前选定幻灯片</option><option value="range">输入页码序列</option></select></Field>
    {collage.scope === "range" && <Field label="页码序列"><input placeholder="例如 1-4,6,8-10" value={collage.range} required onChange={e => updateCollage("range", e.target.value)} /></Field>}
    <CheckOption label="包含隐藏页面" checked={collage.hidden} onChange={v => updateCollage("hidden", v)} />
    <Field label="水印类型"><select value={collage.watermark} onChange={e => updateCollage("watermark", e.target.value)}><option value="none">无水印</option><option value="text">单个文字</option><option value="pattern">斜纹文字</option><option value="image">图片水印</option></select></Field>
    {collage.watermark !== "none" && <>
      {collage.watermark === "image" ? <button type="button" className="advanced-secondary" disabled={busy} onClick={() => void execute("image")}>{imageName || "选择水印图片"}</button> : <><Field label="水印文字"><input value={collage.text} required onChange={e => updateCollage("text", e.target.value)} /></Field><div className="advanced-grid"><Field label="文字颜色"><input type="color" value={collage.textColor} onChange={e => updateCollage("textColor", e.target.value)} /></Field><Field label="描边颜色"><input type="color" value={collage.outlineColor} onChange={e => updateCollage("outlineColor", e.target.value)} /></Field><Field label="水印字体"><input value={collage.font} onChange={e => updateCollage("font", e.target.value)} /></Field>{numberField("outlineWidth", "描边宽度（px）", 0, 20)}</div></>}
      <div className="advanced-grid">{numberField("fontSize", collage.watermark === "image" ? "图片大小（基准 px）" : "字号（px）", 6, 500)}{numberField("transparency", "透明度（%）", 0, 100)}{numberField("rotation", "旋转（°）", -180, 180)}{collage.watermark !== "text" && numberField("density", "水印密度（%）", 0, 100)}</div>
    </>}
  </div><div className="collage-preview"><div className="collage-preview-heading"><span>实时预览</span><small>{previewBusy ? <><LoaderCircle className="spin" size={13} />正在更新</> : previewStale ? "等待更新…" : "自动更新"}</small></div>{previewError && <p role="alert" className="preview-error">{previewError}</p>}{preview ? <><div className="collage-preview-image"><img src={preview.preview} alt="当前幻灯片拼图预览" style={{ transform: `scale(${previewScale})` }} /></div><div className="preview-zoom"><button type="button" onClick={() => setPreviewScale(Math.max(.5, previewScale - .1))}>−</button><input aria-label="预览缩放" type="range" min="0.5" max="2.5" step="0.1" value={previewScale} onChange={e => setPreviewScale(Number(e.target.value))} /><button type="button" onClick={() => setPreviewScale(Math.min(2.5, previewScale + .1))}>＋</button><span>{Math.round(previewScale * 100)}%</span><button type="button" onClick={() => setPreviewScale(1)}>重置</button></div><p>{preview.width} × {preview.height} px · {preview.slides} 页</p></> : <div className="collage-placeholder"><img src="/tools/collage.svg" width="42" height="42" alt="" /><span>正在读取实际幻灯片效果</span><small>修改背景、排列或水印后，预览自动更新。</small></div>}</div></div>;
  else content = <div className="version-card"><div className="version-brand">SANDUN<span>PPT 开源版</span></div><div className="version-number">v{context.version || "…"}</div><p>原生演示工具 · AI 图表与图示</p><span className="version-site">Apache-2.0</span></div>;
  const disabled = busy || (id === "unify-fonts" && ((!fonts.chineseEnabled && !fonts.englishEnabled) || (fonts.chineseEnabled && !fonts.chinese.trim()) || (fonts.englishEnabled && !fonts.english.trim()))) || (id === "super-brush" && (!context.source || properties.length === 0));
  return <form ref={formRef} className={`tool-settings advanced-settings settings-${id}`} onSubmit={e => { e.preventDefault(); if (!disabled) void execute(); }}>
    <div className="tool-settings-scroll"><header className="tool-settings-heading"><img src={`/tools/${id}.svg`} width="28" height="28" alt="" /><h1>{title}</h1><p>{description}</p></header><div className="tool-settings-fields">{content}</div></div>
    {message && <div className={`tool-feedback ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error ? <CircleAlert size={17} /> : <CircleCheck size={17} />}<span>{message}</span></div>}
    <footer className="tool-settings-footer"><span>{id === "version" ? "SANDUN" : id === "collage" || fonts.mode === "core" && id === "unify-fonts" ? "选择位置后保存" : id === "super-brush" ? `当前选中 ${context.count || 0} 个对象` : "Ctrl+Z 可撤销"}</span><button type="submit" disabled={disabled}>{busy ? <LoaderCircle className="spin" size={16} /> : id === "version" ? <Check size={16} /> : null}{id === "version" ? "完成" : id === "collage" ? "另存为图片" : id === "super-brush" ? "应用到选区" : fonts.mode === "core" ? "统一并另存为" : "应用字体"}{!busy && id !== "version" && <ArrowRight size={16} />}</button></footer>
  </form>;
}
