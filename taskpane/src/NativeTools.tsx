import { ToolSettings } from "./ToolSettings";

export function ToolIcon({ id }: { id: string }) {
  return <img src={`/tools/${id}.svg`} width={20} height={20} alt="" aria-hidden="true" />;
}

export function ZoomPage() { return <ToolSettings id="zoom" />; }
