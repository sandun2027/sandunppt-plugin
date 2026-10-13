import { useId, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export function FontPicker({ label, value, onChange, disabled, installed, documentFonts }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; installed: string[]; documentFonts: string[] }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, height: 280 });
  const match = (name: string) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  return <div className="font-combobox" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <button type="button" role="combobox" aria-label={label} aria-expanded={open && !disabled} aria-controls={id} disabled={disabled} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); const height = Math.min(280, Math.max(rect.top - 65, window.innerHeight - rect.bottom - 80)); setPosition({ left: rect.left, width: rect.width, top: window.innerHeight - rect.bottom - 80 >= height ? rect.bottom + 5 : rect.top - height - 5, height }); setQuery(""); setOpen(!open); }}><span>{value}</span><ChevronDown size={14} /></button>
    {open && !disabled && <div className="font-options" style={{ position: "fixed", left: position.left, top: position.top, width: position.width, boxSizing: "border-box" }}><input autoFocus aria-label="搜索字体" placeholder="搜索字体名称" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setOpen(false); }} /><div role="listbox" id={id} aria-label={label} style={{ maxHeight: position.height - 60 }}>
      {[["本 PPT 使用的字体", documentFonts], ["本机已安装字体", installed.filter(font => !documentFonts.includes(font))]].map(([title, entries]) => <div role="group" aria-label={title as string} key={title as string}><strong>{title as string}</strong>{(entries as string[]).filter(match).map(font => <button key={font} type="button" role="option" aria-selected={font === value} onClick={() => { onChange(font); setOpen(false); }}><span>{font}{!installed.includes(font) ? "（未安装）" : ""}</span>{font === value && <Check size={13} />}</button>)}</div>)}
      {![...documentFonts, ...installed].some(match) && <p>未找到匹配字体</p>}
    </div></div>}
  </div>;
}
