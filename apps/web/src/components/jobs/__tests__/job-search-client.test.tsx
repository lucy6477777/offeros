// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SavedJobSearch } from "@offeros/job-search";
import type {
  JobCatalogueEntry,
  JobSearchRunSummary,
  JobSourceHealthSummary,
  PublicJobSearchResult,
} from "@/lib/api-client";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  history: vi.fn(),
  searchPublic: vi.fn(),
  savedSearches: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    run: vi.fn(),
  },
}));

vi.mock("@/lib/api-client", () => ({
  api: { jobs: mocks },
}));

const { JobSearchClient } = await import("../job-search-client");

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.history.mockResolvedValue({ runs: [], sourceHealth: [] });
});

function entry(
  id: string,
  overrides: Partial<JobCatalogueEntry["posting"]> = {},
): JobCatalogueEntry {
  return {
    posting: {
      id,
      title: "Platform Engineer",
      company: "Acme",
      location: "Remote, United States",
      workplace: "remote",
      postedAt: "2026-08-25T08:00:00Z",
      applyUrl: `https://jobs.example.com/${id}`,
      liveness: "unknown",
      sources: [
        {
          provider: "manual-url",
          kind: "manual",
          externalId: id,
          sourceUrl: `https://jobs.example.com/${id}?utm_source=test`,
          applyUrl: `https://jobs.example.com/${id}`,
          fetchedAt: Date.UTC(2026, 7, 26, 10),
        },
      ],
      ...overrides,
    },
    firstSeenAt: Date.UTC(2026, 7, 26, 9),
    lastSeenAt: Date.UTC(2026, 7, 26, 10),
  };
}

function run(overrides: Partial<JobSearchRunSummary> = {}): JobSearchRunSummary {
  return {
    id: "run-1",
    criteria: { query: "platform", locationScope: "remote-us" },
    providerRuns: [],
    stages: [],
    status: "success",
    resultCount: 1,
    startedAt: Date.UTC(2026, 7, 26, 9, 59),
    finishedAt: Date.UTC(2026, 7, 26, 10),
    ...overrides,
  };
}

function health(overrides: Partial<JobSourceHealthSummary> = {}): JobSourceHealthSummary {
  return {
    provider: "freehire",
    status: "success",
    received: 1,
    accepted: 1,
    rejected: 0,
    durationMs: 25,
    issues: [],
    lastSuccessAt: Date.UTC(2026, 7, 26, 10),
    consecutiveFailures: 0,
    updatedAt: Date.UTC(2026, 7, 26, 10),
    ...overrides,
  };
}

function renderSearch(
  initialJobs: JobCatalogueEntry[] = [],
  initialSavedSearches: SavedJobSearch[] = [],
  initialProfileSkills: string[] = [],
) {
  return render(
    <JobSearchClient
      initialJobs={initialJobs}
      initialRuns={[]}
      initialSourceHealth={[]}
      initialSavedSearches={initialSavedSearches}
      initialProfileSkills={initialProfileSkills}
    />,
  );
}

