// @vitest-environment happy-dom
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";

const captured = vi.hoisted(() => ({ initialProfileSkills: undefined as string[] | undefined }));

vi.mock("@/components/agent/add-job-dialog", () => ({
  AddJobDialog: () => <div data-testid="add-job-dialog" />,
}));

vi.mock("@/components/jobs/job-search-client", () => ({
  JobSearchClient: ({ initialProfileSkills }: { initialProfileSkills: string[] }) => {
    captured.initialProfileSkills = initialProfileSkills;
    return <div data-testid="job-search-client" />;
  },
}));

const dir = mkdtempSync(join(tmpdir(), "offeros-jobs-profile-contract-"));
process.env.OFFEROS_DB_PATH = join(dir, "jobs.db");

const { default: JobsPage } = await import("../page");
const { getDb } = await import("@/server/db/client");
const { saveProfile } = await import("@/server/repositories/profile-repo");

afterAll(() => {
  cleanup();
  delete process.env.OFFEROS_DB_PATH;
  delete (globalThis as Record<string, unknown>).__offerosDb;
  delete (globalThis as Record<string, unknown>).__offerosSqlite;
  rmSync(dir, { recursive: true, force: true });
});

describe("JobsPage Profile skill contract", () => {
  it("passes only trimmed, alias-deduplicated, valid, capped skills to JobSearchClient", () => {
    saveProfile(getDb(), {
      personal: {
        name: "Test Applicant",
        email: "applicant@example.com",
        phone: "+1 555 0100",
        links: {},
      },
      skills: [
        " Node.js ",
        "NodeJS",
        "",
        "x".repeat(101),
        ...Array.from({ length: 60 }, (_, index) => ` Skill ${index} `),
      ],
      education: [],
      experience: [],
    });

    render(<JobsPage />);

    expect(captured.initialProfileSkills).toHaveLength(50);
    expect(captured.initialProfileSkills?.slice(0, 3)).toEqual(["Node.js", "Skill 0", "Skill 1"]);
    expect(captured.initialProfileSkills?.at(-1)).toBe("Skill 48");
    expect(captured.initialProfileSkills).not.toContain("NodeJS");
    expect(captured.initialProfileSkills).not.toContain("");
    expect(captured.initialProfileSkills).not.toContain("x".repeat(101));
  });
});
