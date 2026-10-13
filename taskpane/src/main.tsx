import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WindowShell from "./WindowShell";
import { ToolSettings } from "./ToolSettings";
import "./styles.css";
import "./window-shell.css";
import "./ai-experience.css";

function WindowContent() {
  const [tool, setTool] = useState(new URLSearchParams(location.search).get("tool") || "home");
  useEffect(() => {
    const view = (globalThis as any).chrome?.webview;
    const receive = (event: any) => { if (event.data?.type === "sandun:navigate") setTool(event.data.tool); };
    view?.addEventListener("message", receive);
    return () => view?.removeEventListener("message", receive);
  }, []);
  return tool.startsWith("native:") ? <ToolSettings key={tool} id={tool.slice(7)} /> : <App />;
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WindowShell>
      <WindowContent />
    </WindowShell>
  </React.StrictMode>,
);
