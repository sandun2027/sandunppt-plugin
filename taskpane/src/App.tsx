import { useEffect, useState } from "react";
import { Settings, BarChart3, GitBranch, Image as ImageIcon, Sparkles, ArrowLeft, ArrowRight, Download, Check, RefreshCw, Palette, AlertTriangle, X } from "lucide-react";
import { api, bootstrap } from "./api";
import { captureSvgTarget, insertGeneratedSvg, insertGeneratedChart, insertGeneratedCover, generatedImageSvg, saveGeneratedImage } from "./host";
import { generatedSvg } from "./ai-svg";
import { AIActionButton, AIActivity, AICompletion } from "./AIExperience";
import { SettingsPage } from "./SettingsPage";
import type { PluginAIResponse } from "./types";
import { ImageOptionsPanel } from "./ImageOptionsPanel";
import { DEFAULT_IMAGE_SETTINGS, imageRequestOptions, supportsImageOptions, type ReferenceImage } from "./image-options";

const tabs = [{key:"settings", label:"配置", icon:Settings}, {key:"cover",label:"AI 封面",icon:Sparkles}, {key:"image",label:"AI 生图",icon:ImageIcon}, {key:"chart",label:"AI 图表",icon:BarChart3}, {key:"diagram",label:"AI 图示",icon:GitBranch}] as const;
type Tool = typeof tabs[number]["key"];
function validTool(value: string | null): Tool { return tabs.some(t=>t.key===value) ? value as Tool : "settings"; }
function App() {
 const [activeTool,setActiveTool]=useState<Tool>(validTool(new URLSearchParams(location.search).get("tool")));
 const [ready,setReady]=useState(false); const [error,setError]=useState("");
 useEffect(()=> { bootstrap().then(()=>setReady(true)).catch(e=>setError(messageOf(e))); },[]);
 useEffect(()=>{
  const navigate=(value:string)=>setActiveTool(validTool(value));
  (window as any).navigateFromRibbon=navigate;
  const bridge=(globalThis as any).chrome?.webview;
  const listener=(event:any)=>{if(event.data?.type==="sandun:navigate")navigate(event.data.tool)};
  bridge?.addEventListener("message",listener);
  return ()=>bridge?.removeEventListener("message",listener);
 },[]);
 useEffect(()=>{(globalThis as any).chrome?.webview?.postMessage({type:"sandun:route",tool:activeTool})},[activeTool]);
 return <main className="app-shell open-source-app"><header className="topbar">
 <nav className="tool-tabs" aria-label="创作工具">{tabs.map(t=><button key={t.key} className={activeTool===t.key?"active":""} aria-current={activeTool===t.key?"page":undefined} onClick={()=>setActiveTool(t.key)}><t.icon size={17}/><span>{t.label}</span></button>)}</nav></header>
 <div className="studio-content">{error?<Message kind="error">{error}</Message>:!ready?<p className="page">正在连接本地服务…</p>:activeTool==="settings"?<SettingsPage/>:activeTool==="cover"?<CoverWizard/>:<AITools key={activeTool} activeTool={activeTool} onToolChange={setActiveTool}/>}
 <footer className="app-footer"><span>SANDUN PPT 开源版</span><span>Apache-2.0 · 使用自己的 API</span></footer></div></main>;
}
function Icon({name}:{name:string}) { return name==="back" ? <ArrowLeft size={16}/> : <AlertTriangle size={16}/>; }
function Message({
  kind,
  children,
  action,
}: {
  kind: "error" | "warning" | "success";
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`message ${kind}`}
    >
      <Icon name={kind === "success" ? "check" : "alert"} />
      <span>{children}</span>
      {action && <button className="message-action" type="button" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

function AITools({
  activeTool,
  onToolChange,
}: {
  activeTool: "image" | "chart" | "diagram";
  onToolChange: (tool: "settings" | "image" | "chart" | "diagram") => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [chartType, setChartType] = useState("auto");
  const [diagramType, setDiagramType] = useState("auto");
  const [imageSettings, setImageSettings] = useState(DEFAULT_IMAGE_SETTINGS);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [readingImages, setReadingImages] = useState(false);
  const [imageModel, setImageModel] = useState("");
  const [imageConfigReady, setImageConfigReady] = useState(false);
  const [imageConfigError, setImageConfigError] = useState("");
  const imageControls = supportsImageOptions(imageModel);
  useEffect(() => {
    if (activeTool !== "image") return;
    let cancelled = false;
    api.config().then(config => {
      if (!cancelled) { setImageModel(config.image.model); setImageConfigReady(true); }
    }).catch(cause => {
      if (!cancelled) setImageConfigError(messageOf(cause));
    });
    return () => { cancelled = true; };
  }, [activeTool]);
  const [result, setResult] = useState<PluginAIResponse | null>(null);
  const [pendingSvg, setPendingSvg] = useState("");
  const [insertingImage, setInsertingImage] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [completedAction, setCompletedAction] = useState<"generate" | "insert" | "save" | null>(null);
  const [failedAction, setFailedAction] = useState<"generate" | "insert" | "save">("generate");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    if (!prompt.trim() || busy || insertingImage || savingImage || readingImages || (activeTool === "image" && !imageConfigReady)) return;
    setFailedAction("generate");
    setBusy(true);
    setCompletedAction(null);
    setError("");
    setResult(null);
    setStatus("");
    setPendingSvg("");
    try {
      const target = activeTool === "image" ? "" : await captureSvgTarget();
      if (activeTool === "image") {
        const response = await api.pluginGenerateImage(prompt, imageControls ? imageRequestOptions(imageSettings) : undefined, imageControls ? references.map(image => image.url) : []);
        if (!response.success || !response.url) throw new Error(response.error || "未返回可插入的图片，请重新生成。");
        setResult(response);
        setCompletedAction("generate");
      }
      else if (activeTool === "chart") {
        const response = await api.pluginGenerateChart(`${prompt}\n根据用户描述选择最合适的图表类型，只返回严格 JSON 数据模型，包含 chart_type 和 data；每个数据点单独一行，label、value、group、unit 等字段保持清晰，数值使用真实 number，保留原始单位和系列。不要返回 SVG、HTML、Markdown、KPI、大字报或把多项数据拼进文字。插件会把结果渲染为单一 SVG 图表。`, chartType);
        setResult(response);
        await place(response, target, "chart");
      } else {
        const response = await api.pluginGenerateDiagram(prompt, diagramType);
        setResult(response);
        await place(response, target, "diagram");
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      setPlacing(false);
    }
  }
  async function place(response: PluginAIResponse, target: string, kind: "chart" | "diagram") {
    const svg = generatedSvg(response, kind);
    setPendingSvg(svg);
    setPlacing(true);
    if (kind === "chart") await insertGeneratedChart(response.chart_data || "", svg, target, "svg"); else await insertGeneratedSvg(svg, target, kind);
    setPendingSvg("");
    setStatus("已放入幻灯片，可直接在页面上移动和缩放。");
    setCompletedAction("generate");
  }
  async function retryInsert() {
    if (!pendingSvg || activeTool === "image" || busy) return;
    setBusy(true); setPlacing(true); setError(""); setStatus(""); setCompletedAction(null);
    try {
      await insertGeneratedSvg(pendingSvg, await captureSvgTarget(), activeTool);
      setPendingSvg(""); setStatus("已放入当前幻灯片。");
      setCompletedAction("generate");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); setPlacing(false); }
  }
  async function insertImage() {
    if (!result?.url || busy || insertingImage || savingImage) return;
    setInsertingImage(true); setFailedAction("insert"); setError(""); setStatus("");
    setCompletedAction(null);
    try {
      const target = await captureSvgTarget();
      await insertGeneratedSvg(await generatedImageSvg(result.url), target, "image");
      setStatus("图片已插入当前页面，可在幻灯片中移动和缩放。");
      setCompletedAction("insert");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setInsertingImage(false); }
  }
  async function saveImage() {
    if (!result?.url || busy || insertingImage || savingImage) return;
    setSavingImage(true); setFailedAction("save"); setError(""); setStatus("");
    setCompletedAction(null);
    try {
      const path = await saveGeneratedImage(result.url, "SANDUN AI 图片");
      if (path) { setStatus(`图片已保存至：${path}`); setCompletedAction("save"); }
    } catch (cause) { setError(messageOf(cause)); }
    finally { setSavingImage(false); }
  }
  const working = busy || insertingImage || savingImage;
  const subject = activeTool === "image" ? "图片" : activeTool === "chart" ? "图表" : "图示";
  return (
    <section className="page ai-tools-page ai-studio">
      <button className="back-button" onClick={() => onToolChange("settings")}>
        <Icon name="back" /> API 配置
      </button>
      <div className="page-heading">
        <div>
          <h1>
            {activeTool === "image"
              ? "AI 生成图片"
              : activeTool === "chart"
                ? "AI 生成图表"
                : "AI 生成图示"}
          </h1>
        </div>
        <div className="ai-heading-meta">
          <span className={activeTool === "image" ? "image-model-label" : "count-label"}>{activeTool === "image" ? imageModel || "正在读取图片模型…" : "使用你配置的模型"}</span>
          
        </div>
      </div>
      <p className="lead">{activeTool === "image" ? "把想法写下来，让 AI 为你的演示添上精彩一笔。" : "生成后直接放入当前幻灯片，可在页面上移动和缩放。"}</p>
      {activeTool === "chart" && (
        <>
        <p className="chart-mode-note">输出为 SVG 图表，保留完整视觉样式。</p>
        <label className="form-field">
          <span>图表类型</span>
          <select
            value={chartType}
            disabled={working}
            onChange={(event) => setChartType(event.target.value)}
          >
            <option value="auto">让 AI 判断</option>
            {[
              ["bar", "柱状图"], ["line", "折线图"], ["pie", "饼图"],
              ["donut", "环形图"], ["horizontal-bar", "条形图"],
              ["stacked-bar", "堆积柱状图"], ["radar", "雷达图"],
              ["gauge", "仪表图"], ["table", "数据表"],
            ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label></>
      )}
      {activeTool === "diagram" && (
        <label className="form-field">
          <span>图示类型</span>
          <select
            value={diagramType}
            disabled={working}
            onChange={(event) => setDiagramType(event.target.value)}
          >
            <option value="auto">智能识别（AI 自动选择）</option>
            <optgroup label="简单图示">
            <option value="timeline">时间轴</option><option value="progression">流程递进</option>
            <option value="cycle">循环闭环</option><option value="containment">包含关系</option>
            <option value="comparison">对比关系</option><option value="intersection">交集关系</option>
            <option value="converge-diverge">汇聚 / 发散</option></optgroup>
            <optgroup label="复杂图示"><option value="flowchart">条件流程图</option>
            <option value="architecture">架构图</option>
            <option value="sequence">时序图</option>
            <option value="ecosystem">生态图谱</option>
            <option value="pyramid-funnel">金字塔 / 漏斗</option></optgroup>
          </select>
        </label>
      )}
      <label className="form-field">
        <span>
          {activeTool === "image"
            ? "图片描述"
            : activeTool === "chart"
              ? "数据或图表描述"
              : "图示描述"}
        </span>
        <textarea
          value={prompt}
          disabled={working}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={activeTool === "image" ? "例如：晨光中的极简建筑，柔和光影，适合科技主题演示" : activeTool === "chart" ? "例如：展示今年各季度销售额和同比增长" : "例如：从需求分析到产品发布，清晰呈现团队协作流程"}
          rows={5}
        />
      </label>
      {activeTool === "image" && imageConfigError && <Message kind="error" action={{ label: "检查配置", onClick: () => onToolChange("settings") }}>{imageConfigError}</Message>}
      {activeTool === "image" && imageControls && <ImageOptionsPanel settings={imageSettings} onChange={setImageSettings} references={references} onReferences={setReferences} disabled={working || readingImages} onReading={setReadingImages} />}
      <div className="ai-generate-actions">
        <small>{activeTool === "image" ? "生成后可插入幻灯片，或保存为图片。" : "生成后，直接呈现在你的幻灯片上。"}</small>
        <AIActionButton variant={result?.url ? "secondary" : "primary"} busy={busy} complete={completedAction === "generate"} loadingLabel={placing ? "正在插入…" : "正在生成…"} icon={<Sparkles size={16} />} disabled={working || readingImages || !prompt.trim() || (activeTool === "image" && !imageConfigReady)} onClick={() => void run()}>生成</AIActionButton>
      </div>
      {working && <AIActivity title={savingImage ? "正在保存图片" : insertingImage || placing ? `正在插入${subject}` : `正在生成${subject}`} detail={savingImage ? "在弹出的窗口中选择保存位置。" : insertingImage || placing ? "正在放入当前幻灯片，请稍候。" : activeTool === "image" ? "正在将你的想法绘制成画面。" : "正在根据你的描述组织内容与布局。"} />}
      {error && <Message kind="error" action={pendingSvg ? undefined : { label: failedAction === "save" ? "重试保存" : failedAction === "insert" ? "重试插入" : "重试", onClick: () => void (failedAction === "save" ? saveImage() : failedAction === "insert" ? insertImage() : run()) }}>{error}</Message>}
      {status && <AICompletion>{status}</AICompletion>}
      {pendingSvg && !busy && <div className="ai-generate-actions"><AIActionButton variant="secondary" disabled={working} icon={<ArrowRight size={16} />} onClick={() => void retryInsert()}>重试插入当前页面</AIActionButton></div>}
      {result?.url && (
        <div className="ai-result">
          <div className="ai-result-heading"><strong>图片已生成</strong><span><Check size={13} />准备就绪</span></div>
          <img src={result.url} alt="AI 生成结果" />
          {activeTool === "image" && <div className="ai-result-actions">
            <AIActionButton busy={insertingImage} complete={completedAction === "insert"} loadingLabel="正在插入…" disabled={working} icon={<ArrowRight size={16} />} onClick={() => void insertImage()}>插入当前页</AIActionButton>
            <AIActionButton variant="secondary" busy={savingImage} complete={completedAction === "save"} loadingLabel="正在保存…" disabled={working} icon={<Download size={16} />} onClick={() => void saveImage()}>保存为文件</AIActionButton>
          </div>}
        </div>
      )}
    </section>
  );
}

function CoverWizard() {
  type CoverPlan = { mainTitle: string; subtitle: string; primary: string; secondary: string; accent: string; titleColor: string; subtitleColor: string; mode: "light" | "dark"; description: string; styleName: string };
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState("");
  const [position, setPosition] = useState("left-middle");
  const [plans, setPlans] = useState<CoverPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(0);
  const styles = plans.map(p => p.description);
  const [style, setStyle] = useState("");
  const [draft, setDraft] = useState("");
  const [background, setBackground] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryKind, setRetryKind] = useState<"plan" | "draft" | "background" | "insert" | "save">("plan");
  const [phase, setPhase] = useState<"planning" | "draft" | "background" | "ready">("planning");
  const plan = plans[selectedPlan] || { mainTitle: "", subtitle: "", primary: "#0B1220", secondary: "#1E3A5F", accent: "#60A5FA", titleColor: "#FFFFFF", subtitleColor: "#CBD5E1", mode: "dark" as const, description: "", styleName: "" };
  const defaultStyle = "简洁高级、现代杂志感、清晰的标题层级与充足留白";
  const pluginDraftStyle = (visual: string) => `${visual}。这是 PPT 插件封面标题初稿：参考内容策划先润色主标题，再为标题建立清晰的信息层级；SVG 只输出可编辑文字图层，优先使用 <g id="title">，可用 <g id="subtitle"> 放置一行简短副标题（不要背景、图片、滤镜或外链）。主标题醒目、最多两行，副标题与主标题保持明显字号和间距差，整体留白充足，适合 16:9 PPT。`;
  const draftForPreview = draft && /^\s*<svg[\s>]/i.test(draft) ? draft : "";

  async function loadStyles() {
    setRetryKind("plan");
    setBusy(true); setError(""); setNotice(""); setBackground(""); setStep(2); setPhase("planning");
    setPlans([]);
    try {
      // Keep the same mental model as the web workflow: plan the visual
      // direction first, then turn that plan into an editable title draft.
      const planResponse = await api.pluginCoverPlan(title);
      const aiPlans = planResponse.plans || [];
      if (!aiPlans.length) throw new Error(planResponse.error || "封面策划结果为空");
      const mapped = aiPlans.map(p => ({ mainTitle: p.main_title, subtitle: p.subtitle, primary: p.primary_color, secondary: p.secondary_color, accent: p.accent_color, titleColor: p.title_color, subtitleColor: p.subtitle_color, mode: p.background_type, description: p.style_description, styleName: p.style_name }));
      setPlans(mapped); setSelectedPlan(0); setStyle(mapped[0].description);
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }

  async function confirmPlan() {
    setRetryKind("draft");
    setBusy(true); setError(""); setNotice(""); setStep(3); setPhase("draft");
    setDraft(""); setBackground("");
    try {
      const visual = `${plan.styleName}：${plan.description}；页面主色 ${plan.primary}；标题色 ${plan.titleColor}；副标题色 ${plan.subtitleColor}；主标题：${plan.mainTitle}；副标题：${plan.subtitle}`;
      const draftResponse = await api.pluginCoverDraft(`${plan.mainTitle}\n${plan.subtitle}`, position, pluginDraftStyle(`${visual}；标题必须严格使用用户选择的位置 ${position}`));
      const nextDraft = draftResponse.svg || "";
      if (!nextDraft) throw new Error("标题 SVG 生成结果为空，请重试");
      setDraft(nextDraft);
      setRetryKind("background");
      setPhase("background");
      const backgroundResponse = await api.pluginCoverBackground(plan.mainTitle, position, visual, nextDraft);
      if (!backgroundResponse.url) throw new Error("背景生成结果为空，请重试");
      setBackground(backgroundResponse.url);
      setPhase("ready");
    } catch (e) { setError(messageOf(e)); setPhase("ready"); }
    finally { setBusy(false); }
  }

  async function makeDraft(nextStyle = style) {
    if (!nextStyle) return;
    setRetryKind("draft");
    setBusy(true); setError(""); setNotice(""); setPhase("draft");
    try {
      const response = await api.pluginCoverDraft(`${plan.mainTitle}\n${plan.subtitle}`, position, pluginDraftStyle(`${nextStyle}；页面主色 ${plan.primary}；标题色 ${plan.titleColor}；副标题色 ${plan.subtitleColor}`));
      setDraft(response.svg || ""); setBackground(""); setPhase("ready");
    } catch (e) { setError(messageOf(e)); setPhase("ready"); }
    finally { setBusy(false); }
  }

  async function makeBackground() {
    if (!draft || !style) return;
    setRetryKind("background");
    setBusy(true); setError(""); setNotice(""); setPhase("background");
    try {
      const response = await api.pluginCoverBackground(plan.mainTitle || title, position, style, draft);
      if (!response.url) throw new Error("背景生成结果为空，请重试");
      setBackground(response.url); setPhase("ready");
    } catch (e) { setError(messageOf(e)); setPhase("ready"); }
    finally { setBusy(false); }
  }

  async function insert() {
    if (!background || !draft || busy) return;
    setRetryKind("insert");
    setBusy(true); setError(""); setNotice("");
    try {
      const target = await captureSvgTarget();
      await insertGeneratedCover(background, draft, target);
      setNotice("封面已插入当前页面，背景和标题为独立图层，可分别移动和缩放。");
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }

  async function saveBackground() {
    if (!background || busy) return;
    setRetryKind("save"); setBusy(true); setError(""); setNotice("");
    try {
      const path = await saveGeneratedImage(background, `${plan.mainTitle || title || "SANDUN"}-封面背景`);
      if (path) setNotice(`封面背景已保存至：${path}`);
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }

  const drawingTitle = busy && phase === "draft";
  const drawingBackground = busy && phase === "background";
  const activityTitle = retryKind === "save" ? "正在保存封面背景" : retryKind === "insert" ? "正在插入封面" : drawingTitle ? "正在生成标题" : "正在生成背景";
  const activityDetail = retryKind === "save" ? "在弹出的窗口中选择保存位置。" : retryKind === "insert" ? "正在将背景与标题放入当前幻灯片。" : drawingTitle ? "正在为你的主题设计文字层次。" : "正在绘制与标题相衬的背景。";
  return <section className="page cover-wizard ai-studio">
    <div className={`page-heading cover-page-heading${step === 3 ? " cover-page-heading-studio" : ""}`}>
      <div><h1>生成 AI 封面</h1></div>
      <span className="count-label">第 {step} / 3 步</span>
    </div>
    {step === 1 && <>
      <p className="lead">输入主题后，先生成封面文案与视觉风格方案。</p>
      <div className="cover-step-one">
        <div className="cover-topic-panel">
          <label className="form-field"><span>封面主题</span><textarea rows={8} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} placeholder="例如：AI 驱动的下一代办公方式" /></label>
          <p>标题与背景分层呈现，插入后可分别调整。</p>
        </div>
        <div className="cover-position-panel">
          <div className="cover-position-heading"><strong>标题放置位置</strong><small>选择你喜欢的留白</small></div>
          <div className="cover-position-grid">{[
            ["left-top", "左上"], ["center-top", "上方居中"], ["right-top", "右上"],
            ["left-middle", "左侧居中"], ["center", "正中"], ["right-middle", "右侧居中"],
            ["left-bottom", "左下"], ["center-bottom", "下方居中"], ["right-bottom", "右下"],
          ].map(([value, label]) => <button key={value} disabled={busy} aria-label={label} aria-pressed={position === value} onClick={() => setPosition(value)}><span>{value === position ? "标题" : ""}</span></button>)}</div>
        </div>
      </div>
      <AIActionButton className="cover-next" busy={busy} loadingLabel="正在策划…" disabled={!title.trim() || busy} icon={<ArrowRight size={16}/>} onClick={() => void loadStyles()}>开始策划封面</AIActionButton>
    </>}
    {step === 2 && <>
      <p className="lead">选一个与你的主题相衬的方向，再让封面成形。</p>
      {busy && <AIActivity title="正在策划封面" detail="正在构思文案、配色与视觉风格。" />}
      {plans.length === 0 && busy && <div className="cover-plan-loading" aria-hidden="true"><i/><i/></div>}
      {plans.length > 0 && <>
        <div className="cover-plan-options">{plans.map((candidate, index) =>
          <button key={index} className={`cover-plan-option${selectedPlan === index ? " selected" : ""}`} aria-pressed={selectedPlan === index} disabled={busy} onClick={() => { setSelectedPlan(index); setStyle(candidate.description); }}>
            <div className="cover-plan-option-head"><b>{String(index + 1).padStart(2, "0")}</b><strong>{candidate.styleName || "风格方案"}</strong><span>{candidate.mode === "dark" ? "深色 · 浅色字" : "浅色 · 深色字"}</span></div>
            <p>{candidate.description}</p>
            <div className="cover-plan-swatches"><i style={{background: candidate.primary}}/><i style={{background: candidate.secondary}}/><i style={{background: candidate.accent}}/><em style={{color: candidate.titleColor, background: candidate.primary}}>标题</em></div>
          </button>)}</div>
        <div className="cover-plan-card">
          <div className="cover-plan-copy"><span className="cover-card-kicker">YOUR CREATIVE DIRECTION</span><h2>{plan.mainTitle}</h2><p>{plan.subtitle}</p><small>{plan.description}</small></div>
          <div className="cover-color-grid">
            <span><i style={{background: plan.primary}}/>主色<code>{plan.primary}</code></span><span><i style={{background: plan.secondary}}/>辅助色<code>{plan.secondary}</code></span><span><i style={{background: plan.accent}}/>强调色<code>{plan.accent}</code></span><span><i style={{background: plan.titleColor}}/>标题文字<code>{plan.titleColor}</code></span><span><i style={{background: plan.subtitleColor}}/>副标题文字<code>{plan.subtitleColor}</code></span>
            <b className={`cover-mode-badge ${plan.mode}`}>{plan.mode === "dark" ? "深色背景 · 浅色文字" : "浅色背景 · 深色文字"}</b>
          </div>
        </div>
      </>}
      <div className="cover-actions">
        <AIActionButton variant="quiet" disabled={busy} icon={<ArrowLeft size={15}/>} onClick={() => setStep(1)}>返回修改主题</AIActionButton>
        <AIActionButton disabled={busy || !plans.length} icon={<Sparkles size={16}/>} onClick={() => void confirmPlan()}>确认方案并生成</AIActionButton>
      </div>
    </>}
    {step === 3 && <div className="cover-studio">
      <div className="cover-preview-card">
        <div className="cover-card-topline">
          <div><span className="cover-card-kicker">LIVE PREVIEW</span><strong>{background ? "封面合成预览" : "标题预览"}</strong></div>
          <span className={`cover-phase ${busy ? phase : "ready"}`}>{drawingTitle ? "设计标题中" : drawingBackground ? "绘制背景中" : background ? "准备就绪" : "等待背景"}</span>
        </div>
        <div className={`cover-composite-preview ${plan.mode === "dark" ? "plan-dark" : "plan-light"}${background ? " has-background" : ""}`} data-processing={drawingTitle || drawingBackground}>
          {background && <img src={background} alt="AI 生成的无文字背景"/>}
          <div className={`cover-draft-overlay${drawingTitle && !draftForPreview ? " is-loading" : ""}`}>
            {draftForPreview ? <div dangerouslySetInnerHTML={{__html: draftForPreview}}/> : <div className="cover-draft-skeleton"><i/><i/><i/><span>{drawingTitle ? "正在生成标题…" : "等待标题生成"}</span></div>}
          </div>
        </div>
        <p className="cover-preview-note"><span className="cover-dot background"/>背景图层 <span className="cover-dot title"/>标题图层</p>
      </div>
      <div className="cover-generation-controls">
        <div className="cover-progress-list">
          <span className={drawingTitle ? "active" : draft ? "done" : "pending"}><b>{draft && !drawingTitle ? <Check size={12}/> : "01"}</b>标题设计<small>文本模型</small></span>
          <span className={drawingBackground ? "active" : background ? "done" : "pending"}><b>{background && !drawingBackground ? <Check size={12}/> : "02"}</b>背景图片<small>图片模型</small></span>
        </div>
        {busy && <AIActivity title={activityTitle} detail={activityDetail}/>}
        <div className="cover-actions cover-studio-actions">
          <AIActionButton variant="quiet" disabled={busy} icon={<Palette size={15}/>} onClick={() => setStep(2)}>更换风格</AIActionButton>
          <AIActionButton variant="quiet" busy={drawingTitle} loadingLabel="正在设计…" disabled={busy} icon={<RefreshCw size={15}/>} onClick={() => void makeDraft()}>刷新标题</AIActionButton>
          <AIActionButton variant={background ? "secondary" : "primary"} className="cover-background-button" busy={drawingBackground} loadingLabel="正在生成背景…" disabled={busy || !draft} icon={background ? <RefreshCw size={15}/> : <Sparkles size={16}/>} onClick={() => void makeBackground()}>{background ? "重新生成背景" : "生成背景"}</AIActionButton>
        </div>
        {background && <>
          <div className="cover-delivery-actions">
            <AIActionButton busy={busy && retryKind === "insert"} complete={!!notice && retryKind === "insert"} loadingLabel="正在插入…" disabled={busy} icon={<ArrowRight size={16}/>} onClick={() => void insert()}>插入当前页面</AIActionButton>
            <AIActionButton variant="secondary" busy={busy && retryKind === "save"} complete={!!notice && retryKind === "save"} loadingLabel="正在保存…" disabled={busy} icon={<Download size={16}/>} onClick={() => void saveBackground()}>保存为文件</AIActionButton>
          </div>
          <p className="cover-save-note">保存不带标题的封面背景原图。</p>
        </>}
      </div>
    </div>}
    {error && <Message kind="error" action={{label: retryKind === "save" ? "重试保存" : retryKind === "insert" ? "重试插入" : "重试", onClick: () => void (retryKind === "save" ? saveBackground() : retryKind === "insert" ? insert() : retryKind === "plan" ? loadStyles() : retryKind === "draft" ? makeDraft() : makeBackground())}}>{error}</Message>}
    {notice && <AICompletion>{notice}</AICompletion>}
  </section>;
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "发生未知错误";
}

function escapeXml(value: string) {
  return value.replace(/[&<>'\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] || character);
}

export default App;
