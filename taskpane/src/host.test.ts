import { describe, it, expect } from "vitest";
import { localizeSvgImages, generatedImageSvg } from "./host";
describe("open source images",()=>{
 it("rejects remote image fetches in the host",async()=>{await expect(generatedImageSvg("https://external.example.test/image.png")).rejects.toThrow("内嵌图像")});
 it("keeps sanitized standalone SVG",async()=>{const svg='<svg><text>hello</text></svg>';expect(await localizeSvgImages(svg)).toBe(svg)});
});