describe("JobSearchClient", () => {
  it("shows source provenance, posting time, last check, and the original apply link", () => {
    const captured = entry("job-1", {
      sources: [
        entry("source").posting.sources[0]!,
        {
          provider: "browser-capture",
          kind: "browser",
          externalId: "job-1",
          sourceUrl: "https://jobs.example.com/job-1",
          applyUrl: "https://jobs.example.com/job-1",
          fetchedAt: Date.UTC(2026, 7, 26, 10),
        },
      ],
    });
    renderSearch([captured]);

    expect(screen.getByText("Platform Engineer")).toBeTruthy();
    expect(screen.getByText("Manual URL")).toBeTruthy();
    expect(screen.getByText("Browser")).toBeTruthy();
    expect(screen.getByText("Aug 25, 2026")).toBeTruthy();
    expect(screen.getByText(/Aug 26, 2026.*UTC/)).toBeTruthy();
    const apply = screen.getByRole("link", { name: /Apply link/ });
    expect(apply.getAttribute("href")).toBe("https://jobs.example.com/job-1");
    expect(apply.getAttribute("target")).toBe("_blank");
  });

  it("filters the local catalogue immediately and can clear every filter", () => {
    renderSearch([
      entry("platform"),
      entry("product", {
        title: "Product Manager",
        location: "New York, NY",
        workplace: "on-site",
      }),
    ]);

    expect(screen.getByText("Platform Engineer")).toBeTruthy();
    expect(screen.queryByText("Product Manager")).toBeNull();

    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "any" } });
    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "product" } });
    expect(screen.queryByText("Platform Engineer")).toBeNull();
    expect(screen.getByText("Product Manager")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Platform Engineer")).toBeTruthy();
    expect(screen.getByText("Product Manager")).toBeTruthy();
  });

  it("runs an explicit freehire search, then re-reads persisted catalogue and health", async () => {
    const found = entry("found");
    const result: PublicJobSearchResult = {
      run: run(),
      postings: [found],
      providerRuns: [
        {
          provider: "freehire",
          status: "success",
          received: 1,
          accepted: 1,
          rejected: 0,
          durationMs: 25,
          issues: [],
        },
      ],
      stages: [],
    };
    mocks.searchPublic.mockResolvedValue(result);
    mocks.list.mockResolvedValue([found]);
    mocks.history.mockResolvedValue({ runs: [run()], sourceHealth: [health()] });
    renderSearch();

    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: " platform " } });
    fireEvent.click(screen.getByRole("button", { name: "Search public jobs" }));

    await waitFor(() =>
      expect(mocks.searchPublic).toHaveBeenCalledWith({
        query: "platform",
        locationScope: "remote-us",
        unknownLocationPolicy: "include",
        maxResults: 100,
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith();
    expect(mocks.history).toHaveBeenCalledWith(10);
    expect(await screen.findByText("1 job matched and saved")).toBeTruthy();
    expect(screen.getByText("Platform Engineer")).toBeTruthy();
    expect(screen.getByText("Healthy")).toBeTruthy();
  });

  it("keeps the page usable and explains a provider-level failure", async () => {
    const failedRun = run({ status: "failed", resultCount: 0 });
    mocks.searchPublic.mockResolvedValue({
      run: failedRun,
      postings: [],
      providerRuns: [
        {
          provider: "freehire",
          status: "failed",
          received: 0,
          accepted: 0,
          rejected: 0,
          durationMs: 50,
          issues: [
            {
              provider: "freehire",
              code: "network",
              message: "freehire is temporarily unavailable",
              retryable: true,
            },
          ],
        },
      ],
      stages: [],
    } satisfies PublicJobSearchResult);
    mocks.history.mockResolvedValue({
      runs: [failedRun],
      sourceHealth: [health({ status: "failed", consecutiveFailures: 1 })],
    });
    renderSearch();

    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "platform" } });
    fireEvent.click(screen.getByRole("button", { name: "Search public jobs" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Public search could not complete");
    expect(alert.textContent).toContain("freehire is temporarily unavailable");
    expect(screen.getByText("No jobs saved yet")).toBeTruthy();
  });

  it("sorts a saved-search shortlist and hides only explicit blockers", () => {
    const savedSearch: SavedJobSearch = {
      id: "saved-1",
      name: "Platform fit",
      criteria: {
        query: "platform engineer",
        locationScope: "remote-us",
        unknownLocationPolicy: "include",
        maxResults: 100,
      },
      sources: { freehire: true, greenhouse: [], lever: [], ashby: [] },
      match: {
        skillSource: "manual",
        prioritySkills: ["TypeScript"],
        excludedKeywords: ["contract"],
        excludedCompanies: [],
        maximumSeniority: "senior",
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "not-needed" },
      },
      createdAt: 10,
      updatedAt: 10,
    };
    renderSearch(
      [
        entry("strong", {
          title: "Senior Platform Engineer",
          liveness: "open",
          description: "Build platform services with TypeScript.",
        }),
        entry("possible", {
          title: "Platform Engineer",
          liveness: "open",
          description: "Build platform services with Python.",
        }),
        entry("excluded", {
          title: "Staff Platform Engineer",
          liveness: "open",
          description: "Six-month contract role using TypeScript.",
        }),
      ],
      [savedSearch],
    );

    expect(screen.getByText("Platform fit shortlist")).toBeTruthy();
    expect(screen.getByText("Strong evidence")).toBeTruthy();
    expect(screen.getByText("Possible match")).toBeTruthy();
    expect(screen.queryByText("Staff Platform Engineer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show 1 excluded" }));

    expect(screen.getByText("Staff Platform Engineer")).toBeTruthy();
    expect(screen.getByText("Excluded keyword matched: contract.")).toBeTruthy();
    expect(screen.getByText(/exceeds the senior ceiling/)).toBeTruthy();
  });

  it("shows conservative salary and experience facts, decisions, and decisive JD evidence", () => {
    const savedSearch: SavedJobSearch = {
      id: "saved-compensation",
      name: "Compensation fit",
      criteria: {
        query: "platform engineer",
        locationScope: "remote-us",
        unknownLocationPolicy: "include",
        maxResults: 100,
      },
      sources: { freehire: true, greenhouse: [], lever: [], ashby: [] },
      match: {
        skillSource: "manual",
        prioritySkills: ["TypeScript"],
        excludedKeywords: [],
        excludedCompanies: [],
        minimumAnnualSalaryUsd: 120_000,
        maximumRequiredExperienceYears: 4,
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "not-needed" },
      },
      createdAt: 10,
      updatedAt: 10,
    };
    renderSearch(
      [
        entry("below-salary", {
          title: "Below Salary Platform Engineer",
          liveness: "open",
          salary: "USD 100,000–119,000 per year",
          description: "Build platform services with TypeScript. 3–5 years of experience required.",
        }),
        entry("crossing-salary", {
          title: "Crossing Salary Platform Engineer",
          liveness: "open",
          salary: "USD 100,000–140,000 per year",
          description: "Build platform services with TypeScript. 3–5 years of experience required.",
        }),
        entry("hourly-salary", {
          title: "Hourly Salary Platform Engineer",
          liveness: "open",
          salary: "USD 80 per hour",
          description: "Build platform services with TypeScript. 3–5 years of experience required.",
        }),
        entry("missing-salary", {
          title: "Missing Salary Platform Engineer",
          liveness: "open",
          description: "Build platform services with TypeScript. 3–5 years of experience required.",
        }),
        entry("experience-blocker", {
          title: "Experience Heavy Platform Engineer",
          liveness: "open",
          salary: "USD 130,000 per year",
          description:
            "Build platform services with TypeScript. 5+ years of professional experience required.",
        }),
        entry("experience-range", {
          title: "Range Experience Platform Engineer",
          liveness: "open",
          salary: "USD 130,000 per year",
          description:
            "Build platform services with TypeScript. 3–5 years of professional experience required.",
        }),
        entry("experience-up-to", {
          title: "Up To Experience Platform Engineer",
          liveness: "open",
          salary: "USD 130,000 per year",
          description:
            "Build platform services with TypeScript. Up to 4 years of professional experience required.",
        }),
        entry("experience-tech", {
          title: "React Experience Platform Engineer",
          liveness: "open",
          salary: "USD 130,000 per year",
          description:
            "Build platform services with TypeScript. 5+ years of React experience required.",
        }),
      ],
      [savedSearch],
    );

    expect(screen.queryByText("Below Salary Platform Engineer")).toBeNull();
    expect(screen.queryByText("Experience Heavy Platform Engineer")).toBeNull();

    const crossing = screen.getByText("Crossing Salary Platform Engineer").closest("article")!;
    expect(within(crossing).getByText("$100k–$140k annual USD")).toBeTruthy();
    expect(within(crossing).getByLabelText("Salary decision: Needs review")).toBeTruthy();
    expect(within(crossing).getByLabelText("Salary evidence").textContent).toContain(
      "USD 100,000–140,000 per year",
    );

    const hourly = screen.getByText("Hourly Salary Platform Engineer").closest("article")!;
    expect(within(hourly).getByText("Not a supported annual USD cash/base amount")).toBeTruthy();
    expect(within(hourly).getByLabelText("Salary decision: Needs review")).toBeTruthy();

    const missing = screen.getByText("Missing Salary Platform Engineer").closest("article")!;
    expect(within(missing).getAllByText("Not mentioned")).toHaveLength(1);
    expect(within(missing).getByLabelText("Salary decision: Needs review")).toBeTruthy();

    const range = screen.getByText("Range Experience Platform Engineer").closest("article")!;
    expect(within(range).getByText("3–5 years explicitly required")).toBeTruthy();
    expect(within(range).getByLabelText("Experience decision: Rule satisfied")).toBeTruthy();
    expect(within(range).getByLabelText("Experience evidence").textContent).toContain(
      "3–5 years of professional experience required",
    );

    for (const title of [
      "Up To Experience Platform Engineer",
      "React Experience Platform Engineer",
    ]) {
      const reviewCard = screen.getByText(title).closest("article")!;
      expect(within(reviewCard).getByLabelText("Experience decision: Needs review")).toBeTruthy();
      expect(
        within(reviewCard).getByText("Ambiguous or non-comparable experience requirement"),
      ).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: "Show 2 excluded" }));

    const below = screen.getByText("Below Salary Platform Engineer").closest("article")!;
    expect(within(below).getByLabelText("Salary decision: Rule blocker")).toBeTruthy();
    expect(within(below).getByText(/Annual salary maximum.*below your minimum/)).toBeTruthy();
    expect(
      within(below)
        .getByText(/Skills found:/)
        .closest("p")?.textContent,
    ).toContain("TypeScript");

    const heavy = screen.getByText("Experience Heavy Platform Engineer").closest("article")!;
    expect(within(heavy).getByText("5+ years explicitly required")).toBeTruthy();
    expect(within(heavy).getByLabelText("Experience decision: Rule blocker")).toBeTruthy();
    expect(
      within(heavy).getByText(/Required experience minimum.*exceeds your maximum/),
    ).toBeTruthy();
  });

  it("keeps satisfied fact badges independent from unrelated exclusion blockers", () => {
    const savedSearch: SavedJobSearch = {
      id: "saved-independent-decisions",
      name: "Independent decisions",
      criteria: {
        query: "platform engineer",
        locationScope: "remote-us",
        unknownLocationPolicy: "include",
      },
      sources: { freehire: true, greenhouse: [], lever: [], ashby: [] },
      match: {
        skillSource: "manual",
        prioritySkills: ["TypeScript"],
        excludedKeywords: ["salary", "required experience"],
        excludedCompanies: [],
        minimumAnnualSalaryUsd: 120_000,
        maximumRequiredExperienceYears: 4,
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "not-needed" },
      },
      createdAt: 10,
      updatedAt: 10,
    };
    renderSearch(
      [
        entry("excluded-but-satisfied", {
          title: "Platform Engineer",
          company: "Salary Labs",
          liveness: "open",
          salary: "USD 130,000 per year",
          description:
            "Build services with TypeScript. Required experience: 3–5 years of professional experience.",
        }),
      ],
      [savedSearch],
    );

    expect(screen.queryByText("Salary Labs")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 excluded" }));

    const card = screen.getByText("Salary Labs").closest("article")!;
    expect(within(card).getByLabelText("Salary decision: Rule satisfied")).toBeTruthy();
    expect(within(card).getByLabelText("Experience decision: Rule satisfied")).toBeTruthy();
    expect(within(card).getByText("Excluded keyword matched: salary.")).toBeTruthy();
    expect(within(card).getByText("Excluded keyword matched: required experience.")).toBeTruthy();
  });

  it("excludes only explicit sponsorship conflicts and quotes the JD evidence", () => {
    const savedSearch: SavedJobSearch = {
      id: "saved-eligibility",
      name: "Sponsored platform roles",
      criteria: {
        query: "platform engineer",
        locationScope: "remote-us",
        unknownLocationPolicy: "include",
        maxResults: 100,
      },
      sources: { freehire: true, greenhouse: [], lever: [], ashby: [] },
      match: {
        skillSource: "manual",
        prioritySkills: ["TypeScript"],
        excludedKeywords: [],
        excludedCompanies: [],
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "required" },
      },
      createdAt: 10,
      updatedAt: 10,
    };
    renderSearch(
      [
        entry("silent", {
          title: "Platform Engineer",
          liveness: "open",
          description: "Build platform services with TypeScript.",
        }),
        entry("sponsored", {
          title: "Senior Platform Engineer",
          liveness: "open",
          description: "We provide H-1B visa sponsorship for qualified candidates.",
        }),
        entry("blocked", {
          title: "Platform Reliability Engineer",
          liveness: "open",
          description: "We do not provide visa sponsorship now or in the future.",
        }),
      ],
      [savedSearch],
    );

    expect(screen.getByText("Platform Engineer")).toBeTruthy();
    expect(screen.getByText("Senior Platform Engineer")).toBeTruthy();
    expect(screen.queryByText("Platform Reliability Engineer")).toBeNull();
    expect(screen.getByText(/Sponsorship: not mentioned/)).toBeTruthy();
    expect(screen.getByText("Sponsorship evidence:").closest("li")?.textContent).toContain(
      "We provide H-1B visa sponsorship for qualified candidates.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Show 1 excluded" }));

    expect(screen.getByText("Platform Reliability Engineer")).toBeTruthy();
    expect(
      screen.getByText(
        "Sponsorship conflict: you need sponsorship, and the posting explicitly says it is unavailable.",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText("Sponsorship evidence:").at(-1)?.closest("li")?.textContent,
    ).toContain("We do not provide visa sponsorship now or in the future.");
  });

  it("uses live Profile skills when assessing a Profile-backed shortlist", () => {
    const savedSearch: SavedJobSearch = {
      id: "saved-profile",
      name: "Live Profile fit",
      criteria: {
        query: "platform engineer",
        locationScope: "remote-us",
        unknownLocationPolicy: "include",
        maxResults: 100,
      },
      sources: { freehire: true, greenhouse: [], lever: [], ashby: [] },
      match: {
        skillSource: "profile",
        prioritySkills: ["Rust"],
        excludedKeywords: [],
        excludedCompanies: [],
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "not-needed" },
      },
      createdAt: 10,
      updatedAt: 10,
    };

    renderSearch(
      [
        entry("profile-match", {
          liveness: "open",
          description: "Build platform services with TypeScript.",
        }),
      ],
      [savedSearch],
      ["TypeScript", "PostgreSQL"],
    );

    expect(screen.getByText(/Skills found:/).closest("p")?.textContent).toContain("TypeScript");
    expect(screen.getByText(/Not found in available JD text:/).textContent).toContain("PostgreSQL");
    expect(screen.queryByText(/Rust/)).toBeNull();
  });
});
