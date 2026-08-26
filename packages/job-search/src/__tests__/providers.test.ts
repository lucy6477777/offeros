import { describe, expect, it, vi } from "vitest";
import ashbyBoard from "./fixtures/ashby-board.json";
import freehireSearch from "./fixtures/freehire-search.json";
import greenhouseBoard from "./fixtures/greenhouse-board.json";
import leverBoard from "./fixtures/lever-board.json";
import { createAshbyProvider } from "../providers/ashby";
import { createFreehireProvider } from "../providers/freehire";
import { createGreenhouseProvider } from "../providers/greenhouse";
import { createLeverProvider } from "../providers/lever";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Greenhouse provider", () => {
  it("normalizes a public board response and counts rejected rows", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response(greenhouseBoard),
    );
    const provider = createGreenhouseProvider([{ token: "Acme", company: "Acme Cloud" }]);
    const result = await provider.search({}, { fetchImpl: fetchImpl as never, now: () => 42 });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    );
    expect(result.received).toBe(2);
    expect(result.rejected).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]).toMatchObject({
      id: "greenhouse:acme:12345",
      title: "Platform Engineer",
      company: "Acme Cloud",
      location: "Remote, United States",
      workplace: "remote",
      department: "Engineering",
      liveness: "open",
    });
    expect(result.postings[0]!.description).toBe("Build TypeScript platform services.");
    expect(result.postings[0]!.applyUrl).toContain("job-boards.greenhouse.io/acme/jobs/12345");
    expect(result.postings[0]!.sources[0]).toMatchObject({
      provider: "greenhouse",
      kind: "official-ats",
      externalId: "12345",
      tenant: "acme",
      fetchedAt: 42,
    });
  });

  it("keeps successful boards when another tenant fails", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("broken") ? response({}, 503) : response(greenhouseBoard),
    );
    const provider = createGreenhouseProvider([
      { token: "broken", company: "Broken Co" },
      { token: "acme", company: "Acme Cloud" },
    ]);
    const result = await provider.search({}, { fetchImpl: fetchImpl as never });

    expect(result.postings).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ provider: "greenhouse", scope: "broken", code: "http" }),
    ]);
    expect(result.issues[0]!.retryable).toBe(true);
  });
});

describe("Lever provider", () => {
  it("uses the EU list endpoint and preserves structured posting fields", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response(leverBoard),
    );
    const provider = createLeverProvider([{ site: "Fundrise", company: "Fundrise", region: "eu" }]);
    const result = await provider.search({}, { fetchImpl: fetchImpl as never, now: () => 99 });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.eu.lever.co/v0/postings/fundrise?mode=json",
    );
    expect(result.received).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.postings[0]).toMatchObject({
      id: "lever:fundrise:49b8b94c-a7f4-4838-a9fb-265f6b55bf93",
      title: "Lead Software Engineer",
      company: "Fundrise",
      countryCode: "US",
      workplace: "remote",
      employmentType: "Full-time",
      department: "API Engineering",
      salary: "USD 190,000–250,000 per year",
      liveness: "open",
    });
    expect(result.postings[0]!.applyUrl).toMatch(/\/apply$/);
    expect(result.postings[0]!.postedAt).toMatch(/^2026-/);
    expect(result.postings[0]!.sources[0]!.sourceUrl).toContain("api.eu.lever.co");
  });

  it("reports an invalid payload rather than pretending there were no jobs", async () => {
    const provider = createLeverProvider([{ site: "acme", company: "Acme" }]);
    const result = await provider.search(
      {},
      { fetchImpl: vi.fn(async () => response({ jobs: [] })) as never },
    );

    expect(result.postings).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: "invalid-payload", retryable: false });
  });
});

describe("Ashby provider", () => {
  it("normalizes the official public posting API and rejects unlisted roles", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response(ashbyBoard),
    );
    const provider = createAshbyProvider([{ name: "Acme", company: "Acme Cloud" }]);
    const result = await provider.search({}, { fetchImpl: fetchImpl as never, now: () => 123 });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/Acme?includeCompensation=true",
    );
    expect(result).toMatchObject({ received: 2, rejected: 1, issues: [] });
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]).toMatchObject({
      id: "ashby:acme:7458d4e9-da2e-47bd-98cb-adfda43d42b2",
      title: "Staff Platform Engineer",
      company: "Acme Cloud",
      location: "Remote, United States",
      countryCode: "US",
      workplace: "remote",
      department: "Engineering",
      salary: "$180K - $220K",
      postedAt: "2026-08-20T14:29:08.532Z",
    });
    expect(result.postings[0]!.sources[0]).toMatchObject({
      provider: "ashby",
      kind: "official-ats",
      tenant: "acme",
      fetchedAt: 123,
    });
  });
});

describe("freehire provider", () => {
  it("pushes supported filters upstream and normalizes original application URLs", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response(freehireSearch),
    );
    const provider = createFreehireProvider();
    const result = await provider.search(
      { query: "platform engineer", locationScope: "remote-us" },
      { fetchImpl: fetchImpl as never, now: () => 456 },
    );

    const requested = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(requested.pathname).toBe("/api/v1/agent/jobs/search");
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({
      q: "platform engineer",
      countries: "US",
      work_mode: "remote",
      description_format: "text",
      limit: "100",
      offset: "0",
    });
    expect(result).toMatchObject({ received: 2, rejected: 1, issues: [] });
    expect(result.postings[0]).toMatchObject({
      id: "freehire:platform-engineer-acme-abc123",
      title: "Platform Engineer",
      company: "Acme",
      countryCode: "US",
      workplace: "remote",
      liveness: "open",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
    });
    expect(result.postings[0]!.sources[0]).toMatchObject({
      provider: "freehire",
      kind: "aggregator",
      tenant: "greenhouse",
      fetchedAt: 456,
    });
  });

  it("fails closed when freehire reports that a requested filter was ignored", async () => {
    const payload = structuredClone(freehireSearch) as typeof freehireSearch & {
      meta: typeof freehireSearch.meta & { ignored_params: Array<{ param: string }> };
    };
    payload.meta.ignored_params = [{ param: "countries" }];
    const provider = createFreehireProvider();
    const result = await provider.search(
      { locationScope: "united-states" },
      { fetchImpl: vi.fn(async () => response(payload)) as never },
    );

    expect(result.postings).toEqual([]);
    expect(result).toMatchObject({ received: 2, rejected: 2 });
    expect(result.issues[0]).toMatchObject({ code: "invalid-payload", retryable: false });
    expect(result.issues[0]!.message).toContain("countries");
  });

  it("paginates when an explicit result limit exceeds one response page", async () => {
    const makeJob = (slug: string) => ({
      public_slug: slug,
      title: `Engineer ${slug}`,
      company: "Acme",
      url: `https://jobs.example.com/${slug}`,
      countries: ["us"],
      work_mode: "remote",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({ data: [makeJob("one"), makeJob("two")], meta: { total: 3 } }),
      )
      .mockResolvedValueOnce(response({ data: [makeJob("three")], meta: { total: 3 } }));
    const result = await createFreehireProvider().search(
      { maxResults: 3 },
      { fetchImpl: fetchImpl as never },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[1]![0])).searchParams.get("offset")).toBe("2");
    expect(result.postings).toHaveLength(3);
  });
});
