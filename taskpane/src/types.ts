export interface PluginDiagramSlot {
  slot_id: string;
  diagram_type: string;
  title?: string;
  spec?: string;
  svg?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PluginAIResponse {
  success: boolean;
  url?: string;
  chart_type?: string;
  chart_data?: string;
  slot?: PluginDiagramSlot;
  error?: string;
}
export interface ImageGenerationOptions {
  size: string;
  quality: string;
  output_format: "png" | "jpeg";
  background: "auto" | "opaque" | "transparent";
  output_compression?: number;
}

export interface ProviderInput {base_url:string; model:string; api_key?:string; clear_key?:boolean}
export interface ProviderPublic {base_url:string; model:string; key_configured:boolean}
export interface ProviderConfigs {text:ProviderPublic; image:ProviderPublic}
