import { useEffect, useState, type ReactNode } from "react";
import { Columns2, Maximize2, Minimize2, X } from "lucide-react";

export function windowCommand(action: string) {
  (globalThis as any).chrome?.webview?.postMessage({
    type: "sandun:window",
    action,
  });
}

export default function WindowShell({ children }: { children: ReactNode }) {
  const native = new URLSearchParams(location.search).get("host") === "native";
  const [mode, setMode] = useState("floating");
  useEffect(() => {
    const webview = (globalThis as any).chrome?.webview;
    const onMessage = (event: { data: { type?: string; mode?: string } }) => {
      if (event.data?.type === "sandun:window-state")
        setMode(event.data.mode || "floating");
    };
    webview?.addEventListener("message", onMessage);
    webview?.postMessage({ type: "sandun:window-ready" });
    const layout = () => webview?.postMessage({ type: "sandun:window-layout", top: Math.ceil((document.querySelector('.window-titlebar')?.getBoundingClientRect().bottom || 58) * window.devicePixelRatio) });
    const observer = new ResizeObserver(layout);
    const titlebar = document.querySelector('.window-titlebar');
    if (titlebar) observer.observe(titlebar);
    window.addEventListener('resize', layout);
    layout();
    return () => { webview?.removeEventListener("message", onMessage); observer.disconnect(); window.removeEventListener('resize', layout); };
  }, []);
  return (
    <div
      className={`window-shell mode-${mode}${native ? " native-shell" : ""}`}
    >
      <header
        className="window-titlebar"
        onPointerDown={(event) => {
          if (
            native &&
            event.button === 0 &&
            !(event.target as Element).closest("button")
          )
            windowCommand("drag");
        }}
        onDoubleClick={(event) => {
          if (native && !(event.target as Element).closest("button"))
            windowCommand("expand");
        }}
      >
        <div className="window-wordmark">
          SANDUN <span>AI</span>
          <span className="window-edition-badge">开源版</span>
        </div>
        {native && (
          <nav className="window-controls" aria-label="窗口控制">
            <button
              aria-label={mode === "split" ? "切换独立窗口" : "与 PPT 并排分屏"}
              title={mode === "split" ? "切换独立窗口" : "与 PPT 并排分屏"}
              aria-pressed={mode === "split"}
              onClick={() => windowCommand("split")}
            >
              <Columns2 size={19} strokeWidth={1.5} />
            </button>
            <button
              aria-label={mode === "expanded" ? "还原窗口" : "展开窗口"}
              title={mode === "expanded" ? "还原窗口" : "展开窗口"}
              onClick={() => windowCommand("expand")}
            >
              {mode === "expanded" ? (
                <Minimize2 size={17} />
              ) : (
                <Maximize2 size={17} />
              )}
            </button>
            <button
              aria-label="关闭窗口"
              title="关闭"
              onClick={() => windowCommand("close")}
            >
              <X size={22} strokeWidth={1.4} />
            </button>
          </nav>
        )}
      </header>
      <div className="window-content">{children}</div>
      {native && (
        <div
          className="window-resize-edge"
          title="拖动调整宽度"
          onPointerDown={() => windowCommand("resize-left")}
        />
      )}
    </div>
  );
}
