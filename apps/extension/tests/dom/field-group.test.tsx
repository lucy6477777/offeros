// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { FillItem } from "@offeros/autofill";
import { FieldGroup } from "../../src/sidepanel/panel/field-group";
import type { FieldDisplayState } from "../../src/sidepanel/panel/status-icon";

afterEach(cleanup);

const item = (fieldId: string, label: string, status: FillItem["status"]): FillItem => ({
  fieldId,
  label,
  status,
  value: status === "fillable" ? `${label} value` : "",
  source: status === "fillable" ? "personal" : "none",
  required: true,
});

describe("FieldGroup user-facing states", () => {
  it("labels Filled, Suggestion, Manual and Failed explicitly, with Ready only before a run", () => {
    const items = [
      item("filled", "Full name", "fillable"),
      item("suggestion", "Why this role", "needs-answer"),
      item("manual", "Work authorization", "needs-answer"),
      item("failed", "Phone", "fillable"),
      item("ready", "Email", "fillable"),
    ];
    const states = new Map<string, FieldDisplayState>([
      ["filled", "filled"],
      ["suggestion", "suggestion"],
      ["manual", "manual"],
      ["failed", "failed"],
      ["ready", "ready"],
    ]);

    render(
      <FieldGroup
        title="Required"
        items={items}
        writtenValue={(fieldId) => (fieldId === "filled" ? "Jordan Rivera" : undefined)}
        stateFor={(fieldId) => states.get(fieldId)!}
      />,
    );

    for (const [label, state, badge] of [
      ["Full name", "filled", "Filled"],
      ["Why this role", "suggestion", "Suggestion"],
      ["Work authorization", "manual", "Manual"],
      ["Phone", "failed", "Failed"],
      ["Email", "ready", "Ready"],
    ] as const) {
      const row = screen.getByRole("button", { name: new RegExp(label, "i") });
      expect(row.getAttribute("data-state")).toBe(state);
      expect(within(row).getByText(badge)).toBeTruthy();
    }
  });
});
