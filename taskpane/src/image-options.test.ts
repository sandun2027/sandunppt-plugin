import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_SETTINGS, IMAGE_SIZES, imageRequestOptions, supportsImageOptions } from "./image-options";

describe("image controls", () => {
  it("recognizes the requested model families without matching other models", () => {
    for (const model of ["GPT-Image-2.5-Flare", "gpt-image-2.5-sunburst", "openai/gpt-image-2.5-flare-2026-09-08"]) expect(supportsImageOptions(model)).toBe(true);
    for (const model of ["flux", "gpt-image-1", "gpt-image-2.5-flare-fast", "other-gpt-image-2.5-sunburst"]) expect(supportsImageOptions(model)).toBe(false);
  });
  it("offers dimensions accepted by the documented API", () => {
    for (const [ratio, sizes] of Object.entries(IMAGE_SIZES)) {
      const [a, b] = ratio.split(":").map(Number);
      for (const size of sizes) {
        const [w, h] = size.split("x").map(Number);
        expect(w % 16 + h % 16).toBe(0);
        expect(w / h).toBeCloseTo(a / b);
        expect(w * h).toBeGreaterThanOrEqual(655360);
        expect(w * h).toBeLessThanOrEqual(8294400);
        expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
      }
    }
  });
  it("sends compression only for JPEG and preserves zero", () => {
    expect(imageRequestOptions(DEFAULT_IMAGE_SETTINGS)).toEqual({ size: "1536x864", quality: "auto", output_format: "png", background: "auto" });
    expect(imageRequestOptions({ ...DEFAULT_IMAGE_SETTINGS, format: "jpeg", compression: 0, ratio: "9:16", resolution: 1 })).toEqual({ size: "1440x2560", quality: "auto", output_format: "jpeg", background: "auto", output_compression: 0 });
  });
});
