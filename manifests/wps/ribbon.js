// BEGIN GENERATED RIBBON ICONS
var SANDUN_RIBBON_ICONS = {
  "page-height": "icons/page-height-76f96d9b18ee7c86.svg",
  "guides": "icons/guides-cd3d45249c414391.svg",
  "master": "icons/master-e809e618e2700d1c.svg",
  "zoom": "icons/zoom-88da8505e1eff24b.svg",
  "layers": "icons/layers-c5ded7449d93dae6.svg",
  "select-between": "icons/select-between-3081b1e0a6f6bc04.svg",
  "select-inverse": "icons/select-inverse-a6059d96b16b5122.svg",
  "select-type": "icons/select-type-fe442f09bac823f1.svg",
  "select-font": "icons/select-font-c490ff1ce93183ff.svg",
  "select-width": "icons/select-width-abe22ccc1376c65c.svg",
  "select-height": "icons/select-height-1c9ee0a81f2a9dea.svg",
  "select-color": "icons/select-color-1d22c293583ce701.svg",
  "select-lines": "icons/select-lines-561f28ee9ea44218.svg",
  "select-text": "icons/select-text-876b489ce2b6bade.svg",
  "select-groups": "icons/select-groups-301d8a8cc55e3ca5.svg",
  "group-near": "icons/group-near-4eba25690354e984.svg",
  "group": "icons/group-301d8a8cc55e3ca5.svg",
  "ungroup-style": "icons/ungroup-style-fa38dd7fbe651b3a.svg",
  "ungroup-slide": "icons/ungroup-slide-e809e618e2700d1c.svg",
  "ungroup-selection": "icons/ungroup-selection-fa38dd7fbe651b3a.svg",
  "layer-up": "icons/layer-up-7df7b8baef9dfe19.svg",
  "layer-down": "icons/layer-down-7a6b58e65293acc8.svg",
  "duplicate": "icons/duplicate-be0abff42a66f44e.svg",
  "fill-slide": "icons/fill-slide-86fddaa526d46a87.svg",
  "crop-slide": "icons/crop-slide-62cf438bfbe01381.svg",
  "trim": "icons/trim-a7bfbc9c6b9c21cb.svg",
  "mask": "icons/mask-3e9584a39559c5b4.svg",
  "merge": "icons/merge-ec99da0204c50723.svg",
  "round-corners": "icons/round-corners-c5116d0e86f06261.svg",
  "export-images": "icons/export-images-33e0c2026530ccad.svg",
  "export-fonts": "icons/export-fonts-d388f7de20529318.svg",
  "outline": "icons/outline-4d511e985d37ee8a.svg",
  "export-video": "icons/export-video-9bd5b67331a8b664.svg",
  "unify-fonts": "icons/unify-fonts-8be8a456f6be4f6d.svg",
  "super-brush": "icons/super-brush-32972aa0f355a562.svg",
  "collage": "icons/collage-6c555ce0f2919d86.svg",
  "version": "icons/version-d8c3d2c04dd40d04.svg",
  "settings": "icons/settings-74100340877dd611.svg",
  "image": "icons/image-7619e3edd15b57f4.svg",
  "chart": "icons/chart-ef2253f059e2e601.svg",
  "diagram": "icons/diagram-0d156ca95ad89bb9.svg"
};
// END GENERATED RIBBON ICONS
const SANDUN_TASKPANE_ID = "E5868626-D647-54A2-B69A-5C546BA40288";
const SANDUN_TASKPANE_URL = "https://127.0.0.1:17667/?host=wps";

function SANDUNOnLoad(ribbonUI) {
  wps.ribbonUI = ribbonUI;
  return true;
}

function SANDUNNativeBridge() {
  const app = wps.WppApplication();
  let addin = app.COMAddIns.Item("SANDUN.OpenPresentationBootstrap");
  if (!addin) { app.COMAddIns.Update(); addin = app.COMAddIns.Item("SANDUN.OpenPresentationBootstrap"); }
  if (!addin) throw new Error("原生组件尚未注册到 WPS，请运行开始菜单中的 SANDUN 修复，然后重新打开 WPS。");
  if (!addin.Connect) addin.Connect = true;
  if (!addin.Object) throw new Error("WPS 未能加载 SANDUN 组件，请运行 SANDUN 修复后重启 WPS。");
  return addin.Object;
}

