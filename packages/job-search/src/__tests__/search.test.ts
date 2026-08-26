import { describe, expect, it } from "vitest";
import {
  deduplicatePostings,
  jobPostingSchema,
  searchJobs,
  type JobPosting,
  type JobSearchProvider,
  type JobSourceKind,
} from "..";

function posting(
  id: string,
  overrides: Partial<JobPosting> & { kind?: JobSourceKind } = {},
): JobPosting {
  const kind = overrides.kind ?? "official-ats";
  const applyUrl = overrides.applyUrl ?? `https://jobs.example.com/acme/${id}`;
  return jobPostingSchema.parse({
    id,
    title: "Platform Engineer",
    company: "Acme",
    location: "Remote, United States",
    workplace: "remote",
    description: "Build reliable TypeScript platform systems for customers.",
    applyUrl,
    liveness: "open",
    sources: [
      {
        provider: kind === "aggregator" ? "freehire" : "greenhouse",
        kind,
        externalId: id,
        tenant: "acme",
        sourceUrl: kind === "aggregator" ? "https://freehire.example/jobs" : applyUrl,
        applyUrl,
        fetchedAt: 1,
      },
    ],
    ...overrides,
  });
}

function provider(
  id: string,
  postings: JobPosting[],
  options: { received?: number; throws?: boolean } = {},
): JobSearchProvider {
  return {
    id,
    kind: id === "freehire" ? "aggregator" : "official-ats",
    async search() {
      if (options.throws) throw new Error("offline");
      return {
        postings,
        received: options.received ?? postings.length,
        rejected: (options.received ?? postings.length) - postings.length,
        issues: [],
      };
    },
  };
}

describe("deduplication", () => {
  it("merges tracking variants and preserves every source", () => {
    const official = posting("official", {
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/123?gh_src=email",
      salary: "USD 180,000–220,000 per year",
    });
    const aggregate = posting("aggregate", {
      kind: "aggregator",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/123?utm_source=feed",
      description: "Build reliable TypeScript platform systems.",
    });

    const result = deduplicatePostings([aggregate, official]);
    expect(result.duplicates).toBe(1);
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]!.id).toBe("official");
    expect(result.postings[0]!.salary).toContain("180,000");
    expect(result.postings[0]!.sources.map((source) => source.provider).sort()).toEqual([
      "freehire",
      "greenhouse",
    ]);
  });
});

describe("search orchestration", () => {
  it("survives provider failure and exposes every survivor count", async () => {
    const duplicateOfficial = posting("gh-123", {
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
    });
    const duplicateAggregate = posting("free-123", {
      kind: "aggregator",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/123?utm_campaign=daily",
    });
    const other = posting("lever-456", {
      title: "Product Manager",
      description: "Lead product planning.",
    });
    let clock = 100;
    const result = await searchJobs(
      [
        provider("greenhouse", [duplicateOfficial]),
        provider("freehire", [duplicateAggregate, other]),
        provider("broken", [], { throws: true }),
      ],
      {},
      { now: () => clock++ },
    );

    expect(result.postings).toHaveLength(2);
    expect(result.postings[0]!.sources).toHaveLength(2);
    expect(result.providerRuns.find((run) => run.provider === "broken")).toMatchObject({
      status: "failed",
      accepted: 0,
      issues: [expect.objectContaining({ code: "network", retryable: true })],
    });
    expect(result.stages).toEqual([
      { stage: "provider-normalization", input: 3, output: 3, removed: 0 },
      { stage: "criteria", input: 3, output: 3, removed: 0 },
      { stage: "deduplication", input: 3, output: 2, removed: 1 },
      { stage: "limit", input: 2, output: 2, removed: 0 },
    ]);
  });

  it("applies local full-text criteria and an explicit final limit", async () => {
    const result = await searchJobs(
      [
        provider("greenhouse", [
          posting("one"),
          posting("two", { title: "Backend Engineer" }),
          posting("three", { title: "Product Manager", description: "Plan roadmaps." }),
        ]),
      ],
      { query: "engineer typescript", maxResults: 1 },
    );

    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]!.title).toMatch(/Engineer/);
    expect(result.stages.find((stage) => stage.stage === "criteria")).toMatchObject({
      input: 3,
      output: 2,
      removed: 1,
    });
    expect(result.stages.at(-1)).toEqual({ stage: "limit", input: 2, output: 1, removed: 1 });
  });
});
