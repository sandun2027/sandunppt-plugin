import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";

type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  busy?: boolean;
  complete?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
};

export function AIActionButton({ variant = "primary", busy = false, complete = false, loadingLabel, icon, children, className = "", disabled, ...props }: ActionProps) {
  return <button {...props} type={props.type || "button"} className={`ai-action ai-action--${variant} ${className}`} disabled={disabled || busy} aria-busy={busy} data-complete={complete && !busy || undefined}>
    <span className="ai-action-content">
      <span className="ai-action-icon" aria-hidden="true">{busy ? <span className="ai-button-spinner" /> : complete ? <Check size={16} /> : icon}</span>
      <span key={busy ? "busy" : complete ? "complete" : "idle"} className="ai-action-label">{busy ? loadingLabel || children : children}</span>
    </span>
  </button>;
}

export function AIActivity({ title, detail }: { title: string; detail: string }) {
  return <div className="ai-activity" role="status" aria-live="polite">
    <div className="ai-activity-orbit" aria-hidden="true"><Sparkles size={21} strokeWidth={1.5} /></div>
    <div className="ai-activity-copy"><strong>{title}</strong><p>{detail}</p></div>
    <div className="ai-activity-track" aria-hidden="true"><i /></div>
  </div>;
}

export function AICompletion({ children }: { children: ReactNode }) {
  return <div className="ai-completion" role="status"><span aria-hidden="true"><Check size={15} strokeWidth={2.2} /></span><p>{children}</p></div>;
}
