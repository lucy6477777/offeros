import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  jobPostingSchema,
  type JobPosting,
  type JobSearchResult,
  type ProviderRun,
} from "@offeros/job-search";
import { createDb, type Db } from "../../db/client";
import { jobSources, searchRunItems } from "../../db/schema";
import {
  getStoredSearchRun,
  listSourceHealth,
  listStoredJobs,
  listStoredSearchRuns,
  saveJobSearchResult,
} from "../job-search-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-job-search-repo-"));
  db = createDb(join(dir, "search.db"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function posting(
  id: string,
  provider = "greenhouse",
  applyUrl = "https://boards.greenhouse.io/acme/jobs/123",
): JobPosting {
  return jobPostingSchema.parse({
    id,
    title: "Platform Engineer",
    company: "Acme",
    location: "Remote, United States",
    workplace: "remote",
    description: "Build reliable TypeScript platform systems.",
    applyUrl,
    liveness: "open",
    sources: [
      {
        provider,
        kind: provider === "freehire" ? "aggregator" : "official-ats",
        externalId: id,
        tenant: "acme",
        sourceUrl: `https://${provider}.example/acme`,
        applyUrl,
        fetchedAt: 10,
      },
    ],
  });
}

function providerRun(provider: string, status: ProviderRun["status"] = "success"): ProviderRun {
  return {
    provider,
    status,
    received: status === "failed" ? 0 : 1,
    accepted: status === "failed" ? 0 : 1,
    rejected: 0,
    durationMs: 5,
    issues:
      status === "success"
        ? []
        : [
            {
              provider,
              code: "network",
              message: "offline",
              retryable: true,
            },
          ],
  };
}

function result(
  postings: JobPosting[],
  providerRuns: ProviderRun[],
  startedAt: number,
  finishedAt: number,
): JobSearchResult {
  return {
    postings,
    providerRuns,
    stages: [
      {
        stage: "provider-normalization",
        input: postings.length,
        output: postings.length,
        removed: 0,
      },
      { stage: "criteria", input: postings.length, output: postings.length, removed: 0 },
      {
        stage: "location-eligibility",
        input: postings.length,
        output: postings.length,
        removed: 0,
        reasons: { matched: postings.length },
      },
      { stage: "deduplication", input: postings.length, output: postings.length, removed: 0 },
      { stage: "limit", input: postings.length, output: postings.length, removed: 0 },
    ],
    startedAt,
    finishedAt,
  };
}

describe("job-search repository", () => {
  it("atomically persists a run, supports local queries, and is idempotent by run and URL", () => {
    const first = posting(
      "greenhouse:acme:123",
      "greenhouse",
      "https://boards.greenhouse.io/acme/jobs/123?utm_source=feed",
    );
    saveJobSearchResult(db, {
      runId: "run-1",
      criteria: { query: "engineer" },
      result: result([first], [providerRun("greenhouse")], 1, 10),
    });

    const second = posting(
      "freehire:123",
      "freehire",
      "https://boards.greenhouse.io/acme/jobs/123?gh_src=email",
    );
    const saved = saveJobSearchResult(db, {
      runId: "run-1",
      criteria: { query: "typescript" },
      result: result([second], [providerRun("freehire")], 11, 20),
    });

    expect(saved.run.id).toBe("run-1");
    expect(saved.run.resultCount).toBe(1);
    expect(getStoredSearchRun(db, "run-1")?.criteria).toEqual({ query: "typescript" });
    expect(listStoredSearchRuns(db)).toHaveLength(1);
    expect(db.select().from(searchRunItems).all()).toHaveLength(1);
    expect(db.select().from(jobSources).all()).toHaveLength(2);

    const jobs = listStoredJobs(db, { query: "platform typescript", maxResults: 10 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ firstSeenAt: 10, lastSeenAt: 20 });
    expect(jobs[0]!.posting.id).toBe("greenhouse:acme:123");
    expect(jobs[0]!.posting.sources.map((source) => source.provider).sort()).toEqual([
      "freehire",
      "greenhouse",
    ]);
    expect(listStoredJobs(db, { query: "accountant" })).toEqual([]);
  });

  it("tracks consecutive provider failures and resets them after recovery", () => {
    saveJobSearchResult(db, {
      runId: "failed-1",
      criteria: {},
      result: result([], [providerRun("greenhouse", "failed")], 1, 10),
    });
    saveJobSearchResult(db, {
      runId: "failed-2",
      criteria: {},
      result: result([], [providerRun("greenhouse", "failed")], 11, 20),
    });

    expect(listSourceHealth(db)[0]).toMatchObject({
      provider: "greenhouse",
      status: "failed",
      consecutiveFailures: 2,
      lastFailureAt: 20,
    });

    saveJobSearchResult(db, {
      runId: "recovered",
      criteria: {},
      result: result([posting("greenhouse:acme:123")], [providerRun("greenhouse")], 21, 30),
    });
    expect(listSourceHealth(db)[0]).toMatchObject({
      provider: "greenhouse",
      status: "success",
      consecutiveFailures: 0,
      lastFailureAt: 20,
      lastSuccessAt: 30,
    });
  });
});
