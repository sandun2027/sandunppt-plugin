import type { ImageGenerationOptions } from "./types";

export const IMAGE_SIZES = {
  "16:9": ["1536x864", "2560x1440"],
  "1:1": ["1024x1024", "2048x2048"],
  "3:2": ["1536x1024", "2304x1536"],
  "2:3": ["1024x1536", "1536x2304"],
  "9:16": ["864x1536", "1440x2560"],
  "4:3": ["1152x864", "2048x1536"],
  "3:4": ["864x1152", "1536x2048"],
} as const;
export type ImageRatio = keyof typeof IMAGE_SIZES;
export interface ReferenceImage { id: string; name: string; bytes: number; url: string }
export interface ImageSettings {
  ratio: ImageRatio;
  resolution: 0 | 1;
  quality: string;
  format: "png" | "jpeg";
  background: "auto" | "opaque" | "transparent";
  compression: number;
}
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  ratio: "16:9", resolution: 0, quality: "auto", format: "png", background: "auto", compression: 90,
};
export function supportsImageOptions(model: string): boolean {
  return /^gpt-image-2\.5-(sunburst|flare)(-\d{4}-\d{2}-\d{2})?$/.test(model.trim().toLowerCase().split("/").pop() || "");
}
export function imageRequestOptions(settings: ImageSettings): ImageGenerationOptions {
  return {
    size: IMAGE_SIZES[settings.ratio][settings.resolution],
    quality: settings.quality,
    output_format: settings.format,
    background: settings.background,
    ...(settings.format === "jpeg" ? { output_compression: settings.compression } : {}),
  };
}
export async function readReferenceImages(files: File[], current: ReferenceImage[]): Promise<ReferenceImage[]> {
  if (current.length + files.length > 4) throw new Error("最多添加 4 张参考图，请先移除不需要的图片。");
  if (files.some(file => !["image/png", "image/jpeg", "image/webp"].includes(file.type))) throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
  if (files.some(file => !file.size || file.size > 8 * 1024 * 1024)) throw new Error("单张参考图不能超过 8 MB，且不能是空文件。");
  if ([...current, ...files.map(file => ({ bytes: file.size }))].reduce((total, file) => total + file.bytes, 0) > 24 * 1024 * 1024) throw new Error("参考图总大小不能超过 24 MB。");
  const added: ReferenceImage[] = [];
  for (const file of files) {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取参考图，请重新选择。"));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error("参考图无法打开，请选择完整有效的图片。"); }
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("参考图尺寸过大，请缩小至 4000 万像素以内。");
    added.push({ id: crypto.randomUUID(), name: file.name, bytes: file.size, url });
  }
  return [...current, ...added];
}