function SANDUNOpenTaskpane() {
  return SANDUNOpenTool("settings");
}

function SANDUNOpenTool(tool) {
  try {
    const native = SANDUNNativeBridge();
    if (native) { native.OpenTool(tool); return true; }
  } catch (_) { /* Some WPS versions hide methods on the JS COM wrapper. */ }
  SANDUNRelayTool(tool);
  return true;
}

const sandunToolRequests = new Map();
function SANDUNRelayTool(tool) {
  if (sandunToolRequests.has(tool)) return sandunToolRequests.get(tool);
  const request = (async function () {
    // A click can arrive before the periodic session refresh, or after the
    // local core restarts. Bootstrap before POST instead of using a stale token.
    const boot = await fetch("/local/bootstrap", { credentials: "include", cache: "no-store" });
    if (!boot.ok) throw new Error("本地服务尚未就绪，请稍后重试。");
    const token = (await boot.json()).csrfToken;
    if (!token) throw new Error("本地会话初始化失败，请重试。");
    const response = await fetch("/local/wps/tool?tool=" + encodeURIComponent(tool), {
      method: "POST", credentials: "include", body: "{}",
      headers: { "Content-Type": "application/json", "X-PPTagent-Client": "taskpane-v1", "X-PPTagent-CSRF": token }
    });
    if (!response.ok) {
      let detail;
      try { detail = (await response.json()).detail; } catch (_) { }
      throw new Error(typeof detail === "string" ? detail : "WPS 工具启动失败，请重试或运行 SANDUN 修复。");
    }
  })().catch(function (error) {
    alert(error && error.message ? error.message : "WPS 工具启动失败，请重试或运行 SANDUN 修复。");
  }).finally(function () { sandunToolRequests.delete(tool); });
  sandunToolRequests.set(tool, request);
  return request;
}
function SANDUNOpenImageTool() { return SANDUNOpenTool("image"); }
function SANDUNOpenCoverTool() { return SANDUNOpenTool("cover"); }
function SANDUNOpenChartTool() { return SANDUNOpenTool("chart"); }
function SANDUNOpenDiagramTool() { return SANDUNOpenTool("diagram"); }

function SANDUNGetConfigImage() { return SANDUNRibbonImage("settings"); }
function SANDUNOpenConfig() { return SANDUNOpenTool("settings"); }

function SANDUNRibbonImage(name) {
  // WPS resolves image callbacks relative to the add-in; absolute URLs fail.
  return SANDUN_RIBBON_ICONS[name] || SANDUN_RIBBON_ICONS.group;
}
function SANDUNGetImageImage() { return SANDUNRibbonImage("image"); }
function SANDUNGetChartImage() { return SANDUNRibbonImage("chart"); }
function SANDUNGetDiagramImage() { return SANDUNRibbonImage("diagram"); }
function SANDUNGetToolImage(control) {
  // WPS can ask for the split button or its menu instead of the main button.
  const id = control && (control.Id || control.id) || "";
  const tag = control && (control.Tag || control.tag);
  const name = tag || ({ "SANDUN.Group": "group", "SANDUN.GroupMenu": "group", "SANDUN.Filter": "layers" })[id] || id.replace(/^SANDUN\.Tool\./, "");
  return SANDUNRibbonImage(name);
}
function SANDUNRunNativeTool(control) {
  if (control.Tag === "export-fonts") return false;
  try {
    const native = SANDUNNativeBridge();
    if (native) {
      // WPS may report COM dispatch members as non-function values even though
      // they are invokable; call first and only fall back on an actual failure.
      try { native.ExecuteTool(control.Tag); return true; } catch (_) { }
    }
    SANDUNRelayTool(control.Tag);
  } catch (error) {
    alert(error && error.message ? error.message : "操作未完成，请检查当前选区。");
  }
  return true;
}
