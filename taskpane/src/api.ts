import type { PluginAIResponse, ProviderConfigs, ProviderInput } from "./types";
import type { ImageGenerationOptions } from "./types";
let csrfToken = "";
const CLIENT_ID = "taskpane-v1";

export async function bootstrap(): Promise<void> {
  const response = await fetch("/local/bootstrap", {
    credentials: "include",
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("无法连接 SANDUN 本地服务");
  const data = await response.json();
  csrfToken = String(data.csrfToken || "");
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("X-PPTagent-Client", CLIENT_ID);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers.set("X-PPTagent-CSRF", csrfToken);
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const data = await response.json();
      if (response.status === 403 && data.code === "local_security" && retry) {
        await bootstrap();
        return apiFetch<T>(path, init, false);
      }
      message = String(data.detail || data.message || message);
    } catch {
      // Keep the HTTP fallback when the response is not JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
 config: () => apiFetch<ProviderConfigs>("/local/config"),
 saveConfig: (value: Record<string,ProviderInput>) => apiFetch<ProviderConfigs>("/local/config",{method:"PUT",body:JSON.stringify(value)}),
 testConfig: (kind:"text"|"image",value:ProviderInput)=>apiFetch<{success:boolean;message:string}>(`/local/config/test/${kind}`,{method:"POST",body:JSON.stringify(value)}),
  pluginGenerateImage: (prompt: string, options?: ImageGenerationOptions, referenceImages: string[] = []) =>
    apiFetch<PluginAIResponse>("/local/plugin/ai/generate-image", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        image_options: options,
        reference_images: referenceImages,
      }),
    }),
  pluginGenerateChart: (prompt: string, chartType = "auto", data?: unknown) =>
    apiFetch<PluginAIResponse>("/local/plugin/ai/generate-chart", {
      method: "POST",
      body: JSON.stringify({ prompt, chart_type: chartType, data }),
    }),
  pluginGenerateDiagram: (prompt: string, diagramType = "auto", title = "") =>
    apiFetch<PluginAIResponse>("/local/plugin/ai/generate-diagram", {
      method: "POST",
      body: JSON.stringify({ prompt, diagram_type: diagramType, title }),
    }),
  pluginCoverStyles: (topic: string) =>
    apiFetch<{ success: boolean; styles: string[]; error?: string }>("/local/plugin/ai/cover/styles", { method: "POST", body: JSON.stringify({ topic }) }),
  pluginCoverPlan: (topic: string) =>
    apiFetch<{ success: boolean; plans?: { main_title: string; subtitle: string; style_name: string; style_description: string; background_type: "light" | "dark"; primary_color: string; secondary_color: string; accent_color: string; title_color: string; subtitle_color: string; title_position: string; title_treatment: string }[]; error?: string }>("/local/plugin/ai/cover/plan", { method: "POST", body: JSON.stringify({ topic }) }),
  pluginCoverDraft: (title: string, position: string, styleDescription: string) =>
    apiFetch<{ success: boolean; svg?: string; error?: string }>("/local/plugin/ai/cover/draft", { method: "POST", body: JSON.stringify({ title, position, style_description: styleDescription }) }),
  pluginCoverBackground: (title: string, position: string, styleDescription: string, draftSvg: string) =>
    apiFetch<{ success: boolean; url?: string; error?: string }>("/local/plugin/ai/cover/background", { method: "POST", body: JSON.stringify({ title, position, style_description: styleDescription, draft_svg: draftSvg }) }),
};
