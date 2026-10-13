import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tools = JSON.parse(fs.readFileSync(path.join(root, "tool-catalog.json"), "utf8"));
const assets = path.join(root, "taskpane/public/tools");
fs.mkdirSync(assets, { recursive: true });
const wpsIconsDir = path.join(root, "manifests/wps/icons");
fs.mkdirSync(wpsIconsDir, { recursive: true });
const wpsIcons = {};
const largeIcons = new Set(["settings", "image", "chart", "diagram", "layers", "zoom", "round-corners", "unify-fonts", "super-brush", "collage", "version", "website"]);
for (const tool of [...tools, ...Object.entries({ settings: "Settings", image: "Image", chart: "ChartColumn", diagram: "Workflow" }).map(([id, icon]) => ({ id, icon }))]) {
  if (!icons[tool.icon]) throw new Error(`Unknown icon: ${tool.icon}`);
  const svg = renderToStaticMarkup(React.createElement(icons[tool.icon], { width: 96, height: 96, color: "#334155", strokeWidth: 1.6 }));
  fs.writeFileSync(path.join(assets, `${tool.id}.svg`), svg + "\n");
  // Office uses the whole bitmap canvas: pad large icons to a 24px artwork slot.
  const ribbonSvg = largeIcons.has(tool.id) ? svg.replace('viewBox="0 0 24 24"', 'viewBox="-4 -4 32 32"') : svg;
  fs.writeFileSync(path.join(assets, `ribbon-${tool.id}.svg`), ribbonSvg + "\n");
  const wpsIcon = `${tool.id}-${createHash("sha256").update(ribbonSvg).digest("hex").slice(0, 16)}.svg`;
  fs.writeFileSync(path.join(wpsIconsDir, wpsIcon), ribbonSvg);
  wpsIcons[tool.id] = `icons/${wpsIcon}`;
  const top = { settings: "settings", image: "image", chart: "chart", diagram: "diagram" }[tool.id];
  if (top) fs.writeFileSync(path.join(root, `taskpane/public/icon-${top}.svg`), ribbonSvg + "\n");
}
// WPS loads config.entry directly, so keep its asset map in the same script.
const scriptPath = path.join(root, "manifests/wps/ribbon.js");
const script = fs.readFileSync(scriptPath, "utf8").replace(/\/\/ BEGIN GENERATED RIBBON ICONS\r?\n[\s\S]*?\/\/ END GENERATED RIBBON ICONS\r?\n/, "");
fs.writeFileSync(scriptPath, `// BEGIN GENERATED RIBBON ICONS\nvar SANDUN_RIBBON_ICONS = ${JSON.stringify(wpsIcons, null, 2)};\n// END GENERATED RIBBON ICONS\n${script}`);
const quote = s => JSON.stringify(s);
function ribbonGroups(wps = false) {
  const action = wps ? "SANDUNRunNativeTool" : "OnNativeToolClick";
  const image = wps ? "SANDUNGetToolImage" : "GetToolImage";
  const button = (id, label, extra = "") => { if (wps && ["outline", "export-fonts", "export-video", "ungroup-style", "round-corners", "layers"].includes(id)) return ""; const tool = tools.find(t => t.id === id); return `<button id='SANDUN.Tool.${id}' tag='${id}' label='${label || tool.label}' screentip='${tool.label}' getImage='${image}' onAction='${action}' ${extra}/>`; };
  const box = (id, content) => content ? `<box id='SANDUN.Box.${id}' boxStyle='vertical'>${content}</box>` : "";
  const filterIds = tools.filter(t => t.id.startsWith("select-")).map(t => t.id);
  const filter = wps ? `<menu id='SANDUN.Filter' tag='layers' label='筛选' size='large' getImage='${image}'>${filterIds.map(id => button(id)).join("")}</menu>` : `<splitButton id='SANDUN.Filter' size='large'>${button("layers", "筛选")}<menu id='SANDUN.FilterMenu'>${filterIds.map(id => button(id)).join("")}</menu></splitButton>`;
  const groupItems = ["group-near", "ungroup-style", "ungroup-slide", "ungroup-selection"].map(id => button(id)).join("");
  // WPS leaves split-button faces as question marks even when the image loads.
  const group = wps ? `<menu id='SANDUN.Group' tag='group' label='组合' getImage='${image}'>${button("group", "组合")}${groupItems}</menu>` : `<splitButton id='SANDUN.Group'>${button("group", "组合")}<menu id='SANDUN.GroupMenu'>${groupItems}</menu></splitButton>`;
  return `<group id='SANDUN.Tools.view' label='视图'>${button("zoom", null, "size='large'")}${box("view", ["page-height", "guides", "master"].map(id => button(id)).join(""))}</group>` +
    `<group id='SANDUN.Tools.object' label='对象'>${filter}${["round-corners", "unify-fonts", "super-brush"].map(id => button(id, null, "size='large'")).join("")}${box("group", group + button("layer-up") + button("layer-down"))}${box("geometry", ["duplicate", "fill-slide", "crop-slide"].map(id => button(id)).join(""))}${box("shape", button("trim") + button("mask") + button("merge", "布尔"))}</group>` +
    `<group id='SANDUN.Tools.export' label='导出'>${button("collage", null, "size='large'")}${box("export", button("export-images") + button("export-video", "选页视频"))}${box("fonts", ["export-fonts", "outline"].map(id => button(id)).join(""))}</group>` +
    `<group id='SANDUN.Tools.about' label='关于'>${["version"].map(id => button(id, null, "size='large'")).join("")}</group>`;
}
fs.writeFileSync(path.join(root, "native/ToolCatalog.cs"), `// Generated from tool-catalog.json by taskpane/scripts/generate-tools.mjs.
using System;
using System.Linq;
using System.Text;
namespace Sandun.PresentationBootstrap
{
    internal sealed class ToolDefinition
    {
        internal readonly string Id, Label, Category;
        internal readonly bool Panel;
        internal ToolDefinition(string id, string label, string category, bool panel) { Id = id; Label = label; Category = category; Panel = panel; }
    }
    internal static class ToolCatalog
    {
        internal static readonly ToolDefinition[] All = {
${tools.map(t => `            new ToolDefinition(${quote(t.id)}, ${quote(t.label)}, ${quote(t.category)}, ${t.panel}),`).join("\n")}
        };
        internal static ToolDefinition Find(string id) { var tool = All.FirstOrDefault(t => t.Id == id); if (tool == null) throw new ArgumentException("未知的 SANDUN 操作"); return tool; }
        internal static string Ribbon()
        {
            return ${quote(ribbonGroups())};
        }
    }
}
`);
console.log(`Generated ${tools.length} native commands and transparent line icons`);
const ribbonPath = path.join(root, "manifests/wps/ribbon.xml");
let ribbon = fs.readFileSync(ribbonPath, "utf8").replace(/\s*<!-- SANDUN native tools -->[\s\S]*?<!-- End SANDUN native tools -->/, "");
const groups = ribbonGroups(true);
ribbon = ribbon.replace("</tab>", `<!-- SANDUN native tools -->\n${groups}\n<!-- End SANDUN native tools -->\n      </tab>`);
fs.writeFileSync(ribbonPath, ribbon);
