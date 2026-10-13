import { useRef, useState } from "react";
import { ImagePlus, SlidersHorizontal, X } from "lucide-react";
import { IMAGE_SIZES, readReferenceImages, type ImageRatio, type ImageSettings, type ReferenceImage } from "./image-options";
import "./image-options.css";

export function ImageOptionsPanel({ settings, onChange, references, onReferences, disabled, onReading }: {
  settings: ImageSettings; onChange: (value: ImageSettings) => void;
  references: ReferenceImage[]; onReferences: (value: ReferenceImage[]) => void;
  disabled: boolean; onReading: (value: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const reading = useRef(false);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const update = (patch: Partial<ImageSettings>) => onChange({ ...settings, ...patch });
  async function add(files: File[]) {
    if (disabled || reading.current || !files.length) return;
    reading.current = true; onReading(true); setUploadError("");
    try { onReferences(await readReferenceImages(files, references)); }
    catch (cause) { setUploadError(cause instanceof Error ? cause.message : "参考图读取失败"); }
    finally { reading.current = false; onReading(false); if (input.current) input.current.value = ""; }
  }
  return <div className="image-customization">
    <fieldset className="image-settings-card" disabled={disabled}>
      <legend><SlidersHorizontal size={15} />图片设置</legend>
      <div className="image-ratio-heading"><span>画面比例</span><small>{IMAGE_SIZES[settings.ratio][settings.resolution].replace("x", " × ")} px</small></div>
      <div className="image-ratio-options" role="group" aria-label="画面比例">
        {(Object.keys(IMAGE_SIZES) as ImageRatio[]).map(ratio => {
          const [width, height] = ratio.split(":").map(Number);
          return <button type="button" key={ratio} aria-pressed={settings.ratio === ratio} onClick={() => update({ ratio })}>
            <i style={{ width: width >= height ? 22 : 22 * width / height, height: height >= width ? 22 : 22 * height / width }} /><span>{ratio}</span>
          </button>;
        })}
      </div>
      <div className="image-settings-grid">
        <label><span>输出尺寸</span><select aria-label="输出尺寸" value={settings.resolution} onChange={e => update({ resolution: Number(e.target.value) as 0 | 1 })}>
          <option value={0}>标准 · 1K</option><option value={1}>高清 · 2K</option>
        </select></label>
        <label><span>画面质量</span><select aria-label="画面质量" value={settings.quality} onChange={e => update({ quality: e.target.value })}>
          <option value="auto">自动选择</option><option value="low">低 · 快速预览</option><option value="medium">中 · 日常使用</option>
          <option value="high">高 · 精细画面</option><option value="xhigh">超高 · 更多细节</option><option value="max">最高 · 完整细节</option>
        </select></label>
        <label><span>图片格式</span><select aria-label="图片格式" value={settings.format} onChange={e => {
          const format = e.target.value as "png" | "jpeg";
          if (format === "jpeg" && settings.background === "transparent") { update({ format, background: "opaque" }); setNotice("JPEG 不支持透明，背景已调整为不透明。"); }
          else { update({ format }); setNotice(""); }
        }}><option value="png">PNG · 清晰无损</option><option value="jpeg">JPEG · 文件更小</option></select></label>
        <label><span>背景处理</span><select aria-label="背景处理" value={settings.background} onChange={e => {
          const background = e.target.value as ImageSettings["background"];
          if (background === "transparent" && settings.format === "jpeg") { update({ background, format: "png" }); setNotice("透明背景已自动搭配 PNG 格式。"); }
          else { update({ background }); setNotice(""); }
        }}><option value="auto">自动选择</option><option value="opaque">不透明背景</option><option value="transparent">透明背景</option></select></label>
      </div>
      {settings.format === "jpeg" && <label className="image-compression"><span>压缩质量 <b>{settings.compression}%</b></span><input aria-label="压缩质量" type="range" min="0" max="100" value={settings.compression} onChange={e => update({ compression: Number(e.target.value) })} /><small>数值越高，保留的细节越多，文件也越大。</small></label>}
      {notice && <p className="image-settings-notice" role="status">{notice}</p>}
      <p className="image-settings-help">先用标准尺寸探索想法，再用高清输出。更高画质通常需要更多时间和额度。</p>
    </fieldset>
    <section className="image-reference-card" aria-label="参考图">
      <div className="image-reference-heading"><strong><ImagePlus size={16} />参考图 <small>可选</small></strong><span>{references.length} / 4</span></div>
      <p>提供主体、配色或构图参考，在描述中告诉 AI 如何使用。</p>
      <input ref={input} className="image-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="上传参考图" disabled={disabled} onChange={e => void add(Array.from(e.target.files || []))} />
      <div className="image-reference-list">
        {references.map((reference, index) => <div className="image-reference-item" key={reference.id}>
          <img src={reference.url} alt={"参考图 " + (index + 1)} /><span title={reference.name}>{reference.name}</span>
          <button type="button" aria-label={"移除参考图 " + (index + 1)} disabled={disabled} onClick={() => { onReferences(references.filter(item => item.id !== reference.id)); setUploadError(""); }}><X size={13} /></button>
        </div>)}
      </div>
      {references.length < 4 && <button type="button" className={"image-reference-drop" + (dragging ? " is-dragging" : "")} disabled={disabled}
        onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void add(Array.from(e.dataTransfer.files)); }}>
        <ImagePlus size={22} /><span>{disabled ? "请稍候…" : references.length ? "继续添加参考图" : "点击添加，或拖入图片"}</span>
      </button>}
      <small className="image-reference-limit">PNG / JPEG / WebP · 单张 ≤ 8 MB · 总计 ≤ 24 MB</small>
      {uploadError && <p className="image-upload-error" role="alert">{uploadError}</p>}
    </section>
  </div>;
}
