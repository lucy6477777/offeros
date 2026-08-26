import { Check, Minus, Sparkles, X, type LucideIcon } from "lucide-react";
import type { FillItem } from "@offeros/autofill";

export type FieldDisplayState = "ready" | "filled" | "suggestion" | "manual" | "failed";

// Plan-state fallback before a report or suggestion exists.
export const STATUS_ICON: Record<FillItem["status"], { Icon: LucideIcon; cls: string }> = {
  fillable: { Icon: Check, cls: "text-brand" },
  "needs-answer": { Icon: Minus, cls: "text-text-tertiary" },
  unknown: { Icon: Minus, cls: "text-text-tertiary" },
};

export function StatusIcon({
  status,
  written,
  displayState,
}: {
  status: FillItem["status"];
  written: boolean;
  displayState?: FieldDisplayState;
}) {
  const state = displayState ?? (written ? "filled" : status === "fillable" ? "ready" : "manual");
  // Written = the value verifiably landed on the page this session (or a
  // rehydrated report says it did) — a solid brand check, distinct from the
  // outline "ready" check. Rows flip to this live as the fill progresses.
  if (state === "filled") {
    return (
      <span
        aria-hidden
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-brand"
      >
        <Check className="h-2.5 w-2.5 text-brand-foreground" strokeWidth={3} />
      </span>
    );
  }
  if (state === "suggestion") {
    return <Sparkles aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />;
  }
  if (state === "failed") {
    return <X aria-hidden className="h-3.5 w-3.5 shrink-0 text-danger" strokeWidth={3} />;
  }
  const { Icon, cls } = STATUS_ICON[status];
  return <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${cls}`} />;
}
