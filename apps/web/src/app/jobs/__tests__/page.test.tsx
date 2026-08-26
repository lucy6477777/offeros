// @vitest-environment happy-dom
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const dir = mkdtempSync(join(tmpdir(), "offeros-jobs-page-"));
process.env.OFFEROS_DB_PATH = join(dir, "jobs.db");

const { default: JobsPage } = await import("../page");
const { createCapturedJobPosting } = await import("@offeros/job-search");
const { getDb } = await import("@/server/db/client");
const { saveCapturedJobPosting } = await import("@/server/repositories/job-search-repo");

afterAll(() => {
  cleanup();
  delete process.env.OFFEROS_DB_PATH;
  delete (globalThis as Record<string, unknown>).__offerosDb;
  delete (globalThis as Record<string, unknown>).__offerosSqlite;
  rmSync(dir, { recursive: true, force: true });
});

describe("JobsPage", () => {
  it("renders the canonical SQLite catalogue through the real page", () => {
    saveCapturedJobPosting(getDb(), {
      posting: createCapturedJobPosting({
        source: "browser",
        url: "https://jobs.example.com/acme/jobs/123?utm_source=panel",
        title: "Browser Platform Engineer",
        company: "Acme",
        location: "Remote, United States",
        description: "Build TypeScript infrastructure.",
        fetchedAt: Date.UTC(2026, 7, 26, 10),
      }),
      seenAt: Date.UTC(2026, 7, 26, 10),
    });

    render(<JobsPage />);

    expect(screen.getByRole("heading", { name: "Jobs" })).toBeTruthy();
    expect(screen.getByText("Browser Platform Engineer")).toBeTruthy();
    expect(screen.getByText("Browser")).toBeTruthy();
    expect(screen.getByTestId("catalogue-total").textContent).toBe("1 saved locally");
    expect(screen.getByRole("link", { name: /Apply link/ }).getAttribute("href")).toBe(
      "https://jobs.example.com/acme/jobs/123",
    );
  });
});
