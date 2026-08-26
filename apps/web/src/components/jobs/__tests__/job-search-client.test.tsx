// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderSearch(initialJobs: JobCatalogueEntry[] = []) {
  return render(
    <JobSearchClient initialJobs={initialJobs} initialRuns={[]} initialSourceHealth={[]} />,
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
});
