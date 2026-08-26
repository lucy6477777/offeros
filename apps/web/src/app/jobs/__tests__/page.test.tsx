// @vitest-environment happy-dom
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const dir = mkdtempSync(join(tmpdir(), "offeros-jobs-page-"));
process.env.OFFEROS_DB_PATH = join(dir, "jobs.db");

const { default: JobsPage, getJobMatchingProfileSkills } = await import("../page");
const { createCapturedJobPosting } = await import("@offeros/job-search");
const { getDb } = await import("@/server/db/client");
const { saveCapturedJobPosting } = await import("@/server/repositories/job-search-repo");
const { saveProfile } = await import("@/server/repositories/profile-repo");

afterAll(() => {
  cleanup();
  delete process.env.OFFEROS_DB_PATH;
  delete (globalThis as Record<string, unknown>).__offerosDb;
  delete (globalThis as Record<string, unknown>).__offerosSqlite;
  rmSync(dir, { recursive: true, force: true });
});

describe("JobsPage", () => {
  it("renders the canonical SQLite catalogue through the real page", () => {
    saveProfile(getDb(), {
      personal: {
        name: "Test Applicant",
        email: "applicant@example.com",
        phone: "+1 555 0100",
        links: {},
      },
      skills: [
        " TypeScript ",
        "typescript",
        "",
        "x".repeat(101),
        ...Array.from({ length: 60 }, (_, index) => ` Skill ${index} `),
      ],
      education: [],
      experience: [],
    });
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

    const profileSkills = getJobMatchingProfileSkills(getDb());
    expect(profileSkills).toHaveLength(50);
    expect(profileSkills.slice(0, 3)).toEqual(["TypeScript", "Skill 0", "Skill 1"]);
    expect(profileSkills.at(-1)).toBe("Skill 48");
    expect(profileSkills).not.toContain("typescript");
    expect(profileSkills).not.toContain("x".repeat(101));

    render(<JobsPage />);

    expect(screen.getByRole("heading", { name: "Jobs" })).toBeTruthy();
    expect(screen.getByText("Browser Platform Engineer")).toBeTruthy();
    expect(screen.getByText("Browser")).toBeTruthy();
    expect(screen.getByTestId("catalogue-total").textContent).toBe("1 saved locally");
    expect(screen.getByRole("link", { name: /Apply link/ }).getAttribute("href")).toBe(
      "https://jobs.example.com/acme/jobs/123",
    );

    fireEvent.click(screen.getByRole("button", { name: "New saved search" }));
    expect((screen.getByLabelText("My Profile skills") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Using 50 Profile skills for ranking/).textContent).toContain(
      "TypeScript, Skill 0, Skill 1",
    );
  });
});
