import { describe, expect, it, vi } from "vitest";
import greenhouseBoard from "./fixtures/greenhouse-board.json";
import leverBoard from "./fixtures/lever-board.json";
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
