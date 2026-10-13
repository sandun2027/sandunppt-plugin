import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

const wpsConfig = JSON.parse(readFileSync(new URL("../../manifests/wps/config.json", import.meta.url), "utf8"));
// Exercise WPS's direct entry loader, without index.html or extra scripts.
const source = readFileSync(new URL("../../manifests/wps/" + wpsConfig.entry, import.meta.url), "utf8");

test("WPS split-button image callbacks resolve parent, menu and child controls", () => {
  const images = runInNewContext(source + `\n[
    SANDUNGetToolImage({ Tag: "group" }),
    SANDUNGetToolImage({ Id: "SANDUN.Tool.group" }),
    SANDUNGetToolImage({ Id: "SANDUN.Group", Tag: "" }),
    SANDUNGetToolImage({ id: "SANDUN.GroupMenu" })
  ];`);
  expect(new Set(images).size).toBe(1);
  expect(images[0]).toMatch(/^icons\/group-[a-f0-9]{16}\.svg$/);
});

test("every WPS ribbon image resolves to an original, packaged SVG", () => {
  const ribbon = readFileSync(new URL("../../manifests/wps/ribbon.xml", import.meta.url), "utf8");
  const controls = [...ribbon.matchAll(/<(?:button|menu)\s+([^>]+)>/g)]
    .map(match => Object.fromEntries([...match[1].matchAll(/(\w+)=["']([^"']*)["']/g)].map(attribute => [attribute[1], attribute[2]])))
    .filter(control => control.getImage);
  expect(controls.length).toBeGreaterThan(35);
  for (const control of controls) {
    const url = runInNewContext(source + `\n${control.getImage}(control);`, { control: { Id: control.id, Tag: control.tag } });
    expect(url).not.toContain("undefined");
    const asset = new URL(url, "https://127.0.0.1:17667/wps/").pathname.replace(/^\/wps\//, "");
    expect(url).toMatch(/^icons\/[a-z0-9-]+-[a-f0-9]{16}\.svg$/);
    const svg = readFileSync(new URL("../../manifests/wps/" + asset, import.meta.url));
    const name = asset.replace(/^icons\//, "").replace(/-[a-f0-9]{16}\.svg$/, "");
    const original = readFileSync(new URL(`../public/tools/ribbon-${name}.svg`, import.meta.url), "utf8").trimEnd();
    expect(svg.toString("utf8")).toBe(original);
    expect(asset).toContain(createHash("sha256").update(svg).digest("hex").slice(0, 16));
  }
  expect(controls.find(control => control.id === "SANDUN.Group")?.tag).toBe("group");
  expect(ribbon).not.toContain("<splitButton");
});

test("a stale WPS font-export button cannot execute or relay the command", () => {
  const execute = vi.fn();
  const fetch = vi.fn();
  const context = { fetch, alert: vi.fn(), wps: { WppApplication: () => ({ COMAddIns: { Item: () => ({ Connect: true, Object: { ExecuteTool: execute } }) } }) } };
  expect(runInNewContext(source + '\nSANDUNRunNativeTool({ Tag: "export-fonts" });', context)).toBe(false);
  expect(execute).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("WPS discovers and connects its registered native component before executing", () => {
  const execute = vi.fn();
  const addin = { Connect: false, Object: { ExecuteTool: execute } };
  let discovered = false;
  const alert = vi.fn();
  const context = { alert, wps: { WppApplication: () => ({ COMAddIns: { Item: () => discovered ? addin : null, Update: () => { discovered = true; } } }) } };
  runInNewContext(source + '\nSANDUNRunNativeTool({ Tag: "zoom" });', context);
  expect(addin.Connect).toBe(true);
  expect(execute).toHaveBeenCalledWith("zoom");
  expect(alert).not.toHaveBeenCalled();
});

test("missing WPS registration gives the repair action without dereferencing null", () => {
  const alert = vi.fn();
  runInNewContext(source + '\nSANDUNRunNativeTool({ Tag: "collage" });', { alert, wps: { WppApplication: () => ({ COMAddIns: { Item: () => null, Update: () => {} } }) } });
  expect(alert.mock.calls[0][0]).toContain("SANDUN 修复");
  expect(alert.mock.calls[0][0]).not.toContain("reading");
});

function relayContext(fetch: ReturnType<typeof vi.fn>) {
  return { fetch, alert: vi.fn(), wps: { WppApplication: () => ({ COMAddIns: { Item: () => ({ Connect: true, Object: {} }) } }) } };
}

test("the first relay click bootstraps its session and coalesces repeated clicks", async () => {
  let finishBootstrap!: (value: any) => void;
  const fetch = vi.fn().mockReturnValueOnce(new Promise(resolve => { finishBootstrap = resolve; }))
    .mockResolvedValueOnce({ ok: true });
  const context = relayContext(fetch);
  const completion = runInNewContext(source + '\nSANDUNRunNativeTool({ Tag: "collage" }); SANDUNRunNativeTool({ Tag: "collage" }); SANDUNRelayTool("collage");', context);
  expect(fetch).toHaveBeenCalledTimes(1);
  finishBootstrap({ ok: true, json: async () => ({ csrfToken: "fresh-token" }) });
  await completion;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe("/local/wps/tool?tool=collage");
  expect(fetch.mock.calls[1][1].headers["X-PPTagent-CSRF"]).toBe("fresh-token");
  expect(context.alert).not.toHaveBeenCalled();
});

test("relay HTTP failures are visible and the tool can be retried", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: "token" }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ detail: "WPS 未响应，请重试" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: "new-token" }) })
    .mockResolvedValueOnce({ ok: true });
  const context = relayContext(fetch);
  await runInNewContext(source + '\n(async () => { await SANDUNRelayTool("zoom"); await SANDUNRelayTool("zoom"); })();', context);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(context.alert).toHaveBeenCalledExactlyOnceWith("WPS 未响应，请重试");
  expect(fetch.mock.calls[3][1].headers["X-PPTagent-CSRF"]).toBe("new-token");
});

test("workspace fallback uses the same relay without opening an unbridged task pane", async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: "token" }) })
    .mockResolvedValueOnce({ ok: true });
  const context = relayContext(fetch);
  await runInNewContext(source + '\nSANDUNOpenTool("settings"); SANDUNRelayTool("settings");', context);
  expect(fetch.mock.calls[1][0]).toBe("/local/wps/tool?tool=settings");
  expect(context.alert).not.toHaveBeenCalled();
});
