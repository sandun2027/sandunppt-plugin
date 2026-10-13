
export type HostKind = "office" | "wps" | "browser";

type NativeOfficeBridge = {
  CaptureSvgTarget: () => Promise<string> | string;
  InsertSvg: (svg: string, target: string, kind: string) => Promise<string> | string;
  InsertCover: (backgroundSvg: string, titleSvg: string, target: string) => Promise<string> | string;
  SaveGeneratedImage: (dataUrl: string, name: string) => Promise<string> | string;
  CanInsertNativeChart?: (chartData: string) => Promise<boolean> | boolean;
  InsertNativeChart?: (chartData: string, target: string) => Promise<string> | string;
};

export async function captureSvgTarget(): Promise<string> {
  const bridge = getNativeOfficeBridge();
  if (!bridge) throw new Error("请从 PowerPoint 或 WPS 的 SANDUN 插件打开此工具。");
  return await bridge.CaptureSvgTarget();
}

export async function insertGeneratedSvg(svg: string, target: string, kind: "chart" | "diagram" | "cover" | "image"): Promise<string> {
  const bridge = getNativeOfficeBridge();
  if (!bridge) throw new Error("请从 PowerPoint 或 WPS 的 SANDUN 插件打开此工具。");
  return await bridge.InsertSvg(svg, target, kind);
}

export async function insertGeneratedCover(backgroundUrl: string, titleSvg: string, target: string): Promise<string> {
  const bridge = getNativeOfficeBridge();
  if (!bridge) throw new Error("请从 PowerPoint 或 WPS 的 SANDUN 插件打开此工具。");
  return await bridge.InsertCover(await generatedImageSvg(backgroundUrl), await localizeSvgImages(titleSvg), target);
}

export async function saveGeneratedImage(url: string, name: string): Promise<string> {
  const bridge = getNativeOfficeBridge();
  if (!bridge) throw new Error("请从 PowerPoint 或 WPS 的 SANDUN 插件打开此工具。");
  const { source } = await generatedImageData(url);
  return await bridge.SaveGeneratedImage(source, name);
}

export async function localizeSvgImages(svg: string): Promise<string> {
  const urls = [...new Set([...svg.matchAll(/(?:href|xlink:href)=["'](https?:[^"']+)["']/gi)].map((m) => m[1]))];
  let result = svg.replace(/@import\s+url\(["']?https?:[^)]+\);?/gi, "").replace(/<link\b[^>]*https?:[^>]*>/gi, "");
  for (const url of urls) {
    result = result.split(url).join(await embeddedImage(url));
  }
  return result;
}

async function embeddedImage(url: string): Promise<string> {
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(url)) throw new Error("图片必须是本地返回的内嵌图像");
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法读取生成的图片资源");
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

async function generatedImageData(url: string): Promise<{ source: string; width: number; height: number }> {
  let source = await embeddedImage(url);
  const image = new Image();
  image.src = source;
  try { await image.decode(); }
  catch { throw new Error("生成的图片无法读取，请重试。"); }
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height) throw new Error("生成的图片尺寸无效，请重试。");
  // Office accepts embedded PNG/JPEG; normalize other decodable formats.
  if (!/^data:image\/(png|jpeg);base64,/i.test(source)) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法准备图片，请重试。");
    context.drawImage(image, 0, 0);
    source = canvas.toDataURL("image/png");
  }
  return { source, width, height };
}

export async function generatedImageSvg(url: string): Promise<string> {
  const { source, width, height } = await generatedImageData(url);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><image href="${source}" width="${width}" height="${height}"/></svg>`;
}

export async function insertGeneratedChart(chartData: string, fallbackSvg: string, target: string, mode: "native" | "svg" = "native"): Promise<string> {
  // AI charts in the plugin always insert as SVG. Native chart insertion is
  // intentionally kept out of this path so the result has no editable data
  // table or Office-specific mode.
  return await insertGeneratedSvg(fallbackSvg, target, "chart");
}

function getNativeOfficeBridge(): NativeOfficeBridge | null {
  const hostObjects = (globalThis as any).chrome?.webview?.hostObjects;
  const bridge = hostObjects?.sandunOffice as NativeOfficeBridge | undefined;
  // WebView2 exposes asynchronous host objects as callable proxies. Probing a
  // member with typeof can misclassify that proxy before its first invocation.
  return bridge || null;
}

export function detectHost(): HostKind {
  if (getNativeOfficeBridge()) return "office";
  if (typeof Office !== "undefined" && typeof PowerPoint !== "undefined")
    return "office";
  if (typeof wps !== "undefined" && typeof wps.WppApplication === "function")
    return "wps";
  return "browser";
}
