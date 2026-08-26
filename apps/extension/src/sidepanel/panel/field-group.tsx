import type { FillItem } from "@offeros/autofill";
import { StatusIcon, type FieldDisplayState } from "./status-icon";

const STATE_BADGE: Record<FieldDisplayState, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "text-success" },
  filled: { label: "Filled", cls: "text-success" },
  suggestion: { label: "Suggestion", cls: "text-warning" },
  manual: { label: "Manual", cls: "text-text-tertiary" },
  failed: { label: "Failed", cls: "text-danger" },
};

// Required / Optional checklist group. Each row is clickable — it scrolls the
// page to that field and flashes the highlight — and carries the fill plan's
// per-field reason ("why this value") as its tooltip. An empty group is
// omitted so an ATS that marks nothing required renders no header.
export function FieldGroup({
  title,
  items,
  reasonFor,
  onJump,
  writtenValue,
  stateFor,
  revealKey,
}: {
  title: string;
  items: FillItem[];
  reasonFor?: (fieldId: string) => string | undefined;
  onJump?: (fieldId: string) => void;
  /** Value verifiably written to the page for this field this session, if any. */
  writtenValue?: (fieldId: string) => string | undefined;
  /** User-facing state derived from the current report/suggestion. `ready` is
   * the pre-run state; every post-run result is one of the four explicit
   * Filled/Suggestion/Manual/Failed outcomes. */
  stateFor?: (fieldId: string) => FieldDisplayState;
  /** Changes when a NEW page's fields arrive — remounts rows so the staggered
   *  reveal replays for the new form (and never on ordinary re-renders). */
  revealKey?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </p>
      <ul className="space-y-0.5 text-body">
        {items.map((i, index) => {
          const written = writtenValue?.(i.fieldId);
          const state =
            stateFor?.(i.fieldId) ??
            (written !== undefined ? "filled" : i.status === "fillable" ? "ready" : "manual");
          const badge = STATE_BADGE[state];
          return (
            <li
              key={`${revealKey ?? ""}|${i.fieldId}`}
              className="animate-slide-in-right"
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
            >
              <button
                type="button"
                title={reasonFor?.(i.fieldId)}
                data-written={written !== undefined || undefined}
                data-state={state}
                onClick={() => onJump?.(i.fieldId)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-bg-base"
              >
                <StatusIcon
                  status={i.status}
                  written={written !== undefined}
                  displayState={state}
                />
                <span className="flex-1 truncate text-text-primary">{i.label}</span>
                {(written ?? (i.status === "fillable" ? i.value : undefined)) !== undefined && (
                  <span className="truncate text-text-tertiary">
                    {written ?? (i.status === "fillable" ? i.value : "")}
                  </span>
                )}
                <span className={`shrink-0 text-micro font-semibold ${badge.cls}`}>
                  {badge.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
